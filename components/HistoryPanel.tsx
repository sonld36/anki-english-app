"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  historyStorage,
  formatRelativeTime,
  type HistoryEntry,
} from "@/lib/history";
import { CONTEXTS } from "@/lib/gemini";

export default function HistoryPanel() {
  const router = useRouter();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setEntries(historyStorage.getAll());
    }
  }, [isOpen]);

  function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    historyStorage.delete(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function handleViewEntry(entry: HistoryEntry) {
    router.push(`/practice?id=${entry.id}`);
  }

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        className="btn-secondary"
        style={{ position: "relative" }}
        id="history-panel-btn"
        aria-label="Lịch sử hội thoại"
      >
        📚 Lịch sử
        {entries.length > 0 && (
          <span
            style={{
              position: "absolute",
              top: "-6px",
              right: "-6px",
              background: "var(--accent-primary)",
              color: "white",
              borderRadius: "50%",
              width: "18px",
              height: "18px",
              fontSize: "0.65rem",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {entries.length > 9 ? "9+" : entries.length}
          </span>
        )}
      </button>

      {/* Slide-over panel */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setIsOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.5)",
              zIndex: 40,
              backdropFilter: "blur(4px)",
            }}
          />

          {/* Panel */}
          <div
            className="slide-up"
            style={{
              position: "fixed",
              right: 0,
              top: 0,
              bottom: 0,
              width: "min(400px, 100vw)",
              background: "var(--bg-card)",
              borderLeft: "1px solid var(--border-medium)",
              zIndex: 50,
              display: "flex",
              flexDirection: "column",
              boxShadow: "-20px 0 60px rgba(0,0,0,0.4)",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid var(--border-subtle)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "var(--bg-elevated)",
              }}
            >
              <h3 style={{ fontWeight: 700, fontSize: "1rem" }}>📚 Lịch sử hội thoại</h3>
              <div style={{ display: "flex", gap: "8px" }}>
                {entries.length > 0 && (
                  <button
                    onClick={() => {
                      historyStorage.clear();
                      setEntries([]);
                    }}
                    className="btn-secondary"
                    style={{ padding: "6px 12px", fontSize: "0.75rem", color: "var(--text-muted)" }}
                  >
                    Xóa tất cả
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="btn-secondary"
                  style={{ padding: "6px 12px", fontSize: "0.8rem" }}
                  aria-label="Đóng"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Entry list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
              {entries.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    color: "var(--text-muted)",
                    padding: "48px 24px",
                  }}
                >
                  <div style={{ fontSize: "2.5rem", marginBottom: "12px" }}>📭</div>
                  <p>Chưa có lịch sử.</p>
                  <p style={{ fontSize: "0.8rem", marginTop: "4px" }}>
                    Sinh một hội thoại và nhấn Lưu!
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {entries.map((entry) => {
                    const ctx = CONTEXTS.find((c) => c.id === entry.context);
                    return (
                      <div
                        key={entry.id}
                        onClick={() => handleViewEntry(entry)}
                        className="card"
                        style={{
                          padding: "14px 16px",
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && handleViewEntry(entry)}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            gap: "8px",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>
                              {entry.deckName}
                            </div>
                            <div
                              style={{
                                fontSize: "0.75rem",
                                color: "var(--text-muted)",
                                marginTop: "2px",
                              }}
                            >
                              {ctx?.label ?? entry.context} · {entry.level} ·{" "}
                              {formatRelativeTime(entry.createdAt)}
                            </div>
                          </div>
                          <button
                            onClick={(e) => handleDelete(entry.id, e)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--text-muted)",
                              cursor: "pointer",
                              padding: "4px",
                              fontSize: "0.8rem",
                              flexShrink: 0,
                            }}
                            aria-label="Xóa"
                            title="Xóa"
                          >
                            ✕
                          </button>
                        </div>

                        {/* Word tags */}
                        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                          {entry.cards.slice(0, 5).map((c) => (
                            <span
                              key={c.id}
                              style={{
                                fontSize: "0.7rem",
                                padding: "2px 7px",
                                background: "var(--bg-elevated)",
                                borderRadius: "20px",
                                color: "var(--text-secondary)",
                                border: "1px solid var(--border-subtle)",
                              }}
                            >
                              {c.word}
                            </span>
                          ))}
                          {entry.cards.length > 5 && (
                            <span
                              style={{
                                fontSize: "0.7rem",
                                padding: "2px 7px",
                                color: "var(--text-muted)",
                              }}
                            >
                              +{entry.cards.length - 5}
                            </span>
                          )}
                        </div>

                        {entry.practiceTranscript && entry.practiceTranscript.length > 0 && (
                          <span className="badge badge-green" style={{ alignSelf: "flex-start" }}>
                            ✓ Đã luyện tập
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
