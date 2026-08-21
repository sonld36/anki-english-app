"use client";

import { useState } from "react";
import { CONTEXTS, type ContextId, type DialogueLevel } from "@/lib/gemini";
import type { VocabularyItem } from "@/lib/vocabulary/types";
import type { DialogueScript } from "@/lib/dialogue/types";
import { isDialogueScript } from "@/lib/dialogue/validate";

interface DialogueGeneratorProps {
  cards: VocabularyItem[];
  onDialogueGenerated: (
    script: DialogueScript,
    context: ContextId,
    level: DialogueLevel
  ) => void;
}

export default function DialogueGenerator({
  cards,
  onDialogueGenerated,
}: DialogueGeneratorProps) {
  const [context, setContext] = useState<ContextId>("cafe");
  const [level, setLevel] = useState<DialogueLevel>("B1");
  const [customContext, setCustomContext] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCount, setSelectedCount] = useState<number>(
    Math.min(cards.length, 10)
  );

  async function handleGenerate() {
    setError(null);
    setIsGenerating(true);

    try {
      const selectedCards = cards.slice(0, selectedCount);
      const res = await fetch("/api/dialogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: selectedCards,
          context: customContext || CONTEXTS.find((c) => c.id === context)?.description,
          level,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Generation failed");

      // A 200 body is still untrusted: a malformed script would throw inside
      // the parent's render, past this error state.
      if (!isDialogueScript(data?.script)) {
        throw new Error("Kịch bản trả về không hợp lệ. Bạn hãy thử lại.");
      }

      onDialogueGenerated(data.script, context, level);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setIsGenerating(false);
    }
  }

  const levels: DialogueLevel[] = ["A2", "B1", "B2"];

  return (
    <div
      className="card-elevated"
      style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ fontSize: "1.2rem" }}>✨</span>
        <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)" }}>
          Tạo Hội Thoại AI
        </h3>
      </div>

      {/* Word count slider */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <label style={{ fontSize: "0.875rem", color: "var(--text-secondary)", fontWeight: 500 }}>
            Số từ sử dụng
          </label>
          <span className="badge badge-purple">{selectedCount} từ</span>
        </div>
        <input
          type="range"
          min={3}
          max={Math.min(cards.length, 20)}
          value={selectedCount}
          onChange={(e) => setSelectedCount(Number(e.target.value))}
          style={{ width: "100%", accentColor: "var(--accent-primary)" }}
          aria-label="Số từ vựng để sử dụng trong hội thoại"
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)" }}>
          <span>3 từ</span>
          <span>{Math.min(cards.length, 20)} từ</span>
        </div>
      </div>

      {/* Context selector */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <label style={{ fontSize: "0.875rem", color: "var(--text-secondary)", fontWeight: 500 }}>
          Ngữ cảnh hội thoại
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {CONTEXTS.map((ctx) => (
            <button
              key={ctx.id}
              onClick={() => setContext(ctx.id)}
              className={`context-tab ${context === ctx.id ? "active" : ""}`}
              aria-pressed={context === ctx.id}
            >
              {ctx.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          className="input"
          placeholder="Hoặc nhập ngữ cảnh tùy chỉnh... (vd: job interview, hospital visit)"
          value={customContext}
          onChange={(e) => setCustomContext(e.target.value)}
          aria-label="Ngữ cảnh hội thoại tùy chỉnh"
        />
      </div>

      {/* Level selector */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <label style={{ fontSize: "0.875rem", color: "var(--text-secondary)", fontWeight: 500 }}>
          Trình độ
        </label>
        <div style={{ display: "flex", gap: "8px" }}>
          {levels.map((l) => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              className={`level-btn ${level === l ? "active" : ""}`}
              aria-pressed={level === l}
            >
              {l}
            </button>
          ))}
        </div>
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {level === "A2" && "Cơ bản — câu đơn giản, từ phổ biến"}
          {level === "B1" && "Trung cấp — ngữ pháp đa dạng, tự nhiên hơn"}
          {level === "B2" && "Khá — từ nâng cao, cấu trúc phức tạp"}
        </p>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "12px 16px",
            background: "rgba(244, 63, 94, 0.1)",
            border: "1px solid rgba(244, 63, 94, 0.3)",
            borderRadius: "10px",
            color: "var(--accent-rose)",
            fontSize: "0.875rem",
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={isGenerating || cards.length === 0}
        className="btn-primary"
        style={{ width: "100%" }}
        id="generate-dialogue-btn"
      >
        {isGenerating ? (
          <>
            <div className="spinner" />
            Đang sinh hội thoại...
          </>
        ) : (
          <>✨ Sinh Hội Thoại</>
        )}
      </button>
    </div>
  );
}
