import type { ParsedCard } from "./anki";
import type { ContextId, DialogueLevel } from "./gemini";

export interface HistoryEntry {
  id: string;
  deckName: string;
  cards: ParsedCard[];
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

export const historyStorage = {
  getAll(): HistoryEntry[] {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    } catch {
      return [];
    }
  },

  save(entry: Omit<HistoryEntry, "id" | "createdAt">): HistoryEntry {
    const newEntry: HistoryEntry = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const all = this.getAll();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([newEntry, ...all].slice(0, MAX_ENTRIES))
    );
    return newEntry;
  },

  updateTranscript(id: string, transcript: PracticeMessage[]) {
    const all = this.getAll();
    const updated = all.map((e) =>
      e.id === id ? { ...e, practiceTranscript: transcript } : e
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  },

  delete(id: string) {
    const all = this.getAll().filter((e) => e.id !== id);
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
