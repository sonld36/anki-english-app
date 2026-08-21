// Structured dialogue-script types — no transport, no model-specific shapes.
// Safe to import from both server and client code.
//
// Mirrors `lib/vocabulary/types.ts`: the contract lives in one neutral module
// so the API route, the validator and the UI all agree on one shape.

/**
 * Who owns a turn. Two roles, not two names: DESIGN.md renders system turns
 * on the left and learner turns on the right and says the bubble shape alone
 * distinguishes them, so the role is the honest axis. Display names are a
 * presentation detail — see `SPEAKER_LABELS`.
 */
export type Speaker = "system" | "learner";

export const SPEAKERS: readonly Speaker[] = ["system", "learner"];

/**
 * Names printed next to a turn. Aligned with `VoicePractice`, where the AI
 * partner introduces itself as Sam and the learner is Alex.
 */
export const SPEAKER_LABELS: Record<Speaker, string> = {
  system: "Sam",
  learner: "Alex",
};

export interface DialogueTurn {
  /** Position within `DialogueScript.turns`; always equal to the array index. */
  index: number;
  speaker: Speaker;
  text: string;
  /**
   * The target words this turn actually contains — carried as data, never
   * recovered by substring search. `cold` must not be reported for `colder`.
   */
  targetWords: string[];
}

export interface DialogueScript {
  /**
   * Schema generation. Version 1 was the markdown string produced before
   * Story 1.2; it survives only inside `localStorage` and is never written
   * again. See `HistoryEntry.legacyDialogue`.
   */
  version: 2;
  turns: DialogueTurn[];
}

export const DIALOGUE_SCRIPT_VERSION = 2 as const;

// Constraints shared by the prompt (so the model is told them) and the
// validator (so they are enforced). One definition, two readers.
export const MIN_TURNS = 5;
export const MAX_TURNS = 12;
export const MAX_TARGET_WORDS_PER_TURN = 2;
export const MAX_TARGET_WORDS_PER_SCRIPT = 20;

/**
 * Flatten a script back to the `**Name:** line` markdown the pre-1.2 app
 * produced. Only for surfaces that still want one blob of text (clipboard,
 * the Gemini Live reference script) — never for rendering turns.
 */
export function scriptToMarkdown(script: DialogueScript): string {
  return script.turns
    .map((turn) => `**${SPEAKER_LABELS[turn.speaker]}:** ${turn.text}`)
    .join("\n");
}

/** Distinct target words across a whole script, in first-appearance order. */
export function scriptTargetWords(script: DialogueScript): string[] {
  const seen = new Map<string, string>();
  for (const turn of script.turns) {
    for (const word of turn.targetWords) {
      const key = word.trim().toLowerCase();
      if (key && !seen.has(key)) seen.set(key, word.trim());
    }
  }
  return [...seen.values()];
}
