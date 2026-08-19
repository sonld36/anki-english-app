"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { highlightWords } from "@/lib/gemini";
import { historyStorage } from "@/lib/history";
import type { ParsedCard } from "@/lib/anki";
import type { ContextId, DialogueLevel } from "@/lib/gemini";

interface DialogueDisplayProps {
  dialogue: string;
  cards: ParsedCard[];
  deckName: string;
  context: ContextId;
  level: DialogueLevel;
  onRegenerate?: () => void;
}

export default function DialogueDisplay({
  dialogue,
  cards,
  deckName,
  context,
  level,
  onRegenerate,
}: DialogueDisplayProps) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const words = cards.map((c) => c.word);
  const highlightedHtml = highlightWords(dialogue, words);

  // Parse dialogue into lines
  const parseDialogue = (text: string) => {
    const lines = text.split("\n").filter((l) => l.trim());
    return lines.map((line, i) => {
      const isA = /^\*\*A\b/.test(line) || /^A\s*[\(:]/i.test(line);
      const isB = /^\*\*B\b/.test(line) || /^B\s*[\(:]/i.test(line);
      const isSection = line.startsWith("##") || line.startsWith("#");
      return { line, isA, isB, isSection, key: i };
    });
  };

  const parsedLines = parseDialogue(dialogue);

  function renderLine(raw: string): { __html: string } {
    // Apply word highlighting
    const highlighted = highlightWords(raw, words);
    // Convert **bold** to <strong>
    const withBold = highlighted.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    return { __html: withBold };
  }

  function handleSave() {
    if (saved && savedId) {
      // Navigate to practice with existing saved entry
      router.push(`/practice?id=${savedId}`);
      return;
    }
    const entry = historyStorage.save({ deckName, cards, context, level, dialogue });
    setSaved(true);
    setSavedId(entry.id);
  }

  function handlePractice() {
    let id = savedId;
    if (!id) {
      const entry = historyStorage.save({ deckName, cards, context, level, dialogue });
      id = entry.id;
      setSaved(true);
      setSavedId(entry.id);
    }
    router.push(`/practice?id=${id}`);
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(dialogue);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }

  return (
    <div
      className="fade-in"
      style={{ display: "flex", flexDirection: "column", gap: "20px" }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 700 }}>💬 Kịch bản hội thoại</h3>
          <span className="badge badge-purple">{level}</span>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={handleCopy}
            className="btn-secondary"
            style={{ padding: "8px 14px", fontSize: "0.8rem" }}
            title="Copy nội dung"
          >
            {isCopied ? "✓ Đã copy" : "📋 Copy"}
          </button>
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              className="btn-secondary"
              style={{ padding: "8px 14px", fontSize: "0.8rem" }}
              title="Sinh lại hội thoại mới"
            >
              🔄 Sinh lại
            </button>
          )}
        </div>
      </div>

      {/* Dialogue content */}
      <div
        className="card-elevated"
        style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "6px" }}
      >
        {parsedLines.map(({ line, isA, isB, isSection, key }) => {
          if (isSection) {
            return (
              <div
                key={key}
                style={{
                  marginTop: "20px",
                  marginBottom: "8px",
                  fontSize: "0.9rem",
                  fontWeight: 700,
                  color: "var(--accent-amber)",
                  borderTop: "1px solid var(--border-subtle)",
                  paddingTop: "16px",
                }}
                dangerouslySetInnerHTML={renderLine(line.replace(/^#+\s*/, ""))}
              />
            );
          }

          if (isA || isB) {
            return (
              <div
                key={key}
                className={`dialogue-line ${isA ? "dialogue-line-a" : "dialogue-line-b"}`}
              >
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    color: isA ? "var(--accent-primary)" : "var(--accent-secondary)",
                    letterSpacing: "0.05em",
                    marginRight: "8px",
                    textTransform: "uppercase",
                  }}
                >
                  {isA ? "Alex" : "Sam"}
                </span>
                <span
                  style={{ color: "var(--text-primary)", lineHeight: 1.7 }}
                  dangerouslySetInnerHTML={renderLine(
                    line.replace(/^\*\*[AB]\s*\([^)]*\)\*\*:\s*/, "").replace(/^\*\*[AB]\*\*:\s*/, "")
                  )}
                />
              </div>
            );
          }

          // Generic line (descriptions, vocab notes, etc)
          if (line.trim()) {
            return (
              <p
                key={key}
                style={{
                  fontSize: "0.875rem",
                  color: "var(--text-secondary)",
                  lineHeight: 1.7,
                  marginTop: "4px",
                }}
                dangerouslySetInnerHTML={renderLine(line)}
              />
            );
          }
          return null;
        })}
      </div>

      {/* Word count summary */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          padding: "12px 16px",
          background: "var(--bg-elevated)",
          borderRadius: "10px",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginRight: "4px" }}>
          Từ vựng:
        </span>
        {words.map((word) => (
          <span key={word} className="word-highlight" style={{ fontSize: "0.8rem" }}>
            {word}
          </span>
        ))}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "12px" }}>
        <button
          onClick={handleSave}
          className="btn-secondary"
          style={{ flex: 1 }}
          disabled={saved}
        >
          {saved ? "✓ Đã lưu" : "💾 Lưu hội thoại"}
        </button>
        <button
          onClick={handlePractice}
          className="btn-primary"
          style={{ flex: 2 }}
          id="start-practice-btn"
        >
          🎙️ Luyện Tập Bằng Giọng Nói →
        </button>
      </div>
    </div>
  );
}
