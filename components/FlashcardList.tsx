"use client";

import { useState } from "react";
import type { VocabularyItem } from "@/lib/vocabulary/types";

interface FlashcardListProps {
  cards: VocabularyItem[];
  highlightedWords?: string[];
}

function FlashcardItem({ card, highlight }: { card: VocabularyItem; highlight: boolean }) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div
      className="flashcard-container"
      style={{ marginBottom: "12px" }}
      onClick={() => setFlipped((f) => !f)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && setFlipped((f) => !f)}
      aria-label={`Flashcard: ${card.word}. Nhấn để xem nghĩa`}
    >
      <div className={`flashcard ${flipped ? "flipped" : ""}`}>
        <div className="flashcard-face flashcard-front">
          <div style={{ textAlign: "center" }}>
            {highlight && (
              <span className="badge badge-amber" style={{ marginBottom: "8px", display: "inline-flex" }}>
                ✨ Trong hội thoại
              </span>
            )}
            <div
              style={{
                fontSize: "1.4rem",
                fontWeight: 700,
                color: highlight ? "var(--highlight-word)" : "var(--text-primary)",
                letterSpacing: "-0.01em",
              }}
            >
              {card.word}
            </div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                marginTop: "8px",
              }}
            >
              Nhấn để xem nghĩa →
            </div>
          </div>
        </div>
        <div className="flashcard-face flashcard-back">
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: "0.8rem",
                color: "var(--text-muted)",
                marginBottom: "8px",
                fontWeight: 500,
              }}
            >
              NGHĨA
            </div>
            <div
              style={{
                fontSize: "1.2rem",
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              {card.meaning}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FlashcardList({ cards, highlightedWords = [] }: FlashcardListProps) {
  const [showAll, setShowAll] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "table">("table");

  const highlightSet = new Set(highlightedWords.map((w) => w.toLowerCase()));
  const displayCards = showAll ? cards : cards.slice(0, 12);

  if (cards.length === 0) {
    return (
      <div
        style={{
          padding: "32px",
          textAlign: "center",
          color: "var(--text-muted)",
          background: "var(--bg-elevated)",
          borderRadius: "12px",
          border: "1px dashed var(--border-medium)",
        }}
      >
        Không tìm thấy card nào trong deck này
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
            {cards.length} cards
          </span>
          {highlightedWords.length > 0 && (
            <span className="badge badge-amber">
              ✨ {highlightedWords.length} từ trong hội thoại
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => setViewMode("table")}
            className={`level-btn ${viewMode === "table" ? "active" : ""}`}
            aria-label="Table view"
          >
            ☰ Bảng
          </button>
          <button
            onClick={() => setViewMode("grid")}
            className={`level-btn ${viewMode === "grid" ? "active" : ""}`}
            aria-label="Grid view"
          >
            ⊞ Card
          </button>
        </div>
      </div>

      {/* Table View */}
      {viewMode === "table" && (
        <div
          style={{
            background: "var(--bg-card)",
            borderRadius: "12px",
            border: "1px solid var(--border-subtle)",
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  background: "var(--bg-elevated)",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <th
                  style={{
                    padding: "12px 16px",
                    textAlign: "left",
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontWeight: 600,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    width: "40%",
                  }}
                >
                  TỪ TIẾNG ANH
                </th>
                <th
                  style={{
                    padding: "12px 16px",
                    textAlign: "left",
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontWeight: 600,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                >
                  NGHĨA TIẾNG VIỆT
                </th>
              </tr>
            </thead>
            <tbody>
              {displayCards.map((card, i) => {
                const isHighlighted = highlightSet.has(card.word.toLowerCase());
                return (
                  <tr
                    key={card.id}
                    style={{
                      borderBottom:
                        i < displayCards.length - 1
                          ? "1px solid var(--border-subtle)"
                          : "none",
                      background: isHighlighted
                        ? "rgba(251, 191, 36, 0.05)"
                        : "transparent",
                      transition: "background 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background = isHighlighted
                        ? "rgba(251, 191, 36, 0.1)"
                        : "var(--bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background = isHighlighted
                        ? "rgba(251, 191, 36, 0.05)"
                        : "transparent";
                    }}
                  >
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {isHighlighted && (
                          <span style={{ fontSize: "0.75rem" }}>✨</span>
                        )}
                        <span
                          style={{
                            fontWeight: 600,
                            color: isHighlighted
                              ? "var(--highlight-word)"
                              : "var(--text-primary)",
                            fontSize: "0.95rem",
                          }}
                        >
                          {card.word}
                        </span>
                      </div>
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        color: "var(--text-secondary)",
                        fontSize: "0.9rem",
                      }}
                    >
                      {card.meaning}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Grid / Flip Card View */}
      {viewMode === "grid" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "12px",
          }}
        >
          {displayCards.map((card) => (
            <FlashcardItem
              key={card.id}
              card={card}
              highlight={highlightSet.has(card.word.toLowerCase())}
            />
          ))}
        </div>
      )}

      {/* Show more */}
      {cards.length > 12 && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="btn-secondary"
          style={{ alignSelf: "center" }}
        >
          {showAll ? "Thu gọn ↑" : `Xem thêm ${cards.length - 12} card ↓`}
        </button>
      )}
    </div>
  );
}
