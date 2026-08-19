"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import DeckSelector from "@/components/DeckSelector";
import HistoryPanel from "@/components/HistoryPanel";
import { historyStorage } from "@/lib/history";

export default function HomePage() {
  const router = useRouter();
  const [selectedDeck, setSelectedDeck] = useState<string | null>(null);
  const [recentCount, setRecentCount] = useState(0);

  useEffect(() => {
    setRecentCount(historyStorage.getAll().length);
  }, []);

  function handleSelectDeck(deck: string) {
    setSelectedDeck(deck);
  }

  function handleGoToDeck() {
    if (selectedDeck) {
      router.push(`/deck/${encodeURIComponent(selectedDeck)}`);
    }
  }

  return (
    <main style={{ minHeight: "100vh", padding: "0 0 60px" }}>
      {/* Navigation */}
      <nav
        style={{
          padding: "16px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--border-subtle)",
          background: "rgba(10, 10, 20, 0.8)",
          backdropFilter: "blur(12px)",
          position: "sticky",
          top: 0,
          zIndex: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "1.5rem" }}>🎴</span>
          <span
            style={{ fontWeight: 800, fontSize: "1.1rem" }}
            className="heading-gradient"
          >
            AnkiChat
          </span>
        </div>
        <HistoryPanel />
      </nav>

      {/* Hero */}
      <section
        style={{
          maxWidth: "700px",
          margin: "0 auto",
          padding: "80px 24px 60px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px 16px",
            background: "rgba(124, 58, 237, 0.15)",
            border: "1px solid rgba(124, 58, 237, 0.3)",
            borderRadius: "20px",
            fontSize: "0.8rem",
            color: "#a78bfa",
            fontWeight: 600,
            marginBottom: "28px",
          }}
        >
          ✨ Học từ vựng qua hội thoại AI • Luyện nói real-time
        </div>

        <h1
          style={{
            fontSize: "clamp(2rem, 5vw, 3rem)",
            fontWeight: 800,
            lineHeight: 1.15,
            marginBottom: "20px",
            letterSpacing: "-0.02em",
          }}
          className="heading-gradient"
        >
          Biến Anki Flashcard
          <br />
          thành Hội Thoại Thực Tế
        </h1>

        <p
          style={{
            fontSize: "1.05rem",
            color: "var(--text-secondary)",
            lineHeight: 1.7,
            marginBottom: "48px",
            maxWidth: "500px",
            margin: "0 auto 48px",
          }}
        >
          Lấy bộ từ vựng từ Anki, sinh ra hội thoại tiếng Anh tự nhiên,
          rồi luyện nói trực tiếp với AI bằng Gemini Live.
        </p>

        {/* Features */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "16px",
            marginBottom: "48px",
          }}
        >
          {[
            { icon: "📚", title: "Lấy từ Anki", desc: "Kết nối trực tiếp với AnkiConnect" },
            { icon: "✨", title: "Sinh hội thoại", desc: "Gemini AI tạo kịch bản tự nhiên" },
            { icon: "🎙️", title: "Luyện nói", desc: "Real-time voice với Gemini Live" },
          ].map((f) => (
            <div
              key={f.title}
              className="card"
              style={{ padding: "20px 16px", textAlign: "center" }}
            >
              <div style={{ fontSize: "1.8rem", marginBottom: "10px" }}>{f.icon}</div>
              <div style={{ fontWeight: 700, fontSize: "0.875rem", marginBottom: "4px" }}>
                {f.title}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{f.desc}</div>
            </div>
          ))}
        </div>

        {/* Deck selector card */}
        <div
          className="card-elevated"
          style={{ padding: "28px", textAlign: "left" }}
        >
          <DeckSelector
            onSelectDeck={handleSelectDeck}
            selectedDeck={selectedDeck}
          />

          {selectedDeck && (
            <div className="fade-in" style={{ marginTop: "20px" }}>
              <div
                style={{
                  padding: "14px 16px",
                  background: "rgba(124, 58, 237, 0.1)",
                  border: "1px solid rgba(124, 58, 237, 0.25)",
                  borderRadius: "10px",
                  marginBottom: "16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                <span>📂</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{selectedDeck}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Đã chọn
                  </div>
                </div>
              </div>
              <button
                onClick={handleGoToDeck}
                className="btn-primary"
                style={{ width: "100%" }}
                id="go-to-deck-btn"
              >
                Xem Cards & Sinh Hội Thoại →
              </button>
            </div>
          )}
        </div>

        {recentCount > 0 && (
          <p
            style={{
              marginTop: "20px",
              fontSize: "0.8rem",
              color: "var(--text-muted)",
            }}
          >
            💾 Bạn có {recentCount} hội thoại đã lưu —{" "}
            <span style={{ color: "var(--accent-primary)", cursor: "pointer" }}>
              Xem lịch sử
            </span>
          </p>
        )}
      </section>
    </main>
  );
}
