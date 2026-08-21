import type { VocabularyItem } from "./vocabulary/types";
import type { ContextId, DialogueLevel } from "./gemini";

export interface HistoryEntry {
  id: string;
  deckName: string;
  cards: VocabularyItem[];
  context: ContextId;
  level: DialogueLevel;
  dialogue: string;
  practiceTranscript?: PracticeMessage[];
  createdAt: string;
}

export interface PracticeMessage {
  role: "ai" | "user";
  text: string;
  timestamp: string;
}

const STORAGE_KEY = "ankichat_history";
const MAX_ENTRIES = 50;

/**
 * What `localStorage` may actually hold. Entries written before the
 * vocabulary-source refactor carry a numeric `id` and the Anki model under
 * `modelName`, so the stored shape is wider than `HistoryEntry`.
 */
type StoredVocabularyItem = Omit<VocabularyItem, "id"> & {
  id: string | number;
  modelName?: string;
};

type StoredHistoryEntry = Omit<HistoryEntry, "cards"> & {
  cards: StoredVocabularyItem[];
};

function normalizeItem(item: StoredVocabularyItem): VocabularyItem {
  const ankiModelName = item?.ankiModelName ?? item?.modelName;
  return {
    id: String(item?.id ?? ""),
    word: item?.word ?? "",
    meaning: item?.meaning ?? "",
    ...(ankiModelName ? { ankiModelName } : {}),
  };
}

function normalizeEntry(entry: StoredHistoryEntry): HistoryEntry {
  return { ...entry, cards: (entry?.cards ?? []).map(normalizeItem) };
}

/**
 * Raw stored entries, un-normalized. Mutators read through this so that
 * rewriting the list (delete, transcript update) leaves untouched entries
 * exactly as they were on disk.
 */
function readRaw(): StoredHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const historyStorage = {
  getAll(): HistoryEntry[] {
    return readRaw().map(normalizeEntry);
  },

  save(entry: Omit<HistoryEntry, "id" | "createdAt">): HistoryEntry {
    const newEntry: HistoryEntry = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const all = readRaw();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([newEntry, ...all].slice(0, MAX_ENTRIES))
    );
    return newEntry;
  },

  updateTranscript(id: string, transcript: PracticeMessage[]) {
    const all = readRaw();
    const updated = all.map((e) =>
      e.id === id ? { ...e, practiceTranscript: transcript } : e
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  },

  delete(id: string) {
    const all = readRaw().filter((e) => e.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  },

  clear() {
    localStorage.removeItem(STORAGE_KEY);
  },
};

export function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  if (hours < 24) return `${hours} giờ trước`;
  return `${days} ngày trước`;
}
