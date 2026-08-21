import { describe, expect, it } from "vitest";
import {
  SPEAKER_LABELS,
  scriptTargetWords,
  scriptToMarkdown,
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
