import type { ParsedCard } from "./anki";

export type DialogueLevel = "A2" | "B1" | "B2";

export const CONTEXTS = [
  { id: "cafe", label: "☕ Cafe", description: "Coffee shop conversation" },
  { id: "office", label: "💼 Công sở", description: "Workplace discussion" },
  { id: "travel", label: "✈️ Du lịch", description: "Travel & tourism" },
  { id: "home", label: "🏠 Hằng ngày", description: "Everyday life" },
  { id: "study", label: "📚 Học tập", description: "Academic discussion" },
  { id: "restaurant", label: "🍜 Nhà hàng", description: "Dining out" },
] as const;

export type ContextId = (typeof CONTEXTS)[number]["id"];

export async function generateDialogue(
  cards: ParsedCard[],
  context: ContextId,
  level: DialogueLevel = "B1",
  customContext?: string
): Promise<string> {
  const contextLabel = CONTEXTS.find((c) => c.id === context)?.description ?? context;
  const finalContext = customContext || contextLabel;

  const res = await fetch("/api/dialogue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cards, context: finalContext, level }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Failed to generate dialogue");
  }

  const data = await res.json();
  return data.dialogue as string;
}

// Highlight target words in a text by wrapping them in <mark> tags
export function highlightWords(text: string, words: string[]): string {
  if (!words.length) return text;
  const pattern = words
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const regex = new RegExp(`\\b(${pattern})\\b`, "gi");
  return text.replace(regex, '<mark class="word-highlight">$1</mark>');
}
