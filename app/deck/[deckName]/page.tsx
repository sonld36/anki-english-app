"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getVocabularySource } from "@/lib/vocabulary/source";
import { type VocabularyItem } from "@/lib/vocabulary/types";
import { type ContextId, type DialogueLevel } from "@/lib/gemini";
import { type DialogueScript } from "@/lib/dialogue/types";
import FlashcardList from "@/components/FlashcardList";
import DialogueGenerator from "@/components/DialogueGenerator";
import DialogueDisplay from "@/components/DialogueDisplay";
import HistoryPanel from "@/components/HistoryPanel";

export default function DeckPage() {
  const params = useParams();
  const router = useRouter();
  const deckName = decodeURIComponent(params.deckName as string);

  const [cards, setCards] = useState<VocabularyItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [script, setScript] = useState<DialogueScript | null>(null);
  const [dialogueContext, setDialogueContext] = useState<ContextId>("cafe");
  const [dialogueLevel, setDialogueLevel] = useState<DialogueLevel>("B1");
  const [usedCards, setUsedCards] = useState<VocabularyItem[]>([]);

  useEffect(() => {
    loadCards();
  }, [deckName]);

  async function loadCards() {
    setIsLoading(true);
    setLoadError(null);
    try {
      const fetched = await getVocabularySource().fetchItems(deckName);
      setCards(fetched);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load cards");
    } finally {
      setIsLoading(false);
    }
  }

  function handleDialogueGenerated(
    generated: DialogueScript,
    ctx: ContextId,
    lvl: DialogueLevel
  ) {
    setScript(generated);
    setDialogueContext(ctx);
    setDialogueLevel(lvl);
    // Which words the script actually uses comes from the turns' own data —
    // never from a substring scan, which would match `cold` inside `colder`.
    const used = new Set(
      generated.turns.flatMap((turn) =>
        turn.targetWords.map((w) => w.trim().toLowerCase())
      )
    );
    setUsedCards(cards.filter((c) => used.has(c.word.trim().toLowerCase())));
    // Scroll to dialogue
    setTimeout(() => {
      document.getElementById("dialogue-section")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 100);
  }

  return (
    <main style={{ minHeight: "100vh", paddingBottom: "80px" }}>
      {/* Nav */}
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
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            onClick={() => router.push("/")}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "0.9rem",
              padding: "6px 10px",
              borderRadius: "8px",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.background = "none";
            }}
          >
            ← Trang chủ
          </button>
          <span style={{ color: "var(--border-medium)" }}>/</span>
          <span style={{ fontWeight: 700, fontSize: "0.95rem" }} className="heading-gradient">
            {deckName}
          </span>
        </div>
        <HistoryPanel />
      </nav>

      <div
        style={{
          maxWidth: "1100px",
          margin: "0 auto",
          padding: "32px 24px",
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gap: "28px",
          alignItems: "start",
        }}
      >
        {/* Left column: flashcards + dialogue */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Cards section */}
          <section>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "16px",
              }}
            >
              <h2 style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                📚 Flashcards
              </h2>
              {!isLoading && cards.length > 0 && (
                <span className="badge badge-blue">{cards.length} cards</span>
              )}
            </div>

            {isLoading && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="skeleton"
                    style={{ height: "44px", borderRadius: "8px" }}
                  />
                ))}
              </div>
            )}

            {loadError && (
              <div
                style={{
                  padding: "20px",
                  background: "rgba(244, 63, 94, 0.08)",
                  border: "1px solid rgba(244, 63, 94, 0.2)",
                  borderRadius: "12px",
                  color: "var(--accent-rose)",
                }}
              >
                <p style={{ fontWeight: 600, marginBottom: "8px" }}>⚠️ {loadError}</p>
                <button
                  onClick={loadCards}
                  className="btn-secondary"
                  style={{ fontSize: "0.85rem" }}
                >
                  Thử lại
                </button>
              </div>
            )}

            {!isLoading && !loadError && (
              <FlashcardList
                cards={cards}
                highlightedWords={usedCards.map((c) => c.word)}
              />
            )}
          </section>

          {/* Dialogue section */}
          {script && (
            <section id="dialogue-section" className="fade-in">
              <DialogueDisplay
                script={script}
                cards={usedCards.length > 0 ? usedCards : cards.slice(0, 10)}
                deckName={deckName}
                context={dialogueContext}
                level={dialogueLevel}
                onRegenerate={() => setScript(null)}
              />
            </section>
          )}
        </div>

        {/* Right column: generator (sticky) */}
        <div style={{ position: "sticky", top: "80px" }}>
          {isLoading ? (
            <div
              className="skeleton card-elevated"
              style={{ height: "400px" }}
            />
          ) : cards.length > 0 ? (
            <DialogueGenerator
              cards={cards}
              onDialogueGenerated={handleDialogueGenerated}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
