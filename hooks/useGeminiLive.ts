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

// Convert base64 to AudioBuffer and play it
async function playAudioChunk(
  base64: string,
  audioCtxRef: React.RefObject<AudioContext | null>
): Promise<void> {
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
  source.start();
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
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
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
                if (audioData) await playAudioChunk(audioData, audioCtxRef);
              }
              if (part.text) {
                aiTextBufferRef.current += part.text;
              }
            }
          }

          if (tc) {
            if (aiTextBufferRef.current.trim()) {
              addMessage("ai", aiTextBufferRef.current.trim());
              aiTextBufferRef.current = "";
            }
            setStatus("ready");
          }
        }

        // Input transcription
        const transcription = msg.inputTranscription ?? msg.input_transcription;
        if (transcription?.text) {
          addMessage("user", transcription.text);
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
            },
            systemInstruction: {
              parts: [{ text: systemPrompt }],
            },
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
    } catch (err) {
      console.error("[GeminiLive] connect error:", err);
      setStatus("error");
      setError(err instanceof Error ? err.message : "Connection failed");
    }
  }, [systemPrompt, handleServerMessage]);


  const startListening = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (isListeningRef.current) return;

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

      // Create capture AudioContext — browser will resample to 16kHz via worklet
      const captureCtx = new AudioContext({ sampleRate: 16000 });
      await captureCtx.audioWorklet.addModule("/audio-processor.worklet.js");

      const source = captureCtx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(captureCtx, "audio-capture-processor");
      workletNodeRef.current = workletNode;

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
              mediaChunks: [
                {
                  mimeType: "audio/pcm;rate=16000",
                  data: b64,
                },
              ],
            },
          })
        );
      };

      // Connect source → worklet only (no destination — we don't need speaker output here)
      source.connect(workletNode);

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
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;

    // Signal end of turn
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ clientContent: { turnComplete: true } })
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
