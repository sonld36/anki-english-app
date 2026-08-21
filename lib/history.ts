import type { VocabularyItem } from "./vocabulary/types";
import type { ContextId, DialogueLevel } from "./gemini";
import type { DialogueScript } from "./dialogue/types";
import { isDialogueScript } from "./dialogue/validate";

export interface HistoryEntry {
  id: string;
  deckName: string;
  cards: VocabularyItem[];
  context: ContextId;
  level: DialogueLevel;
  /** The structured script (schema version 2), or `null` for a legacy entry. */
  script: DialogueScript | null;
  /**
   * The markdown blob entries carried before Story 1.2. Present only when
   * `script` is `null`, so consumers branch on `script` and fall back here.
   * Never written by `save` — it exists to keep old entries renderable.
   */
  legacyDialogue?: string;
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

type StoredHistoryEntry = Omit<
  HistoryEntry,
  "cards" | "script" | "legacyDialogue"
> & {
  cards: StoredVocabularyItem[];
  /** Schema version 2, written since Story 1.2. */
  script?: DialogueScript;
  /** Schema version 1: one markdown string. Read-only, never written again. */
  dialogue?: string;
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

/**
 * Is this stored element something we can safely present as a `HistoryEntry`?
 *
 * Without this, a `null` or garbage array element normalizes into an object
 * with no `id` that TypeScript believes is complete — it reaches
 * `HistoryPanel`'s `key={entry.id}` and navigates to `/practice?id=undefined`.
 * Skipped on read only: `readRaw` stays raw, so nothing unrecognised is
 * rewritten or dropped from disk.
 */
function isStoredEntry(value: unknown): value is StoredHistoryEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const entry = value as { id?: unknown; createdAt?: unknown };
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.createdAt === "string"
  );
}

function normalizeEntry(entry: StoredHistoryEntry): HistoryEntry {
  const { cards, script, dialogue, ...rest } = entry;
  const normalizedScript = isDialogueScript(script) ? script : null;
  return {
    ...rest,
    cards: (cards ?? []).map(normalizeItem),
    script: normalizedScript,
    // A legacy entry keeps its markdown so the old renderer can still show it.
    ...(normalizedScript
      ? {}
      : { legacyDialogue: typeof dialogue === "string" ? dialogue : "" }),
  };
}

/**
 * Raw stored entries, un-normalized. Mutators read through this so that
 * rewriting the list (delete, transcript update) leaves untouched entries
 * exactly as they were on disk.
 */
function readRaw(): unknown[] {
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
    return readRaw().filter(isStoredEntry).map(normalizeEntry);
  },

  /**
   * Only schema-version-2 entries are ever written. The legacy markdown shape
   * is read-only by design, so it is not expressible here.
   */
  save(
    entry: Omit<HistoryEntry, "id" | "createdAt" | "legacyDialogue"> & {
      script: DialogueScript;
    }
  ): HistoryEntry {
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
      isStoredEntry(e) && e.id === id
        ? { ...e, practiceTranscript: transcript }
        : e
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  },

  delete(id: string) {
    const all = readRaw().filter((e) => !(isStoredEntry(e) && e.id === id));
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
