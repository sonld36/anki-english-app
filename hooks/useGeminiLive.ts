"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { PracticeMessage } from "@/lib/history";

type LiveStatus = "idle" | "connecting" | "ready" | "listening" | "speaking" | "error";

interface UseGeminiLiveOptions {
  systemPrompt: string;
  onTranscriptUpdate?: (messages: PracticeMessage[]) => void;
}

interface UseGeminiLiveReturn {
  status: LiveStatus;
  transcript: PracticeMessage[];
  connect: () => Promise<void>;
  disconnect: () => void;
  startListening: () => Promise<void>;
  stopListening: () => void;
  error: string | null;
}

// Convert ArrayBuffer to base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert base64 to AudioBuffer and schedule it back-to-back with previously queued chunks
// (playing each chunk at "now" instead of queuing causes overlap/gaps — audible as choppy audio)
function playAudioChunk(
  base64: string,
  audioCtxRef: React.RefObject<AudioContext | null>,
  nextPlayTimeRef: React.RefObject<number>
): void {
  if (!audioCtxRef.current) return;

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  // Gemini outputs 24kHz 16-bit PCM little-endian
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }

  const audioCtx = audioCtxRef.current;
  const buffer = audioCtx.createBuffer(1, float32.length, 24000);
  buffer.getChannelData(0).set(float32);

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(audioCtx.destination);

  const startAt = Math.max(audioCtx.currentTime, nextPlayTimeRef.current);
  source.start(startAt);
  nextPlayTimeRef.current = startAt + buffer.duration;
}

export function useGeminiLive({
  systemPrompt,
  onTranscriptUpdate,
}: UseGeminiLiveOptions): UseGeminiLiveReturn {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [transcript, setTranscript] = useState<PracticeMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const aiTextBufferRef = useRef<string>("");
  const isListeningRef = useRef(false);

  const addMessage = useCallback(
    (role: "ai" | "user", text: string) => {
      const msg: PracticeMessage = {
        role,
        text,
        timestamp: new Date().toISOString(),
      };
      setTranscript((prev) => {
        const updated = [...prev, msg];
        onTranscriptUpdate?.(updated);
        return updated;
      });
    },
    [onTranscriptUpdate]
  );

  const handleServerMessage = useCallback(
    async (data: string | ArrayBuffer | Blob) => {
      try {
        // Handle Blob (binary WebSocket frame) — convert to text first
        let rawText: string;
        if (data instanceof Blob) {
          rawText = await data.text();
        } else if (data instanceof ArrayBuffer) {
          rawText = new TextDecoder().decode(data);
        } else {
          rawText = data;
        }

        // Log ALL raw responses so we can see what Gemini is actually sending
        console.log("[GeminiLive] Raw response:", rawText.slice(0, 300));

        const msg = JSON.parse(rawText);

        // Setup complete — handle both camelCase and snake_case
        if (msg.setupComplete !== undefined || msg.setup_complete !== undefined) {
          console.log("[GeminiLive] ✅ Setup complete!");
          setStatus("ready");
          return;
        }

        // Server content (AI response)
        if (msg.serverContent || msg.server_content) {
          const sc = msg.serverContent ?? msg.server_content;
          const { modelTurn, turnComplete } = sc;
          const mt = modelTurn ?? sc.model_turn;
          const tc = turnComplete ?? sc.turn_complete;

          if (mt?.parts) {
            setStatus("speaking");
            for (const part of mt.parts) {
              if (part.inlineData?.mimeType?.includes("audio") || part.inline_data?.mime_type?.includes("audio")) {
                const audioData = part.inlineData?.data ?? part.inline_data?.data;
                if (audioData) playAudioChunk(audioData, audioCtxRef, nextPlayTimeRef);
              }
              if (part.text) {
                aiTextBufferRef.current += part.text;
              }
            }
          }

          // Output transcription — text of what the AI is saying (responseModalities is AUDIO-only,
          // so this is the only source of AI text; modelTurn.parts never carries a text part)
          const outputTranscription = sc.outputTranscription ?? sc.output_transcription;
          if (outputTranscription?.text) {
            aiTextBufferRef.current += outputTranscription.text;
          }

          // Input transcription — text of what the user said
          const inputTranscription = sc.inputTranscription ?? sc.input_transcription;
          if (inputTranscription?.text) {
            console.log("[GeminiLive] User said:", inputTranscription.text);
            addMessage("user", inputTranscription.text);
          }

          if (tc) {
            if (aiTextBufferRef.current.trim()) {
              addMessage("ai", aiTextBufferRef.current.trim());
              aiTextBufferRef.current = "";
            }
            setStatus("ready");
          }
        }

      } catch (e) {
        console.warn("[GeminiLive] Parse error:", e, "| data type:", typeof data);
      }
    },
    [addMessage]
  );


  const connect = useCallback(async () => {
    setError(null);
    setStatus("connecting");

    try {
      // Get API key + model from server
      const tokenRes = await fetch("/api/live-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt }),
      });
      const { apiKey, model } = await tokenRes.json();

      if (!apiKey) throw new Error("No API key available");

      const WS_BASE =
        "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
      const ws = new WebSocket(`${WS_BASE}?key=${apiKey}`);
      wsRef.current = ws;

      // Connection timeout: if setupComplete not received in 15s, fail
      const connectTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN || wsRef.current === ws) {
          ws.close();
          setStatus("error");
          setError("Kết nối Gemini Live timeout. Model có thể chưa hỗ trợ với API key này.");
        }
      }, 15000);

      ws.onopen = () => {
        console.log("[GeminiLive] WebSocket opened, sending setup for model:", model);
        // Minimal setup for gemini-2.5-flash-native-audio-latest
        const setupMsg = {
          setup: {
            model,
            generationConfig: {
              responseModalities: ["AUDIO"],
              // Best-effort only: native-audio models don't officially honor languageCode for
              // input transcription (confirmed limitation, see google/adk-python#5542) — this
              // only reliably steers the output voice's language.
              speechConfig: {
                languageCode: "en-US",
              },
            },
            systemInstruction: {
              parts: [
                { text: systemPrompt },
                { text: "The user speaks English (US/UK). Transcribe and respond in English only." },
              ],
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        };
        console.log("[GeminiLive] Setup message:", JSON.stringify(setupMsg));
        ws.send(JSON.stringify(setupMsg));
      };

      ws.onmessage = (event) => {
        // Clear timeout once we get any message (setup complete)
        clearTimeout(connectTimeout);
        handleServerMessage(event.data);
      };

      ws.onerror = (e) => {
        clearTimeout(connectTimeout);
        console.error("[GeminiLive] WebSocket error:", e);
        setStatus("error");
        setError("Lỗi kết nối WebSocket. Kiểm tra console để biết thêm chi tiết.");
      };

      ws.onclose = (e) => {
        clearTimeout(connectTimeout);
        console.log("[GeminiLive] WebSocket closed:", e.code, e.reason);
        if (e.code !== 1000 && e.code !== 1001) {
          // Abnormal close
          setError(`Kết nối bị đóng: ${e.reason || `code ${e.code}`}`);
          setStatus("error");
        } else {
          setStatus("idle");
        }
        isListeningRef.current = false;
      };

      // Setup audio context for playback (24kHz output)
      audioCtxRef.current = new AudioContext({ sampleRate: 24000 });
      nextPlayTimeRef.current = 0;

      // Setup capture context + worklet ONCE per session (16kHz) — reused across all turns.
      // Creating a fresh one per turn (previous bug) leaked a live AudioContext every push-to-talk
      // press, degrading capture/playback more with each subsequent turn.
      captureCtxRef.current = new AudioContext({ sampleRate: 16000 });
      await captureCtxRef.current.audioWorklet.addModule("/audio-processor.worklet.js");
      const workletNode = new AudioWorkletNode(captureCtxRef.current, "audio-capture-processor");
      let chunkCount = 0;
      workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        // Skip empty or too-small chunks
        if (!e.data || e.data.byteLength < 2) return;
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;

        const b64 = arrayBufferToBase64(e.data);

        // Log first 3 chunks to verify encoding is correct
        if (chunkCount < 3) {
          console.log(`[GeminiLive] Sending audio chunk #${chunkCount}: ${e.data.byteLength} bytes → b64 len ${b64.length}`);
          chunkCount++;
        }

        wsRef.current.send(
          JSON.stringify({
            realtimeInput: {
              audio: {
                mimeType: "audio/pcm;rate=16000",
                data: b64,
              },
            },
          })
        );
      };
      workletNodeRef.current = workletNode;
    } catch (err) {
      console.error("[GeminiLive] connect error:", err);
      setStatus("error");
      setError(err instanceof Error ? err.message : "Connection failed");
    }
  }, [systemPrompt, handleServerMessage]);


  const startListening = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (isListeningRef.current) return;
    if (!captureCtxRef.current || !workletNodeRef.current) {
      setError("Chưa sẵn sàng ghi âm — vui lòng kết nối lại.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      if (captureCtxRef.current.state === "suspended") {
        await captureCtxRef.current.resume();
      }

      // Reuse the session-persistent capture context + worklet node (see connect()) — only the
      // MediaStreamSource is per-turn, since it's tied to this turn's fresh MediaStream.
      const source = captureCtxRef.current.createMediaStreamSource(stream);
      sourceRef.current = source;
      source.connect(workletNodeRef.current);

      isListeningRef.current = true;
      setStatus("listening");
    } catch (err) {
      console.error("[GeminiLive] startListening error:", err);
      setError("Không thể truy cập microphone: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);


  const stopListening = useCallback(() => {
    isListeningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    // Only disconnect this turn's source — the worklet node/capture context are session-persistent
    // and must survive to be reused by the next turn's startListening()
    sourceRef.current?.disconnect();
    sourceRef.current = null;

    // Flush the realtime audio input stream (mixing clientContent.turnComplete with an
    // active realtimeInput stream is rejected by the API with a 1007 close)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ realtimeInput: { audioStreamEnd: true } })
      );
    }
    setStatus("ready");
  }, []);

  const disconnect = useCallback(() => {
    stopListening();
    wsRef.current?.close();
    wsRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    captureCtxRef.current?.close();
    captureCtxRef.current = null;
    setStatus("idle");
    setTranscript([]);
    aiTextBufferRef.current = "";
  }, [stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
      captureCtxRef.current?.close();
    };
  }, []);

  return {
    status,
    transcript,
    connect,
    disconnect,
    startListening,
    stopListening,
    error,
  };
}
