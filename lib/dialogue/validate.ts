// The single definition of "a valid dialogue script".
//
// Pure and network-free on purpose: the API route runs it against fresh model
// output, and it is the only part of script generation that can be tested
// without Gemini. Violation strings are written as instructions because they
// are fed straight back to the model on the one repair attempt.

import {
  DIALOGUE_SCRIPT_VERSION,
  MAX_TARGET_WORDS_PER_SCRIPT,
  MAX_TARGET_WORDS_PER_TURN,
  MAX_TURNS,
  MIN_TURNS,
  SPEAKERS,
  type DialogueScript,
  type DialogueTurn,
  type Speaker,
} from "./types";
import { containsWord, wordPattern } from "./words";

export type ValidationResult =
  | { ok: true }
  | { ok: false; violations: string[] };

/**
 * Consonants that must not begin the word immediately following `word`.
 *
 * A native speaker does not release the ending in "walked to" or "cold
 * drink", so Epic 2 cannot score the ending there. `-ed` yields both `d` and
 * `t` because its realisation depends on the stem (/t/ after a voiceless
 * consonant, /d/ otherwise) — the superset is the safe rule.
 */
function clashingInitials(word: string): string[] {
  const w = word.trim().toLowerCase();
  if (w.endsWith("ed")) return ["d", "t"];
  if (w.endsWith("s")) return ["s"];
  if (w.endsWith("d")) return ["d"];
  if (w.endsWith("t")) return ["t"];
  return [];
}

/**
 * The word that clashes with `word` in `text`, or `null`. Only whitespace may
 * separate them: any punctuation in between is a pause, which releases the
 * ending and removes the problem. A line break is still whitespace — `\s+`,
 * not `[ \t]+`, or a clash across a wrapped line slips through.
 */
function findConsonantClash(text: string, word: string): string | null {
  const initials = clashingInitials(word);
  if (initials.length === 0) return null;
  const needle = word.trim();
  if (!needle) return null;
  const regex = new RegExp(`${wordPattern(needle)}\\s+([A-Za-z][A-Za-z'’-]*)`, "gi");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const next = match[1];
    if (initials.includes(next[0].toLowerCase())) return next;
  }
  return null;
}

function isDialogueTurn(value: unknown): value is DialogueTurn {
  if (typeof value !== "object" || value === null) return false;
  const turn = value as Partial<DialogueTurn>;
  return (
    typeof turn.index === "number" &&
    typeof turn.speaker === "string" &&
    SPEAKERS.includes(turn.speaker as Speaker) &&
    typeof turn.text === "string" &&
    Array.isArray(turn.targetWords) &&
    turn.targetWords.every((word) => typeof word === "string")
  );
}

/**
 * Shape-only guard. Says nothing about the content rules — use
 * `validateScript` for those. Exists so `lib/history.ts` can tell a stored
 * v2 script from a legacy markdown entry without knowing the request that
 * produced it.
 */
export function isDialogueScript(value: unknown): value is DialogueScript {
  if (typeof value !== "object" || value === null) return false;
  const script = value as { version?: unknown; turns?: unknown };
  if (script.version !== DIALOGUE_SCRIPT_VERSION) return false;
  if (!Array.isArray(script.turns)) return false;
  return script.turns.every(isDialogueTurn);
}

export function validateScript(
  script: unknown,
  requestedWords: string[]
): ValidationResult {
  const violations: string[] = [];

  if (typeof script !== "object" || script === null) {
    return {
      ok: false,
      violations: ["The script must be a JSON object with a `turns` array."],
    };
  }

  const candidate = script as { version?: unknown; turns?: unknown };
  if (candidate.version !== DIALOGUE_SCRIPT_VERSION) {
    violations.push(`The script's \`version\` must be ${DIALOGUE_SCRIPT_VERSION}.`);
  }
  if (!Array.isArray(candidate.turns)) {
    violations.push("`turns` must be an array of turns.");
    return { ok: false, violations };
  }

  const turns: DialogueTurn[] = [];
  candidate.turns.forEach((raw, i) => {
    if (isDialogueTurn(raw)) {
      turns.push(raw);
      return;
    }
    violations.push(
      `Turn ${i + 1} is malformed. Every turn needs a numeric \`index\`, a ` +
        `\`speaker\` of "system" or "learner", a string \`text\`, and a ` +
        `\`targetWords\` array of strings.`
    );
  });
  if (turns.length !== candidate.turns.length) {
    return { ok: false, violations };
  }

  if (turns.length < MIN_TURNS || turns.length > MAX_TURNS) {
    violations.push(
      `The dialogue has ${turns.length} turns; it must have between ` +
        `${MIN_TURNS} and ${MAX_TURNS}.`
    );
  }

  for (const speaker of SPEAKERS) {
    if (!turns.some((turn) => turn.speaker === speaker)) {
      violations.push(
        `No turn is spoken by "${speaker}". Both speakers must take turns.`
      );
    }
  }

  const requested = requestedWords
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
  const requestedKeys = new Set(requested.map((word) => word.toLowerCase()));

  /** Requested words proven present, by lowercase key. */
  const present = new Set<string>();
  /**
   * Distinct requested words any turn claims. Hallucinated words are excluded
   * on purpose: counting them would inflate the script-wide cap and stack a
   * confusing second violation on top of the real one.
   */
  const claimed = new Set<string>();

  turns.forEach((turn, i) => {
    const n = i + 1;

    if (turn.index !== i) {
      violations.push(
        `Turn ${n} has \`index\` ${turn.index}; it must be ${i}, matching its ` +
          `position in \`turns\`.`
      );
    }
    if (!turn.text.trim()) {
      violations.push(`Turn ${n} has empty \`text\`.`);
    }

    const seen = new Set<string>();
    for (const word of turn.targetWords) {
      const key = word.trim().toLowerCase();
      if (!key) {
        violations.push(`Turn ${n} lists an empty target word.`);
        continue;
      }
      if (seen.has(key)) {
        violations.push(
          `Turn ${n} lists the target word "${word}" more than once.`
        );
        continue;
      }
      seen.add(key);

      if (!requestedKeys.has(key)) {
        violations.push(
          `Turn ${n} lists "${word}", which is not one of the requested ` +
            `target words. \`targetWords\` may only contain requested words.`
        );
        continue;
      }
      claimed.add(key);
      if (!containsWord(turn.text, word)) {
        violations.push(
          `Turn ${n} lists the target word "${word}" but its text does not ` +
            `contain "${word}" as a whole word (an inflected form such as ` +
            `"${word}er" or "${word}ing" does not count): "${turn.text}"`
        );
        continue;
      }

      present.add(key);

      const clash = findConsonantClash(turn.text, word);
      if (clash) {
        violations.push(
          `Turn ${n} puts "${word} ${clash}" in the text. A target word ` +
            `ending in -ed, -s, -d or -t must not be immediately followed by ` +
            `a word starting with that same consonant, because the ending is ` +
            `not audible there. Reword so "${word}" is followed by a ` +
            `different sound, or by punctuation.`
        );
      }
    }

    if (seen.size > MAX_TARGET_WORDS_PER_TURN) {
      violations.push(
        `Turn ${n} carries ${seen.size} target words (${[...seen].join(", ")}); ` +
          `at most ${MAX_TARGET_WORDS_PER_TURN} are allowed per turn. Move the ` +
          `extras to other turns.`
      );
    }
  });

  if (claimed.size > MAX_TARGET_WORDS_PER_SCRIPT) {
    violations.push(
      `The script uses ${claimed.size} distinct target words; at most ` +
        `${MAX_TARGET_WORDS_PER_SCRIPT} are allowed per script.`
    );
  }

  for (const word of requested) {
    if (!present.has(word.toLowerCase())) {
      violations.push(
        `The target word "${word}" never appears. Every requested target word ` +
          `must appear as a whole word in some turn's text and be listed in ` +
          `that turn's \`targetWords\`.`
      );
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
