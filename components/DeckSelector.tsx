"use client";

import { useState, useEffect } from "react";
import { getVocabularySource } from "@/lib/vocabulary/source";
import { parseSetupHintStep } from "@/lib/vocabulary/setup-hint";
import type { VocabularyCollection } from "@/lib/vocabulary/types";

// Render one setup-hint step: `**text**` is emphasised, `` `text` `` is a
// code chip. Parsing lives in lib/vocabulary/setup-hint.ts; this only maps
// the parsed segments onto elements.
function renderStep(step: string) {
  return parseSetupHintStep(step).map((segment, i) => {
    if (segment.strong) return <strong key={i}>{segment.text}</strong>;
    if (segment.code) {
      return (
        <code
          key={i}
          style={{ background: "var(--bg-elevated)", padding: "1px 6px", borderRadius: "4px" }}
        >
          {segment.text}
        </code>
      );
    }
    return <span key={i}>{segment.text}</span>;
  });
}

interface DeckSelectorProps {
  onSelectDeck: (deckName: string) => void;
  selectedDeck: string | null;
}

export default function DeckSelector({ onSelectDeck, selectedDeck }: DeckSelectorProps) {
  // Resolved per render rather than at module scope: a throw here is
  // catchable by an error boundary instead of blanking the page at import
  // time, and the choice isn't pinned for the process lifetime. The
  // registry returns a singleton, so the identity is stable across renders.
  const source = getVocabularySource();

  const [decks, setDecks] = useState<VocabularyCollection[]>([]);
  const [status, setStatus] = useState<"checking" | "connected" | "error">("checking");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    loadCollections();
  }, []);

  // Re-resolves the source instead of closing over the `source` above, so
  // this captures no reactive value and the mount effect needs no deps.
  async function loadCollections() {
    setStatus("checking");
    try {
      setDecks(await getVocabularySource().listCollections());
      setStatus("connected");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Connection failed");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Connection status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "12px 16px",
          background: "var(--bg-elevated)",
          borderRadius: "12px",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <span
          className={`status-dot ${status}`}
        />
        <span style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
          {status === "checking" && `Đang kiểm tra kết nối ${source.label}...`}
          {status === "connected" && (
            <span>
              Đã kết nối {source.label}{" "}
              <span style={{ color: "var(--accent-green)" }}>
                — {decks.length} deck
              </span>
            </span>
          )}
          {status === "error" && (
            <span style={{ color: "var(--accent-rose)" }}>
              {errorMsg}
            </span>
          )}
        </span>
        {status === "error" && (
          <button
            onClick={loadCollections}
            className="btn-secondary"
            style={{ marginLeft: "auto", padding: "6px 14px", fontSize: "0.8rem" }}
          >
            Thử lại
          </button>
        )}
      </div>

      {/* Deck selector */}
      {status === "connected" && decks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label style={{ fontSize: "0.875rem", color: "var(--text-secondary)", fontWeight: 500 }}>
            Chọn Deck {source.label}
          </label>
          <select
            className="input"
            value={selectedDeck ?? ""}
            onChange={(e) => {
              if (e.target.value) onSelectDeck(e.target.value);
            }}
          >
            <option value="">— Chọn một deck —</option>
            {decks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Error help — a source without a setupHint still gets a recovery
          message rather than an empty screen. */}
      {status === "error" && (
        <div
          style={{
            padding: "16px",
            background: "rgba(244, 63, 94, 0.08)",
            border: "1px solid rgba(244, 63, 94, 0.2)",
            borderRadius: "12px",
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
            lineHeight: 1.7,
          }}
        >
          <strong style={{ color: "var(--accent-rose)", display: "block", marginBottom: "8px" }}>
            💡 {source.setupHint?.title ?? `Không kết nối được ${source.label}`}
          </strong>
          {source.setupHint ? (
            <ol style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "4px" }}>
              {source.setupHint.steps.map((step, i) => (
                <li key={i}>{renderStep(step)}</li>
              ))}
            </ol>
          ) : (
            <p>
              Không nạp được danh sách deck từ {source.label}. Hãy kiểm tra lại nguồn từ
              vựng rồi bấm <strong>Thử lại</strong>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
