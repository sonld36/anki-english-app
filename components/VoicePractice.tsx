"use client";

import { useEffect, useRef, useState } from "react";
import { historyStorage, type HistoryEntry, type PracticeMessage } from "@/lib/history";
import { useGeminiLive } from "@/hooks/useGeminiLive";
import { highlightWords } from "@/lib/gemini";
import type { ParsedCard } from "@/lib/anki";

interface VoicePracticeProps {
  entry: HistoryEntry;
  onBack: () => void;
}

export default function VoicePractice({ entry, onBack }: VoicePracticeProps) {
  const [showScript, setShowScript] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const systemPrompt = `You are Sam, an English conversation partner in a ${entry.context} setting. 

You are having a natural conversation with a Vietnamese English learner (Alex). Your role:
- Speak ONLY in English, keep responses concise (1-3 sentences max per turn)
- Naturally weave in these vocabulary words when appropriate: ${entry.cards.map((c) => c.word).join(", ")}
- You are helpful and encouraging — if the user makes a grammar mistake, subtly model the correct form in your response without explicitly correcting them
- Keep the conversation in the context of: ${entry.context}
- If the user says something unclear, ask a simple clarifying question
- Start by greeting the user warmly and opening the conversation

Reference dialogue for context (but improvise freely):
${entry.dialogue}`;

  const { status, transcript, connect, disconnect, startListening, stopListening, error } =
    useGeminiLive({
      systemPrompt,
      onTranscriptUpdate: (msgs) => {
        historyStorage.updateTranscript(entry.id, msgs);
      },
    });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  const words = entry.cards.map((c) => c.word);
  const isConnected = status === "ready" || status === "listening" || status === "speaking";
  const isListening = status === "listening";
  const isSpeaking = status === "speaking";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: showScript ? "1fr 360px" : "1fr",
        gap: "20px",
        height: "calc(100vh - 140px)",
        transition: "grid-template-columns 0.3s ease",
      }}
    >
      {/* Main Chat Panel */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-card)",
          borderRadius: "16px",
          border: "1px solid var(--border-subtle)",
          overflow: "hidden",
        }}
      >
        {/* Chat Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--bg-elevated)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.1rem",
              }}
            >
              🤖
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>Sam (AI Partner)</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                {status === "idle" && "Chưa kết nối"}
                {status === "connecting" && "Đang kết nối..."}
                {status === "ready" && "Sẵn sàng"}
                {status === "listening" && "🎤 Đang nghe bạn..."}
                {status === "speaking" && "💬 Đang nói..."}
                {status === "error" && "Lỗi kết nối"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => setShowScript((s) => !s)}
              className="btn-secondary"
              style={{ padding: "6px 12px", fontSize: "0.8rem" }}
            >
              {showScript ? "📄 Ẩn kịch bản" : "📄 Kịch bản"}
            </button>
            {isConnected && (
              <button
                onClick={disconnect}
                className="btn-secondary"
                style={{ padding: "6px 12px", fontSize: "0.8rem", color: "var(--accent-rose)" }}
              >
                Kết thúc
              </button>
            )}
          </div>
        </div>

        {/* Chat Messages */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {(status === "idle" || status === "connecting") && transcript.length === 0 && (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "16px",
                color: "var(--text-muted)",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "3rem" }}>🎙️</div>
              <div>
                <p style={{ fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px" }}>
                  Bắt đầu luyện tập hội thoại thực tế
                </p>
                <p style={{ fontSize: "0.875rem" }}>
                  AI sẽ đóng vai Sam và trò chuyện với bạn bằng tiếng Anh.
                  <br />
                  Cố gắng sử dụng các từ trong bộ flashcard của bạn!
                </p>
              </div>
              <button
                onClick={connect}
                className="btn-primary"
                style={{ marginTop: "8px" }}
                disabled={status === "connecting"}
                id="connect-voice-btn"
              >
                {status === "connecting" ? (
                  <><div className="spinner" /> Đang kết nối...</>
                ) : (
                  <>🎙️ Kết nối & Bắt đầu</>
                )}
              </button>
            </div>
          )}

          {transcript.length === 0 && status === "connecting" && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center", color: "var(--text-muted)" }}>
                <div className="spinner" style={{ margin: "0 auto 12px" }} />
                <p>Đang kết nối Gemini Live...</p>
              </div>
            </div>
          )}

          {transcript.length === 0 && isConnected && (
            <div
              className="chat-bubble chat-bubble-ai"
              style={{ animation: "slideIn 0.3s ease" }}
            >
              <span style={{ color: "var(--text-muted)", fontSize: "0.75rem", fontWeight: 600, letterSpacing: "0.05em" }}>
                SAM
              </span>
              <p style={{ marginTop: "4px", color: "var(--text-primary)" }}>
                ✨ Kết nối thành công! Nhấn mic để bắt đầu nói chuyện.
              </p>
            </div>
          )}

          {transcript.map((msg, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: msg.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <span
                style={{
                  fontSize: "0.7rem",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  marginBottom: "4px",
                  textTransform: "uppercase",
                }}
              >
                {msg.role === "ai" ? "Sam (AI)" : "Bạn"}
              </span>
              <div
                className={`chat-bubble ${msg.role === "ai" ? "chat-bubble-ai" : "chat-bubble-user"}`}
                dangerouslySetInnerHTML={{
                  __html: msg.role === "ai"
                    ? highlightWords(msg.text, words)
                    : msg.text,
                }}
              />
            </div>
          ))}

          {isSpeaking && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
              <div
                className="chat-bubble chat-bubble-ai"
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <div className="waveform">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div
                      key={i}
                      className="waveform-bar"
                      style={{
                        background: "var(--accent-green)",
                        animationDelay: `${i * 0.1}s`,
                      }}
                    />
                  ))}
                </div>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  Sam đang nói...
                </span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Voice Control Bar */}
        {isConnected && (
          <div
            style={{
              padding: "20px",
              borderTop: "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "12px",
              background: "var(--bg-elevated)",
            }}
          >
            {error && (
              <p style={{ fontSize: "0.8rem", color: "var(--accent-rose)" }}>⚠️ {error}</p>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
              {/* Mic button */}
              <div style={{ position: "relative" }}>
                <button
                  onMouseDown={startListening}
                  onMouseUp={stopListening}
                  onTouchStart={startListening}
                  onTouchEnd={stopListening}
                  className={`voice-button ${isListening ? "listening" : "idle"}`}
                  title="Giữ để nói"
                  aria-label={isListening ? "Đang ghi âm — thả để dừng" : "Giữ để nói"}
                >
                  {isListening ? (
                    <>
                      <div className="voice-ripple" />
                      <div className="voice-ripple" style={{ animationDelay: "0.5s" }} />
                      🎤
                    </>
                  ) : (
                    "🎤"
                  )}
                </button>
              </div>
            </div>

            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center" }}>
              {isListening ? (
                <span style={{ color: "var(--accent-rose)" }}>🔴 Đang ghi âm... Thả để kết thúc lượt nói</span>
              ) : (
                "Giữ nút mic để nói · Thả để gửi"
              )}
            </p>
          </div>
        )}
      </div>

      {/* Script Panel */}
      {showScript && (
        <div
          className="card-elevated slide-up"
          style={{
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            overflowY: "auto",
          }}
        >
          <div>
            <h4 style={{ fontSize: "0.875rem", fontWeight: 700, marginBottom: "4px" }}>
              📄 Kịch bản tham khảo
            </h4>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Xem kịch bản để lấy ý tưởng, nhưng hãy nói tự do!
            </p>
          </div>

          <div
            style={{
              fontSize: "0.825rem",
              color: "var(--text-secondary)",
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
              overflowY: "auto",
              flex: 1,
            }}
            dangerouslySetInnerHTML={{
              __html: highlightWords(entry.dialogue, words)
                .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                .replace(/^(#{1,3})\s(.+)$/gm, "<strong style='color:var(--accent-amber)'>$2</strong>"),
            }}
          />

          {/* Words reminder */}
          <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "12px" }}>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "8px", fontWeight: 600 }}>
              Từ cần dùng:
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {words.map((w) => (
                <span key={w} className="word-highlight" style={{ fontSize: "0.75rem" }}>
                  {w}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
