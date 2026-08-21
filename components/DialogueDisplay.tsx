"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { highlightWords } from "@/lib/gemini";
import { historyStorage } from "@/lib/history";
import type { VocabularyItem } from "@/lib/vocabulary/types";
import type { ContextId, DialogueLevel } from "@/lib/gemini";
import {
  SPEAKER_LABELS,
  scriptToMarkdown,
  type DialogueScript,
} from "@/lib/dialogue/types";
import { renderHighlightedHtml } from "@/lib/dialogue/words";
import { useSampleAudio } from "@/hooks/useSampleAudio";
import type { SampleAudioStatus } from "@/lib/sample-audio";

/**
 * Per-turn play control for the native sample.
 *
 * Four states rather than a button that appears out of nowhere: the learner
 * should be able to see that a line's audio is coming, has arrived, or failed
 * — the script is readable throughout either way.
 *
 * Every label names *which* line it belongs to. A dozen controls all reading
 * "Nghe giọng bản ngữ đọc câu này" is a list a screen-reader user cannot
 * navigate, and `title` alone explains nothing to one.
 */
function SampleAudioControl({
  status,
  isPlaying,
  speaker,
  turnNumber,
  onPlay,
}: {
  status: SampleAudioStatus;
  isPlaying: boolean;
  speaker: string;
  turnNumber: number;
  onPlay: () => void;
}) {
  const shared: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "22px",
    height: "22px",
    marginRight: "8px",
    verticalAlign: "middle",
    fontSize: "0.7rem",
    borderRadius: "50%",
    flexShrink: 0,
  };
  const which = `câu ${turnNumber} của ${speaker}`;

  if (status === "fetching") {
    return (
      <span
        style={{ ...shared, color: "var(--text-muted)" }}
        title={`Đang thu giọng mẫu cho ${which}…`}
        role="status"
        aria-label={`Đang thu giọng mẫu cho ${which}`}
      >
        <span
          className="spinner"
          style={{
            width: "12px",
            height: "12px",
            borderWidth: "2px",
            borderTopColor: "var(--text-muted)",
          }}
        />
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span
        style={{ ...shared, color: "var(--accent-amber)" }}
        title={`Không tạo được giọng mẫu cho ${which}. Kịch bản vẫn dùng bình thường.`}
        role="img"
        aria-label={`Không tạo được giọng mẫu cho ${which}`}
      >
        ⚠
      </span>
    );
  }

  if (status !== "ready") {
    // Idle: the slot is held so lines do not shift sideways when audio lands.
    return <span style={shared} aria-hidden="true" />;
  }

  const label = isPlaying
    ? `Dừng phát ${which}`
    : `Nghe giọng bản ngữ đọc ${which}`;

  return (
    <button
      onClick={onPlay}
      style={{
        ...shared,
        border: "1px solid var(--border-medium)",
        background: isPlaying ? "var(--accent-primary)" : "var(--bg-elevated)",
        color: isPlaying ? "white" : "var(--text-secondary)",
        cursor: "pointer",
        padding: 0,
      }}
      title={label}
      aria-label={label}
      aria-pressed={isPlaying}
    >
      {isPlaying ? "■" : "▶"}
    </button>
  );
}

interface DialogueDisplayProps {
  /** The structured script. `null` only for a legacy markdown entry. */
  script: DialogueScript | null;
  /** Markdown from a pre-Story-1.2 history entry; used when `script` is null. */
  legacyDialogue?: string;
  cards: VocabularyItem[];
  deckName: string;
  context: ContextId;
  level: DialogueLevel;
  onRegenerate?: () => void;
}

export default function DialogueDisplay({
  script,
  legacyDialogue,
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
  // Sample audio fills in behind the script — nothing here waits for it.
  const sampleAudio = useSampleAudio(script);

  const words = cards.map((c) => c.word);
  const dialogue = legacyDialogue ?? "";
  const plainText = script ? scriptToMarkdown(script) : dialogue;

  // ---- Legacy branch: entries stored as one markdown string, pre-Story 1.2.
  // Kept intact so old history entries never blank the screen.
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
    // A legacy entry is already in storage; only fresh scripts are ever saved.
    if (!script) return;
    const entry = historyStorage.save({ deckName, cards, context, level, script });
    setSaved(true);
    setSavedId(entry.id);
  }

  function handlePractice() {
    let id = savedId;
    if (!id) {
      if (!script) return;
      const entry = historyStorage.save({ deckName, cards, context, level, script });
      id = entry.id;
      setSaved(true);
      setSavedId(entry.id);
    }
    router.push(`/practice?id=${id}`);
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(plainText);
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

      {/* Storage notice. Said once, and never in place of the script: losing
          the audio must not cost the user the lines. */}
      {sampleAudio.notice && (
        <div
          style={{
            padding: "10px 14px",
            background: "rgba(245, 158, 11, 0.1)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            borderRadius: "10px",
            color: "var(--accent-amber)",
            fontSize: "0.8rem",
          }}
          role="status"
        >
          ⚠️ {sampleAudio.notice}
        </div>
      )}

      {/* Dialogue content */}
      <div
        className="card-elevated"
        style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "6px" }}
      >
        {script?.turns.map((turn) => {
          const isSystem = turn.speaker === "system";
          return (
            <div
              key={turn.index}
              className={`dialogue-line ${isSystem ? "dialogue-line-a" : "dialogue-line-b"}`}
            >
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  color: isSystem ? "var(--accent-primary)" : "var(--accent-secondary)",
                  letterSpacing: "0.05em",
                  marginRight: "8px",
                  textTransform: "uppercase",
                }}
              >
                {SPEAKER_LABELS[turn.speaker]}
              </span>
              <SampleAudioControl
                status={sampleAudio.statuses[turn.index] ?? "idle"}
                isPlaying={sampleAudio.playingTurn === turn.index}
                speaker={SPEAKER_LABELS[turn.speaker]}
                turnNumber={turn.index + 1}
                onPlay={() => sampleAudio.play(turn.index)}
              />
              <span
                style={{ color: "var(--text-primary)", lineHeight: 1.7 }}
                // Target words come from the turn's own data, not a substring
                // scan of the whole card list.
                dangerouslySetInnerHTML={{
                  __html: renderHighlightedHtml(turn.text, turn.targetWords),
                }}
              />
            </div>
          );
        })}

        {!script && parsedLines.map(({ line, isA, isB, isSection, key }) => {
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
