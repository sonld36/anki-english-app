import type {
  VocabularyCollection,
  VocabularyItem,
  VocabularySource,
} from "../types";

// AnkiConnect API types — module-private, none of it leaks past `ankiSource`.
interface AnkiCard {
  cardId: number;
  fields: Record<string, { value: string; order: number }>;
  modelName: string;
  deckName: string;
  question: string;
  answer: string;
  interval: number;
  reps: number;
  lapses: number;
  type: number; // 0=new, 1=learning, 2=review
}

// Call Next.js API proxy for AnkiConnect (avoids CORS)
async function callAnki(action: string, params?: object): Promise<unknown> {
  const res = await fetch("/api/anki", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, params }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error ?? "AnkiConnect error");
  }
  return data.result;
}

const ankiApi = {
  // Get list of all deck names
  getDeckNames: (): Promise<string[]> =>
    callAnki("deckNames") as Promise<string[]>,

  // Find card IDs in a deck
  findCards: (deckName: string): Promise<number[]> =>
    callAnki("findCards", {
      query: `deck:"${deckName}"`,
    }) as Promise<number[]>,

  // Get full card info
  getCardsInfo: (cardIds: number[]): Promise<AnkiCard[]> =>
    callAnki("cardsInfo", { cards: cardIds }) as Promise<AnkiCard[]>,
};

// Strip HTML tags from Anki field values
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Parse a raw AnkiCard into a neutral VocabularyItem
function parseCard(card: AnkiCard): VocabularyItem {
  const fields = card.fields;

  // Try common field name patterns
  const frontKey =
    Object.keys(fields).find((k) =>
      ["Front", "front", "Word", "word", "English", "Expression"].includes(k)
    ) ?? Object.keys(fields)[0];

  const backKey =
    Object.keys(fields).find((k) =>
      ["Back", "back", "Meaning", "meaning", "Vietnamese", "Reading", "Definition"].includes(k)
    ) ?? Object.keys(fields)[1];

  return {
    id: String(card.cardId),
    word: stripHtml(fields[frontKey]?.value ?? ""),
    meaning: stripHtml(fields[backKey]?.value ?? ""),
    ankiModelName: card.modelName,
  };
}

// Batch fetch cards from a deck (max 200 at a time)
async function fetchDeckCards(deckName: string): Promise<VocabularyItem[]> {
  const cardIds = await ankiApi.findCards(deckName);
  if (cardIds.length === 0) return [];

  // Limit to 200 cards for MVP performance
  const ids = cardIds.slice(0, 200);
  const batchSize = 100;
  const batches: AnkiCard[] = [];

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = await ankiApi.getCardsInfo(ids.slice(i, i + batchSize));
    batches.push(...batch);
  }

  return batches.map(parseCard).filter((c) => c.word && c.meaning);
}

export const ankiSource: VocabularySource = {
  id: "anki",
  label: "Anki",
  setupHint: {
    title: "Hướng dẫn kết nối Anki",
    steps: [
      "Mở ứng dụng **Anki** trên máy tính",
      "Cài addon **AnkiConnect** (code: `2055492159`)",
      "Restart Anki và thử lại",
    ],
  },

  async listCollections(): Promise<VocabularyCollection[]> {
    const names = await ankiApi.getDeckNames();
    return names.map((name) => ({ id: name, name }));
  },

  fetchItems(collectionId: string): Promise<VocabularyItem[]> {
    return fetchDeckCards(collectionId);
  },
};
