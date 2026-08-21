import { describe, expect, it } from "vitest";
import {
  DIALOGUE_SCRIPT_VERSION,
  ALLOWED_VOICES,
  SPEAKER_LABELS,
  SPEAKER_VOICES,
  SUPPORTED_SCRIPT_VERSIONS,
  hasHints,
  scriptTargetWords,
  scriptToMarkdown,
  turnHasHints,
  type DialogueScript,
} from "./types";

const SCRIPT: DialogueScript = {
  version: 2,
  turns: [
    { index: 0, speaker: "system", text: "It is cold today.", targetWords: ["cold"] },
    {
      index: 1,
      speaker: "learner",
      text: "Yes, the weather turned cold fast.",
      targetWords: ["weather", "cold"],
    },
    { index: 2, speaker: "system", text: "Bring a coat.", targetWords: [] },
  ],
};

describe("scriptToMarkdown", () => {
  it("labels every turn by speaker, one line each", () => {
    // The bridge to the Live system prompt and the clipboard: if the labels
    // or the shape drift, both silently change.
    expect(scriptToMarkdown(SCRIPT)).toBe(
      [
        `**${SPEAKER_LABELS.system}:** It is cold today.`,
        `**${SPEAKER_LABELS.learner}:** Yes, the weather turned cold fast.`,
        `**${SPEAKER_LABELS.system}:** Bring a coat.`,
      ].join("\n")
    );
  });

  it("pins the speaker labels themselves", () => {
    expect(SPEAKER_LABELS).toEqual({ system: "Sam", learner: "Alex" });
    expect(scriptToMarkdown(SCRIPT)).toContain("**Sam:** It is cold today.");
    expect(scriptToMarkdown(SCRIPT)).toContain("**Alex:** Yes,");
  });

  it("returns an empty string for a script with no turns", () => {
    expect(scriptToMarkdown({ version: 2, turns: [] })).toBe("");
  });
});

describe("scriptTargetWords", () => {
  it("collects distinct words in first-appearance order", () => {
    expect(scriptTargetWords(SCRIPT)).toEqual(["cold", "weather"]);
  });

  it("deduplicates case-insensitively and trims", () => {
    const script: DialogueScript = {
      version: 2,
      turns: [
        { index: 0, speaker: "system", text: "a", targetWords: ["  Cold ", "cold"] },
        { index: 1, speaker: "learner", text: "b", targetWords: ["COLD", ""] },
      ],
    };
    expect(scriptTargetWords(script)).toEqual(["Cold"]);
  });

  it("returns [] when no turn carries a target word", () => {
    expect(
      scriptTargetWords({
        version: 2,
        turns: [{ index: 0, speaker: "system", text: "Hi.", targetWords: [] }],
      })
    ).toEqual([]);
  });
});

describe("hasHints", () => {
  it("is false for a script stored before hints existed", () => {
    // SCRIPT is a version 2 script: structured, but no ladder anywhere.
    expect(hasHints(SCRIPT)).toBe(false);
  });

  it("is true once a learner turn carries a ladder", () => {
    const withHints: DialogueScript = {
      version: 3,
      turns: [
        ...SCRIPT.turns.slice(0, 1),
        {
          ...SCRIPT.turns[1],
          hints: {
            situation: "Khi bạn đồng tình với nhận xét của người kia.",
            keywords: ["weather", "changed"],
          },
        },
        ...SCRIPT.turns.slice(2),
      ],
    };
    expect(hasHints(withHints)).toBe(true);
  });

  it("ignores hints that somehow sit on a system turn", () => {
    // Those are a validation failure, not a usable ladder: the learner never
    // has to produce a system line, so they must not make the script look
    // hinted to Story 2.4's UI.
    const stray: DialogueScript = {
      version: 3,
      turns: [
        {
          ...SCRIPT.turns[0],
          hints: { situation: "Khi bạn mở lời.", keywords: ["cold"] },
        },
        ...SCRIPT.turns.slice(1),
      ],
    };
    expect(hasHints(stray)).toBe(false);
  });
});

describe("script versions", () => {
  it("keeps the version being written among the versions that can be read", () => {
    // Two independent declarations. Bump one without the other and
    // `isDialogueScript` rejects scripts the app itself just wrote: every
    // entry saved afterwards would silently fail to load.
    expect(SUPPORTED_SCRIPT_VERSIONS).toContain(DIALOGUE_SCRIPT_VERSION);
  });
});

describe("turnHasHints", () => {
  it("is false for a ladder with nothing in it", () => {
    // The accept-with-faulty-hints path can genuinely ship this shape, and a
    // UI that trusts `turn.hints` alone would open an empty panel.
    expect(
      turnHasHints({
        index: 0,
        speaker: "learner",
        text: "Yes.",
        targetWords: [],
        hints: { situation: "   ", keywords: ["  "] },
      })
    ).toBe(false);
  });

  it("is true once both rungs carry something", () => {
    expect(
      turnHasHints({
        index: 0,
        speaker: "learner",
        text: "Yes.",
        targetWords: [],
        hints: { situation: "Khi bạn đồng ý.", keywords: ["yes"] },
      })
    ).toBe(true);
  });
});

describe("SPEAKER_VOICES", () => {
  it("gives the two roles two different voices", () => {
    // One voice reading both parts removes the only cue that separates the
    // roles by ear — which is the whole point of generating samples at all.
    expect(SPEAKER_VOICES.system).not.toBe(SPEAKER_VOICES.learner);
  });

  it("uses en-US voices for both roles", () => {
    for (const voice of Object.values(SPEAKER_VOICES)) {
      expect(voice.startsWith("en-US-")).toBe(true);
    }
  });

  it("allows exactly the voices the roles use", () => {
    // The TTS route checks the request against this list; a voice the app
    // itself asks for and the route rejects would fail every sample silently.
    expect([...ALLOWED_VOICES].sort()).toEqual(
      Object.values(SPEAKER_VOICES).sort()
    );
  });
});
