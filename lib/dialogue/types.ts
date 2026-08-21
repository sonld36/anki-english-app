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

/**
 * The Azure neural voice that reads each role's lines.
 *
 * Two *distinct* voices on purpose. The script has two roles and Epic 2 asks
 * the learner to take one of them; one voice reading both parts removes the
 * only cue that separates them by ear. Presentation-level speaker data, so it
 * lives next to `SPEAKER_LABELS`.
 */
export const SPEAKER_VOICES: Record<Speaker, string> = {
  system: "en-US-AndrewNeural",
  learner: "en-US-AvaNeural",
};

/**
 * Every voice `/api/tts` will synthesise.
 *
 * The voice name is interpolated into an SSML attribute, so it is checked
 * against this list rather than escaped — same reflex as `ALLOWED_ACTIONS` in
 * `app/api/anki/route.ts`: a closed set is the control, not sanitising.
 *
 * Written out independently of `SPEAKER_VOICES` on purpose. Derived as
 * `Object.values(SPEAKER_VOICES)` the two could never disagree, and the test
 * that checks they agree could never fail — while the failure it is supposed
 * to catch (the app asking for a voice its own route rejects, so every sample
 * 400s) stays perfectly possible via this list alone. Two declarations, one
 * test, exactly like `DIALOGUE_SCRIPT_VERSION` and `SUPPORTED_SCRIPT_VERSIONS`.
 */
export const ALLOWED_VOICES: readonly string[] = [
  "en-US-AndrewNeural",
  "en-US-AvaNeural",
];

/**
 * The two-rung hint ladder for one learner turn, generated in the same model
 * call as the script and stored with it. Opening a hint must never cost a
 * network request, so the content has to exist before the learner stalls.
 *
 * The order is fixed and there is deliberately no third rung: no level may
 * reveal the whole target line.
 */
export interface DialogueHints {
  /**
   * Level 1, in Vietnamese: *when* you would say this line. Not a translation
   * of it — see `validateScript`'s leakage rules, which are the machine-
   * checkable proxy for "this is not a translation".
   */
  situation: string;
  /**
   * Level 2: the turn's own target words, plus at most
   * `MAX_EXTRA_HINT_KEYWORDS` other content words. Never enough to rebuild the
   * line.
   */
  keywords: string[];
}

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
  /**
   * The hint ladder for this turn. Only `learner` turns carry hints — the
   * learner never has to produce a `system` line. Optional because scripts
   * stored before Story 1.3 (`version: 2`) have none; see `hasHints`.
   */
  hints?: DialogueHints;
}

/**
 * Script schema generations still readable by the app. Version 1 was the
 * markdown string produced before Story 1.2 and is not a `DialogueScript` at
 * all (see `HistoryEntry.legacyDialogue`); 2 is the structured script without
 * hints; 3 adds the hint ladder. Only the newest is ever written.
 */
export type DialogueScriptVersion = 2 | 3;

export interface DialogueScript {
  version: DialogueScriptVersion;
  turns: DialogueTurn[];
}

export const DIALOGUE_SCRIPT_VERSION = 3 as const;

/**
 * Versions `isDialogueScript` accepts — everything the app can still render.
 *
 * `DIALOGUE_SCRIPT_VERSION` **must** be a member. These are two independent
 * declarations, and bumping the version without extending this array would
 * make the guard reject scripts the app itself just wrote: every entry saved
 * afterwards would silently fail to load, which is the exact failure this
 * story exists to prevent. `types.test.ts` pins the invariant.
 */
export const SUPPORTED_SCRIPT_VERSIONS = [2, 3] as const satisfies readonly DialogueScriptVersion[];

// Constraints shared by the prompt (so the model is told them) and the
// validator (so they are enforced). One definition, two readers.
export const MIN_TURNS = 5;
export const MAX_TURNS = 12;
export const MAX_TARGET_WORDS_PER_TURN = 2;
export const MAX_TARGET_WORDS_PER_SCRIPT = 20;
/** Content words a level-2 hint may add beyond the turn's target words. */
export const MAX_EXTRA_HINT_KEYWORDS = 2;
/**
 * How many consecutive content words of the line a level-1 hint has to borrow
 * before it counts as leaking it. Four is the point at which a "situation"
 * stops describing and starts quoting. Named for the side the rule states —
 * the prompt, the violation message and AGENTS.md all say "4 or more", so the
 * code should show the same number rather than one less.
 */
export const MIN_LEAKED_CONTENT_WORDS = 4;

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

/**
 * Does this turn carry a ladder a learner could actually open?
 *
 * Presence is not enough. The accept-with-faulty-hints path can ship
 * `{ situation: "", keywords: [] }` — a rung that renders as an empty panel —
 * and a UI that trusts `turn.hints` alone would offer it.
 */
export function turnHasHints(turn: DialogueTurn): boolean {
  const hints = turn.hints;
  if (!hints || turn.speaker !== "learner") return false;
  return (
    hints.situation.trim().length > 0 &&
    hints.keywords.some((keyword) => keyword.trim().length > 0)
  );
}

/**
 * Does this script carry usable hint data at all?
 *
 * A `version: 2` script stored before Story 1.3 has none, and a script whose
 * hints were still faulty after the repair attempt is returned anyway (the
 * user gets their script; the violations are logged). The hint UI therefore
 * cannot assume hints exist — it asks here first, then `turnHasHints` per turn.
 */
export function hasHints(script: DialogueScript): boolean {
  return script.turns.some(turnHasHints);
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
