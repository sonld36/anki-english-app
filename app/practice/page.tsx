"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { historyStorage, type HistoryEntry } from "@/lib/history";
import VoicePractice from "@/components/VoicePractice";

function PracticeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  const [entry, setEntry] = useState<HistoryEntry | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) {
      setNotFound(true);
      return;
    }
    const all = historyStorage.getAll();
    const found = all.find((e) => e.id === id);
    if (found) {
      setEntry(found);
    } else {
      setNotFound(true);
    }
  }, [id]);

  if (notFound) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          color: "var(--text-muted)",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <div style={{ fontSize: "3rem" }}>🔍</div>
        <h2 style={{ fontWeight: 700, color: "var(--text-secondary)" }}>
          Không tìm thấy hội thoại
        </h2>
        <p style={{ fontSize: "0.875rem" }}>
          Hội thoại này không còn trong lịch sử.
        </p>
        <button onClick={() => router.push("/")} className="btn-primary">
          ← Về trang chủ
        </button>
      </div>
    );
  }

  if (!entry) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ textAlign: "center", color: "var(--text-muted)" }}>
          <div className="spinner" style={{ margin: "0 auto 12px" }} />
          <p>Đang tải...</p>
        </div>
      </div>
    );
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Nav */}
      <nav
        style={{
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--border-subtle)",
          background: "rgba(10, 10, 20, 0.85)",
          backdropFilter: "blur(12px)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            onClick={() => router.push(`/deck/${encodeURIComponent(entry.deckName)}`)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "0.875rem",
              padding: "6px 10px",
              borderRadius: "8px",
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) =>
              ((e.target as HTMLElement).style.background = "var(--bg-hover)")
            }
            onMouseLeave={(e) =>
              ((e.target as HTMLElement).style.background = "none")
            }
          >
            ← Kịch bản
          </button>
          <span style={{ color: "var(--border-medium)" }}>/</span>
          <span className="heading-gradient" style={{ fontWeight: 700 }}>
            🎙️ Luyện tập
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="badge badge-purple">{entry.level}</span>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            {entry.deckName}
          </span>
        </div>
      </nav>

      {/* Practice content */}
      <div style={{ flex: 1, padding: "20px 24px", overflow: "hidden" }}>
        <VoicePractice entry={entry} onBack={() => router.back()} />
      </div>
    </main>
  );
}

export default function PracticePage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div className="spinner" />
        </div>
      }
    >
      <PracticeContent />
    </Suspense>
  );
}
