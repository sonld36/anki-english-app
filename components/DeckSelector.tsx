"use client";

import { useState, useEffect } from "react";

interface DeckSelectorProps {
  onSelectDeck: (deckName: string) => void;
  selectedDeck: string | null;
}

export default function DeckSelector({ onSelectDeck, selectedDeck }: DeckSelectorProps) {
  const [decks, setDecks] = useState<string[]>([]);
  const [status, setStatus] = useState<"checking" | "connected" | "error">("checking");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    checkAnkiConnection();
  }, []);

  async function checkAnkiConnection() {
    setStatus("checking");
    try {
      const res = await fetch("/api/anki", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deckNames" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDecks(data.result as string[]);
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
          {status === "checking" && "Đang kiểm tra kết nối Anki..."}
          {status === "connected" && (
            <span>
              Đã kết nối Anki{" "}
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
            onClick={checkAnkiConnection}
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
            Chọn Deck Anki
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
              <option key={deck} value={deck}>
                {deck}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Error help */}
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
            💡 Hướng dẫn kết nối Anki
          </strong>
          <ol style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "4px" }}>
            <li>Mở ứng dụng <strong>Anki</strong> trên máy tính</li>
            <li>Cài addon <strong>AnkiConnect</strong> (code: <code style={{ background: "var(--bg-elevated)", padding: "1px 6px", borderRadius: "4px" }}>2055492159</code>)</li>
            <li>Restart Anki và thử lại</li>
          </ol>
        </div>
      )}
    </div>
  );
}
