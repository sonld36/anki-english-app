import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { historyStorage } from "./history";
import type { DialogueScript } from "./dialogue/types";

/**
 * The riskiest edit in Story 1.2: entries written before it hold `dialogue` as
 * one markdown string. They must keep loading, and must not be rewritten.
 */

const STORAGE_KEY = "ankichat_history";

let store: Record<string, string> = {};

function seed(entries: unknown[]) {
  store[STORAGE_KEY] = JSON.stringify(entries);
}

function raw(): string {
  return store[STORAGE_KEY];
}

const SCRIPT: DialogueScript = {
  version: 2,
  turns: [
    { index: 0, speaker: "system", text: "It is cold today.", targetWords: ["cold"] },
    { index: 1, speaker: "learner", text: "Yes, very much so.", targetWords: [] },
  ],
};

const LEGACY_ENTRY = {
  id: "legacy-1",
  deckName: "Core 1000",
  cards: [{ id: 42, word: "cold", meaning: "lạnh", modelName: "Basic" }],
  context: "cafe",
  level: "B1",
  dialogue: "**A (Alex):** It is cold today.\n**B (Sam):** Yes, very much so.",
  createdAt: "2026-08-01T10:00:00.000Z",
};

beforeEach(() => {
  store = {};
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  });
  vi.stubGlobal("crypto", { randomUUID: () => "new-id" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("historyStorage — legacy markdown entries", () => {
  it("normalizes a pre-Story-1.2 entry into a null script plus its markdown", () => {
    seed([LEGACY_ENTRY]);

    const [entry] = historyStorage.getAll();

    expect(entry.script).toBeNull();
    expect(entry.legacyDialogue).toBe(LEGACY_ENTRY.dialogue);
    // Story 1.1's normalization still applies on the same read.
    expect(entry.cards).toEqual([
      { id: "42", word: "cold", meaning: "lạnh", ankiModelName: "Basic" },
    ]);
  });

  it("never rewrites an untouched legacy entry when the list is mutated", () => {
    seed([LEGACY_ENTRY, { ...LEGACY_ENTRY, id: "legacy-2" }]);
    const before = JSON.parse(raw())[0];

    historyStorage.delete("legacy-2");

    expect(JSON.parse(raw())[0]).toEqual(before);
  });

  it("survives an entry with no dialogue field at all", () => {
    const noDialogue: Record<string, unknown> = { ...LEGACY_ENTRY };
    delete noDialogue.dialogue;
    seed([noDialogue]);

    const [entry] = historyStorage.getAll();

    expect(entry.script).toBeNull();
    expect(entry.legacyDialogue).toBe("");
  });
});

describe("historyStorage — garbage in storage", () => {
  it("skips elements that cannot be presented as an entry", () => {
    // Without the guard these normalize into objects with no `id`, which reach
    // `key={entry.id}` and navigate to /practice?id=undefined.
    seed([null, "a string", [], { nope: true }, { id: "" }, LEGACY_ENTRY]);

    const entries = historyStorage.getAll();

    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("legacy-1");
    expect(entries.every((e) => typeof e.id === "string" && e.id.length > 0)).toBe(true);
  });

  it("skips an entry missing createdAt", () => {
    const noCreatedAt: Record<string, unknown> = { ...LEGACY_ENTRY };
    delete noCreatedAt.createdAt;
    seed([noCreatedAt]);

    expect(historyStorage.getAll()).toHaveLength(0);
  });

  it("leaves unrecognised elements on disk rather than dropping them", () => {
    seed([null, LEGACY_ENTRY, { ...LEGACY_ENTRY, id: "legacy-2" }]);

    historyStorage.delete("legacy-2");

    // Read hides it; storage keeps it. Never rewrite what we did not understand.
    expect(JSON.parse(raw())).toEqual([null, LEGACY_ENTRY]);
  });
});

describe("historyStorage — schema version 2 entries", () => {
  it("round-trips a saved script and leaves no legacy field", () => {
    const saved = historyStorage.save({
      deckName: "Core 1000",
      cards: [{ id: "1", word: "cold", meaning: "lạnh" }],
      context: "cafe",
      level: "B1",
      script: SCRIPT,
    });

    const [entry] = historyStorage.getAll();

    expect(entry.id).toBe(saved.id);
    expect(entry.script).toEqual(SCRIPT);
    expect(entry.legacyDialogue).toBeUndefined();
    expect(raw()).not.toContain('"dialogue"');
  });

  it("falls back to the legacy branch if a stored script is malformed", () => {
    seed([{ ...LEGACY_ENTRY, script: { version: 2, turns: [{ speaker: "ghost" }] } }]);

    const [entry] = historyStorage.getAll();

    expect(entry.script).toBeNull();
    expect(entry.legacyDialogue).toBe(LEGACY_ENTRY.dialogue);
  });

  it("keeps mixed old and new entries in one list", () => {
    historyStorage.save({
      deckName: "Core 1000",
      cards: [],
      context: "cafe",
      level: "B1",
      script: SCRIPT,
    });
    seed([...JSON.parse(raw()), LEGACY_ENTRY]);

    const entries = historyStorage.getAll();

    expect(entries).toHaveLength(2);
    expect(entries[0].script).toEqual(SCRIPT);
    expect(entries[1].script).toBeNull();
    expect(entries[1].legacyDialogue).toBe(LEGACY_ENTRY.dialogue);
  });
});
