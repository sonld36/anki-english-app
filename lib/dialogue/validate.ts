// The single definition of "a valid dialogue script".
//
// Pure and network-free on purpose: the API route runs it against fresh model
// output, and it is the only part of script generation that can be tested
// without Gemini. Violation strings are written as instructions because they
// are fed straight back to the model on the one repair attempt.

import {
  DIALOGUE_SCRIPT_VERSION,
  MAX_EXTRA_HINT_KEYWORDS,
  MAX_TARGET_WORDS_PER_SCRIPT,
  MAX_TARGET_WORDS_PER_TURN,
  MAX_TURNS,
  MIN_LEAKED_CONTENT_WORDS,
  MIN_TURNS,
  SPEAKERS,
  SUPPORTED_SCRIPT_VERSIONS,
  type DialogueHints,
  type DialogueScript,
  type DialogueTurn,
  type Speaker,
} from "./types";
import { containsSequence, contentWords, tokenize } from "./stopwords";
import { containsWord, wordPattern } from "./words";

/**
 * Two separate lists, on purpose. A broken script rule means the user cannot
 * have this script at all; a broken hint rule means one rung of a ladder that
 * has no consumer until Story 2.4 came out wrong. The route has to be able to
 * tell them apart, so it can hand over a script whose only remaining faults
 * are hints instead of charging the user a whole generation for them.
 */
export type ValidationResult =
  | { ok: true }
  | { ok: false; violations: string[]; hintViolations: string[] };

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

function isDialogueHints(value: unknown): value is DialogueHints {
  if (typeof value !== "object" || value === null) return false;
  const hints = value as Partial<DialogueHints>;
  return (
    typeof hints.situation === "string" &&
    Array.isArray(hints.keywords) &&
    hints.keywords.every((word) => typeof word === "string")
  );
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
    turn.targetWords.every((word) => typeof word === "string") &&
    // Absent is fine — a version 2 script has no hints anywhere. Present but
    // malformed is not: the route shapes hints before the validator sees them,
    // so garbage here means the object did not come from the route.
    (turn.hints === undefined || isDialogueHints(turn.hints))
  );
}

/**
 * Vietnamese-specific letters. Level 1 is supposed to be written in
 * Vietnamese, and an all-English situation passes every other hint rule while
 * being exactly the "translation, not situation" failure the story is guarding
 * against.
 *
 * This is a heuristic and it is allowed to be: a genuinely unaccented
 * Vietnamese sentence costs one repair call, not a generation, because hint
 * faults are non-fatal. Do **not** promote it to a script rule — at 422 stakes
 * a false positive would cost the user their script.
 */
const VIETNAMESE_LETTERS =
  /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i;

/**
 * The hint rules for one turn. Reported separately from script rules — see
 * `ValidationResult`. `n` is the 1-based turn number used in the message,
 * because the model counts turns, not array indexes.
 */
function hintViolationsForTurn(turn: DialogueTurn, n: number): string[] {
  const out: string[] = [];

  // Rule 1 — only learner turns carry hints.
  if (turn.speaker !== "learner") {
    if (turn.hints !== undefined) {
      out.push(
        `Turn ${n} is a "system" turn but carries \`hints\`. Only "learner" ` +
          `turns may have hints — the learner never has to produce a system line.`
      );
    }
    return out;
  }
  const hints = turn.hints;
  if (hints === undefined) {
    out.push(
      `Turn ${n} is a "learner" turn with no \`hints\`. Every learner turn ` +
        `needs both levels: \`situation\` (Vietnamese, the situation the line ` +
        `is used in) and \`keywords\`.`
    );
    return out;
  }

  const keywords = hints.keywords.map((word) => word.trim()).filter(Boolean);
  const targets = turn.targetWords.map((word) => word.trim()).filter(Boolean);
  // A target word counts as content however the stopword list feels about it —
  // decks teach `like`, `right` and `well` as vocabulary.
  const targetTokens = new Set(targets.flatMap(tokenize));
  const lineContent = contentWords(turn.text, targetTokens);

  // Rule 2 — level 1 must describe the situation, not show or translate the line.
  const situation = hints.situation.trim();
  if (!situation) {
    out.push(
      `Turn ${n} has an empty \`hints.situation\`. Level 1 must say, in ` +
        `Vietnamese, in what situation this line is used.`
    );
  } else {
    if (!VIETNAMESE_LETTERS.test(situation)) {
      out.push(
        `Turn ${n}'s \`hints.situation\` does not look like Vietnamese: ` +
          `"${situation}". Level 1 is written in Vietnamese — describe the ` +
          `situation the line is used in, do not translate the line.`
      );
    }

    if (containsSequence(tokenize(situation), tokenize(turn.text))) {
      out.push(
        `Turn ${n}'s \`hints.situation\` contains the whole line "${turn.text}". ` +
          `Level 1 must describe the situation in Vietnamese and must never ` +
          `show the line or translate it.`
      );
    } else {
      const situationContent = contentWords(situation, targetTokens);
      // Clamped, so a short line cannot slip past the rule by having fewer
      // content words than the threshold: quoting all of a 2-word line reveals
      // just as much as quoting 4 words of a longer one.
      const size = Math.min(MIN_LEAKED_CONTENT_WORDS, lineContent.length);
      for (let i = 0; i + size <= lineContent.length; i++) {
        const window = lineContent.slice(i, i + size);
        if (containsSequence(situationContent, window)) {
          out.push(
            `Turn ${n}'s \`hints.situation\` reuses ${size} content ` +
              `word${size > 1 ? "s" : ""} of the line in a row ` +
              `("${window.join(" ")}"). Level 1 must describe when the line is ` +
              `used, in Vietnamese, without quoting or translating it.`
          );
          break;
        }
      }
    }
  }

  // Rule 3 — level 2 holds the target words plus at most two other content
  // words, and every keyword comes from the line itself.
  if (keywords.length === 0) {
    out.push(
      `Turn ${n} has an empty \`hints.keywords\`. Level 2 must list this ` +
        `turn's target words plus at most ${MAX_EXTRA_HINT_KEYWORDS} other ` +
        `content words.`
    );
  } else {
    const missing = targets.filter(
      (word) => !keywords.some((keyword) => containsWord(keyword, word))
    );
    if (missing.length > 0) {
      out.push(
        `Turn ${n}'s \`hints.keywords\` omits the target ` +
          `word${missing.length > 1 ? "s" : ""} ` +
          `${missing.map((word) => `"${word}"`).join(", ")}. Level 2 must list ` +
          `every target word of its own turn.`
      );
    }

    // A keyword that is not in the line is not a hint about the line — it
    // sends the learner after a word they were never meant to say.
    const invented = keywords.filter(
      (keyword) => !containsWord(turn.text, keyword)
    );
    if (invented.length > 0) {
      out.push(
        `Turn ${n}'s \`hints.keywords\` ` +
          `${invented.map((word) => `"${word}"`).join(", ")} ` +
          `${invented.length > 1 ? "do" : "does"} not appear in the turn's own ` +
          `text: "${turn.text}". Every keyword must be a word from that line.`
      );
    }

    const keywordContent = keywords.flatMap((keyword) =>
      contentWords(keyword, targetTokens)
    );
    const extras = [...new Set(keywordContent)].filter(
      (token) => !targetTokens.has(token)
    );
    if (extras.length > MAX_EXTRA_HINT_KEYWORDS) {
      out.push(
        `Turn ${n}'s \`hints.keywords\` adds ${extras.length} content words ` +
          `beyond the target words (${extras.join(", ")}); at most ` +
          `${MAX_EXTRA_HINT_KEYWORDS} are allowed. Drop the least necessary ones.`
      );
    }

    // Rule 4 — level 2 must not rebuild the line. Skipped for lines with no
    // more content words than a turn may have target words: level 2 is
    // *required* to list those, so if they alone cover the line then no
    // rewrite could ever clear the violation.
    if (lineContent.length > MAX_TARGET_WORDS_PER_TURN) {
      const covered = new Set(keywordContent);
      if (lineContent.every((word) => covered.has(word))) {
        out.push(
          `Turn ${n}'s \`hints.keywords\` covers every content word of the ` +
            `line, so joining them rebuilds "${turn.text}". No hint level may ` +
            `reveal the whole line — leave something for the learner to produce.`
        );
      }
    }
  }

  return out;
}

/**
 * Shape-only guard. Says nothing about the content rules — use
 * `validateScript` for those. Exists so `lib/history.ts` can tell a stored
 * script from a legacy markdown entry without knowing the request that
 * produced it.
 *
 * Accepts **every** supported version, not just the current one: entries
 * written before Story 1.3 hold a `version: 2` script with no hints, and they
 * must keep loading. Only `validateScript` insists on the newest version,
 * because only fresh model output has to be current.
 */
export function isDialogueScript(value: unknown): value is DialogueScript {
  if (typeof value !== "object" || value === null) return false;
  const script = value as { version?: unknown; turns?: unknown };
  const version = script.version;
  // No cast: asserting the version is a `DialogueScriptVersion` would assert
  // the very thing this guard exists to establish.
  if (typeof version !== "number") return false;
  if (!SUPPORTED_SCRIPT_VERSIONS.some((supported) => supported === version)) {
    return false;
  }
  if (!Array.isArray(script.turns)) return false;
  return script.turns.every(isDialogueTurn);
}

/**
 * Return `value` with any malformed `hints` removed, leaving everything else
 * byte-identical (and returning the original object when nothing was wrong).
 *
 * `isDialogueTurn` rejects a turn whose hints are present but garbage, which
 * is right for fresh model output and wrong for storage: one bad ladder would
 * make `isDialogueScript` reject the whole script and the history entry would
 * render as an empty legacy-markdown shell. Degrade the ladder, never the
 * entry — `lib/history.ts` runs this on read. It does not touch what is on
 * disk; nothing unrecognised is rewritten.
 */
export function withoutMalformedHints(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const script = value as { turns?: unknown };
  if (!Array.isArray(script.turns)) return value;

  let changed = false;
  const turns = script.turns.map((turn) => {
    if (typeof turn !== "object" || turn === null) return turn;
    const candidate = turn as { hints?: unknown };
    if (!("hints" in candidate) || isDialogueHints(candidate.hints)) return turn;
    changed = true;
    const stripped = { ...candidate };
    delete stripped.hints;
    return stripped;
  });

  return changed ? { ...script, turns } : value;
}

export function validateScript(
  script: unknown,
  requestedWords: string[]
): ValidationResult {
  const violations: string[] = [];
  const hintViolations: string[] = [];

  if (typeof script !== "object" || script === null) {
    return {
      ok: false,
      violations: ["The script must be a JSON object with a `turns` array."],
      hintViolations,
    };
  }

  const candidate = script as { version?: unknown; turns?: unknown };
  if (candidate.version !== DIALOGUE_SCRIPT_VERSION) {
    violations.push(`The script's \`version\` must be ${DIALOGUE_SCRIPT_VERSION}.`);
  }
  if (!Array.isArray(candidate.turns)) {
    violations.push("`turns` must be an array of turns.");
    return { ok: false, violations, hintViolations };
  }

  const turns: DialogueTurn[] = [];
  candidate.turns.forEach((raw, i) => {
    if (isDialogueTurn(raw)) {
      turns.push(raw);
      return;
    }
    violations.push(
      `Turn ${i + 1} is malformed. Every turn needs a numeric \`index\`, a ` +
        `\`speaker\` of "system" or "learner", a string \`text\`, a ` +
        `\`targetWords\` array of strings, and — on a "learner" turn — a ` +
        `\`hints\` object with a string \`situation\` and a \`keywords\` ` +
        `array of strings.`
    );
  });
  if (turns.length !== candidate.turns.length) {
    return { ok: false, violations, hintViolations };
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

    hintViolations.push(...hintViolationsForTurn(turn, n));
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

  return violations.length === 0 && hintViolations.length === 0
    ? { ok: true }
    : { ok: false, violations, hintViolations };
}
