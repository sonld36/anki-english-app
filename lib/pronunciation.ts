// Pronunciation scoring: the shape Azure answers in, the gate that turns it
// into Đạt / Chưa đạt, the three error tiers, and what the score card is
// allowed to say.
//
// Pure by construction — no React, no DOM, no `fetch`, no storage. `vitest`
// runs in `environment: "node"`, so this is where every decision worth a test
// has to live; `hooks/useTurnScorer.ts` is transport and React state and
// nothing else. Same split as `lib/sample-audio.ts` and `lib/recording.ts`.
//
// Three claims this module exists to pin:
//
//  - **the gate is phoneme-level, on the turn's own target words, and nothing
//    else.** Measured on this project: `walked` scored 97 at word level while
//    its final `/t/` was 0, with `ErrorType: "None"`. Careless reading beat
//    careful reading on `PronScore` in 2 of 3 sentences, because care costs
//    fluency and prosody. Every score above the phoneme rewards swallowing
//    sounds — the exact failure this product exists to fix. `PronScore`,
//    word-level `AccuracyScore`, `ErrorType`, `FluencyScore`,
//    `CompletenessScore` and `ProsodyScore` may be *displayed*; none of them
//    may gate anything, and none of them is read here.
//  - **no number is ever invented.** A response that carries no phoneme score
//    for a target word is not a pass and not a fail — it is unscorable, and
//    the card says so in words.
//  - **the card is a fourth projection, and it is bounded.** `TurnView` keeps
//    `text: null` and `targetWords: []` because a target word is a literal
//    substring of the line. The card has to name target words to be useful, so
//    it gets its own projection rather than a flag on that one — the same move
//    Story 2.2 made for `sampleReplayUnlocked`, and for the same reason: the
//    existing leak tests keep meaning exactly what they say. What it may name
//    is bounded by `MIN_LEAKED_CONTENT_WORDS` — the rule the hint validator
//    already enforces — so the chips can never add up to the line.
//
//    The bound is enforced by *claiming* every word before printing it
//    (`createNamer`), the target words included. "`MAX_TARGET_WORDS_PER_TURN`
//    (2) < `MIN_LEAKED_CONTENT_WORDS` (4), so the targets are safe by
//    construction" is true only for single-word targets, and an Anki unit is a
//    phrase as often as a word (`lib/vocabulary/sources/anki.ts` allows 80
//    characters with spaces; `lib/dialogue/words.ts` names `I don't mean to
//    interrupt` as a real one). A phrase that cannot be printed whole is
//    printed by one token of itself, or not at all. `namedWords` walks **every
//    string the card carries**, `detail` and `label` included — a bound that
//    only covers the chips is a bound a one-line copy edit can walk around.

import {
  MIN_LEAKED_CONTENT_WORDS,
} from "./dialogue/types";
import { contentWords, isStopword, tokenize } from "./dialogue/stopwords";
import type { RecordingNotice } from "./recording";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * Below this, a target word's phoneme blocks Đạt.
 *
 * Calibrated on real Vietnamese-accented speech, not chosen for roundness: at
 * a higher bar a learner who is genuinely intelligible never passes, and the
 * three-attempt limit Story 2.5 hangs off this verdict would fire on every
 * turn.
 */
export const PASS_THRESHOLD = 30;

/**
 * Below this, a phoneme is worth *saying something about* — and above
 * `PASS_THRESHOLD` it never blocks anything. This is the tier-2 line.
 */
export const WARN_THRESHOLD = 60;

/**
 * The longest take we will send. The cost guard the epic assigns to this
 * story: assessment is billed per second of audio, and one turn of a scripted
 * dialogue is a sentence, never half a minute. A longer take is not scored at
 * all — it is never truncated, because scoring the first 30 seconds of a
 * 90-second ramble and reporting a verdict on it would be a lie.
 */
export const MAX_CLIP_MS = 30_000;

export function isClipTooLong(durationMs: number): boolean {
  return durationMs > MAX_CLIP_MS;
}

// ---------------------------------------------------------------------------
// The wire shape
// ---------------------------------------------------------------------------

/**
 * The REST API for short audio returns assessment scores **flat** on
 * `NBest[0]` and on each word/phoneme — not nested under a
 * `PronunciationAssessment` object the way the Speech SDK does, which is what
 * most examples on the web show. Verified against a live response 2026-08-20.
 * Writing to the SDK's shape yields `undefined` at every field with no error.
 *
 * These are the *raw* types, kept faithful to the wire (including the fields
 * this story is forbidden to gate on) because `app/lab/pronunciation/page.tsx`
 * renders them for calibration. `parseAssessment` below is the narrowed view
 * the product uses.
 */
export interface AzurePhoneme {
  Phoneme: string;
  AccuracyScore?: number;
}

export interface AzureWord {
  Word: string;
  /** Displayed in the lab only. **Never** a gate — see the module header. */
  AccuracyScore?: number;
  /** Displayed in the lab only. **Never** a gate. */
  ErrorType?: string;
  Phonemes?: AzurePhoneme[];
}

export interface AzureNBest {
  /** Displayed in the lab only. **Never** a gate. */
  PronScore?: number;
  AccuracyScore?: number;
  FluencyScore?: number;
  CompletenessScore?: number;
  ProsodyScore?: number;
  Words?: AzureWord[];
}

/** `NBest[0]` of a raw Azure response, or `null` if it is not there. */
export function azureNBest(raw: unknown): AzureNBest | null {
  const list = (raw as { NBest?: unknown } | null | undefined)?.NBest;
  if (!Array.isArray(list) || list.length === 0) return null;
  const first = list[0];
  return first && typeof first === "object" ? (first as AzureNBest) : null;
}

/** The per-word assessment of a raw Azure response; empty when absent. */
export function azureWords(raw: unknown): AzureWord[] {
  const words = azureNBest(raw)?.Words;
  return Array.isArray(words) ? words : [];
}

// ---------------------------------------------------------------------------
// The narrowed view the product judges on
// ---------------------------------------------------------------------------

export interface AssessedPhoneme {
  /** IPA, because the request asks for `PhonemeAlphabet: "IPA"`. */
  phoneme: string;
  score: number;
}

export interface AssessedWord {
  word: string;
  phonemes: AssessedPhoneme[];
}

/**
 * Azure's response reduced to the only thing this story judges on: which words
 * were heard, and how each of their phonemes scored.
 *
 * A phoneme whose `AccuracyScore` is missing or not a number is **dropped**
 * rather than defaulted to 0. Defaulting would invent a failing number out of
 * an absent one — and a `Dimension` downgrade (Azure silently falls back to
 * Basic without `"Comprehensive"`) strips exactly these fields, so the
 * defaulting version would report a confident Chưa đạt on every turn.
 */
export function parseAssessment(raw: unknown): AssessedWord[] {
  return azureWords(raw)
    .map((word) => ({
      word: typeof word?.Word === "string" ? word.Word.trim() : "",
      phonemes: (Array.isArray(word?.Phonemes) ? word.Phonemes : [])
        .map((phoneme) => ({
          phoneme:
            typeof phoneme?.Phoneme === "string" ? phoneme.Phoneme.trim() : "",
          score:
            typeof phoneme?.AccuracyScore === "number" &&
            Number.isFinite(phoneme.AccuracyScore)
              ? phoneme.AccuracyScore
              : NaN,
        }))
        .filter((phoneme) => phoneme.phoneme !== "" && !Number.isNaN(phoneme.score)),
    }))
    .filter((word) => word.word !== "");
}

// ---------------------------------------------------------------------------
// Phonetics: what makes a finding tier 2
// ---------------------------------------------------------------------------

/**
 * The en-US consonant inventory in IPA, plus the two spellings of the voiced
 * velar stop (`g` U+0067 and `ɡ` U+0261 — Azure has been seen to use either)
 * and the rhotic in both of its common transcriptions.
 *
 * Consonants are what tier 2 is about: every pattern the epic names — a
 * swallowed final consonant, a dropped `-s`/`-ed`, a simplified cluster — is a
 * consonant going missing. Vowels are covered by tier 1 when they belong to a
 * target word and by tier 3 otherwise.
 */
const IPA_CONSONANTS: ReadonlySet<string> = new Set([
  "p", "b", "t", "d", "k", "g", "ɡ", "ʔ", "ɾ",
  // The affricates in every transcription seen in the wild: the two-letter
  // pair, the precomposed ligatures, and the tie-barred pair (the tie bar is a
  // combining mark, so `bareSymbol` delivers "t͡ʃ" here as "tʃ").
  "tʃ", "dʒ", "ʧ", "ʤ",
  "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ", "h", "x",
  "m", "n", "ŋ", "ɱ",
  "l", "ɫ", "r", "ɹ", "ɻ", "j", "w", "ʍ",
]);

/**
 * A phoneme reduced to its identity.
 *
 * Stripped: stress (ˈ ˌ), length (ː ˑ), syllable dots — and **every combining
 * mark**, which is the part that is easy to get wrong and impossible to
 * notice. The tie bar of "t͡ʃ" (U+0361), the syllabic ring of "n̩" (U+0329) and
 * the nasal hook of "ɑ̃" are all combining characters: leave one in and the
 * symbol misses `IPA_CONSONANTS`, which silently demotes a tier-2 finding to
 * tier 3 — no error, no log, just a coaching line that never appears.
 */
function bareSymbol(phoneme: string): string {
  return phoneme
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ˈˌːˑ.\u200d]/g, "")
    .trim();
}

export function isConsonant(phoneme: string): boolean {
  return IPA_CONSONANTS.has(bareSymbol(phoneme));
}

/**
 * The tier-2 patterns, in the order they are tested.
 *
 * `ending` first because it is the most specific and the most useful thing to
 * tell a Vietnamese learner — "the `-ed` did not come out" is actionable in a
 * way "a final consonant was weak" is not.
 */
export type Tier2Pattern = "ending" | "final-consonant" | "cluster";

/**
 * Spellings whose final `-ed` / `-s` is part of the stem and survives the
 * structural rules below. Short on purpose: it is the residue left after the
 * rules, not a substitute for them.
 */
const NON_INFLECTED: ReadonlySet<string> = new Set([
  // -ed that is not a suffix and whose stem does carry a vowel
  "hundred", "sacred", "hatred", "naked", "wicked", "rugged", "ragged",
  "jagged", "dogged", "crooked", "embed", "biped", "moped",
  // -s that is neither a plural nor a third person
  "was", "has", "gas", "alas", "atlas", "canvas", "always", "perhaps",
  "news", "series", "species", "chaos", "lens",
]);

function hasVowel(stem: string): boolean {
  return /[aeiouy]/.test(stem);
}

/**
 * Is the final phoneme of this word carrying an `-s` or `-ed` inflection?
 *
 * Spelling is all we have — Azure sends no lemma — but spelling alone is not
 * enough, and getting this wrong is worse than saying nothing: "đuôi từ chưa
 * bật ra" about `red`, `bed`, `bus` or `famous` is coaching about a suffix the
 * word does not have, and a learner who follows it is being taught to say a
 * sound that is not there. So the suffix has to leave a **plausible stem**
 * behind:
 *
 *  - `-ed` → the stem must still contain a vowel (`walk` yes, `r` of "red" no,
 *    `sl` of "sled" no), and `-ead`/`-eed` are refused outright because the /d/
 *    of `bread`, `head`, `instead`, `need`, `indeed` belongs to the stem.
 *  - `-s`  → likewise (`cat` yes), with `-ss`/`-us`/`-ous`/`-is` refused:
 *    `glass`, `bus`, `famous`, `this` are not plurals.
 *
 * When the rules refuse, the caller still reports `final-consonant`, which is
 * true of every one of these words. Losing the more specific label is the
 * cheap failure; inventing a suffix is the expensive one.
 */
function isInflectionalEnding(word: string, phoneme: string): boolean {
  const spelling = word.toLowerCase().replace(/[^a-z]/g, "");
  const symbol = bareSymbol(phoneme);
  if (NON_INFLECTED.has(spelling)) return false;

  // `-ed`: realised /t/ (walked), /d/ (played) or /ɪd/ → final /d/ (wanted).
  if (/ed$/.test(spelling) && (symbol === "t" || symbol === "d")) {
    if (/(?:ead|eed)$/.test(spelling)) return false;
    return hasVowel(spelling.slice(0, -2));
  }
  // `-s`/`-es`: realised /s/ (books), /z/ (bags) or /ɪz/ → final /z/ (boxes).
  if (/s$/.test(spelling) && (symbol === "s" || symbol === "z")) {
    if (/(?:ss|us|ous|is)$/.test(spelling)) return false;
    return hasVowel(spelling.slice(0, -1));
  }
  return false;
}

/**
 * Which tier-2 pattern, if any, this phoneme of this word belongs to.
 *
 * Structural only — it never looks at the score. The caller applies
 * `WARN_THRESHOLD`, so "is this a pattern" and "did it go wrong" stay two
 * separate questions.
 */
export function tier2Pattern(
  word: string,
  phonemes: readonly AssessedPhoneme[],
  index: number
): Tier2Pattern | null {
  const here = phonemes[index];
  if (!here || !isConsonant(here.phoneme)) return null;

  const isFinal = index === phonemes.length - 1;
  if (isFinal && isInflectionalEnding(word, here.phoneme)) return "ending";
  if (isFinal) return "final-consonant";

  const before = phonemes[index - 1];
  const after = phonemes[index + 1];
  if (
    (before && isConsonant(before.phoneme)) ||
    (after && isConsonant(after.phoneme))
  ) {
    return "cluster";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Findings and the verdict
// ---------------------------------------------------------------------------

/**
 * 1 = a target word (decides Đạt), 2 = a Vietnamese-speaker error pattern on
 * any word (prominent, never blocking), 3 = everything else (behind the
 * details disclosure).
 */
export type FindingTier = 1 | 2 | 3;

export interface PhonemeFinding {
  tier: FindingTier;
  /** The word as Azure heard it. */
  word: string;
  phoneme: string;
  score: number;
  pattern: Tier2Pattern | null;
  /** Only ever true on tier 1 — nothing else may block Đạt. */
  blocksPass: boolean;
}

export interface TurnAssessment {
  /**
   * `true` = Đạt, `false` = Chưa đạt, **`null` = the response could not be
   * judged**. `null` is not a soft fail: it is reported as a scoring failure,
   * because guessing either way would be inventing a result.
   *
   * There are exactly two ways to be unjudgeable, and neither is "the learner
   * did badly":
   *
   *  - **the turn has no target words.** `lib/dialogue/validate.ts` does not
   *    require a learner turn to carry any, and a gate over an empty set is
   *    vacuously satisfied — which would render a confident `✓ Đạt` for a turn
   *    nothing was ever checked on. A verdict on nothing is not a pass.
   *  - **the response carries no phoneme score anywhere.** A silent `Dimension`
   *    downgrade to Basic strips exactly those fields and answers 200.
   *
   * A target word that is missing while *other* words did score is a `false`,
   * not a `null`: the response was judgeable and the word was not said.
   */
  passed: boolean | null;
  findings: PhonemeFinding[];
  /**
   * Target-word tokens nothing was scored for — whether Azure left them out of
   * `Words` altogether or returned them with no phoneme block.
   *
   * The two are deliberately one thing. The route sets `EnableMiscue: true`, so
   * an omitted reference word comes back **inside** `Words` carrying no
   * phonemes: a rule that only looked for an absent word would essentially
   * never fire on a live response, and the word would score as "fine" because
   * nothing about it was ever below a threshold.
   */
  missingTargetWords: string[];
  /** One entry per target word of the turn, heard or not. */
  targetWordScores: TargetWordScore[];
}

/**
 * What was heard for one target word.
 *
 * Per **target word**, not per Azure word, and aggregated across every
 * occurrence: a line may say the same target twice, and a chip built from the
 * first occurrence while the verdict is built from the worst is a card that
 * contradicts its own headline.
 */
export interface TargetWordScore {
  /** Exactly as the deck carries it — possibly a phrase, possibly capitalised. */
  word: string;
  /** Its tokens. Every rule in this module is written over these, not the string. */
  tokens: string[];
  /** Worst phoneme score across every occurrence, or `null` if nothing scored. */
  worst: number | null;
  /** The phoneme that scored worst, or `null`. */
  phoneme: string | null;
  /** The token that phoneme belongs to, or `null`. */
  worstToken: string | null;
  /**
   * Every token of it carried at least one phoneme score.
   *
   * `false` is what stops an unscored target from wearing a green `✓`: the
   * coverage question is asked once per target word, never as one counter
   * across all of them.
   */
  heard: boolean;
}

function targetTokenSet(targetWords: readonly string[]): Set<string> {
  const tokens = new Set<string>();
  for (const word of targetWords) {
    for (const token of tokenize(word)) tokens.add(token);
  }
  return tokens;
}

/**
 * A target as the deck carries it, with its tokens.
 *
 * `lib/vocabulary/sources/anki.ts` accepts a vocabulary unit of up to 80
 * characters containing spaces, and `lib/dialogue/words.ts` names `I don't
 * mean to interrupt` as a real one — so a target is a phrase often enough that
 * every rule here has to be written over tokens.
 */
interface TargetUnit {
  raw: string;
  tokens: string[];
}

function targetUnits(targetWords: readonly string[]): TargetUnit[] {
  return targetWords
    .map((raw) => ({ raw, tokens: tokenize(raw) }))
    .filter((unit) => unit.tokens.length > 0);
}

/**
 * The whole judgement, from parsed phonemes and the turn's own target words.
 *
 * The gate, spelled out because it is the product: **every phoneme of every
 * target word ≥ `PASS_THRESHOLD`**. Nothing above the phoneme is consulted; a
 * target word nothing was scored for fails, because "Đạt" on a word the
 * learner never said would make the verdict meaningless.
 *
 * Coverage is tracked **per target word**. A single counter across all of them
 * lets one fully-scored target carry an unscored one to a pass — the exact
 * shape a live miscue response has.
 */
export function assessTurn(
  words: readonly AssessedWord[],
  targetWords: readonly string[]
): TurnAssessment {
  const units = targetUnits(targetWords);
  const targets = targetTokenSet(targetWords);

  /** Worst phoneme per target *token*, across every occurrence of it. */
  const worstByToken = new Map<string, { score: number; phoneme: string }>();
  /** Target tokens something was actually scored for. */
  const scoredTokens = new Set<string>();
  /** Did the response carry a phoneme score anywhere at all? */
  let anyPhonemeScore = false;
  let blocked = false;

  const findings: PhonemeFinding[] = [];

  for (const word of words) {
    // Every comparison goes through `tokenize`, this one included — it used to
    // hand `isStopword` Azure's raw `Word`, so `and,` or a typographic
    // apostrophe missed the stopword list and got promoted out of tier 3.
    const wordTokens = tokenize(word.word);
    // All of them, not just the first: a hyphenated target (`well-known`) is
    // one Azure word and two tokens, and matching on the first alone left the
    // second permanently "missing", which no take could ever fix.
    const hitTokens = wordTokens.filter((token) => targets.has(token));
    const isTarget = hitTokens.length > 0;
    // `alwaysContent` is what keeps a deck that teaches `like` or `right` as
    // vocabulary from having its own target word treated as glue.
    const isFunctionWord =
      wordTokens.length > 0 &&
      wordTokens.every((token) => isStopword(token, targets));

    if (word.phonemes.length > 0) anyPhonemeScore = true;

    word.phonemes.forEach((phoneme, index) => {
      if (isTarget) {
        for (const token of hitTokens) {
          scoredTokens.add(token);
          const current = worstByToken.get(token);
          if (!current || phoneme.score < current.score) {
            worstByToken.set(token, {
              score: phoneme.score,
              phoneme: phoneme.phoneme,
            });
          }
        }
        if (phoneme.score < PASS_THRESHOLD) blocked = true;
      }
      if (phoneme.score >= WARN_THRESHOLD) return;

      const pattern = tier2Pattern(word.word, word.phonemes, index);
      // Tier 1 wins outright — a target word's phoneme is what decides Đạt,
      // whatever structural pattern it also happens to match.
      //
      // Tier 3 wins over tier 2 for **function words**, which is the whole
      // distinction the epic draws: `and` ends in a consonant like any other
      // word, and promoting every weak `/d/` in every `the`/`and`/`is` into
      // the prominent row would bury the two findings that matter under a
      // dozen that do not.
      const tier: FindingTier = isTarget
        ? 1
        : isFunctionWord
          ? 3
          : pattern
            ? 2
            : 3;
      findings.push({
        tier,
        word: word.word,
        phoneme: phoneme.phoneme,
        score: phoneme.score,
        pattern,
        // Only tier 1 may block, and only below the pass line.
        blocksPass: isTarget && phoneme.score < PASS_THRESHOLD,
      });
    });
  }

  const missingTargetWords = [...targets].filter(
    (token) => !scoredTokens.has(token)
  );

  const targetWordScores: TargetWordScore[] = units.map((unit) => {
    let worst: { score: number; phoneme: string; token: string } | null = null;
    for (const token of unit.tokens) {
      const here = worstByToken.get(token);
      if (here && (!worst || here.score < worst.score)) {
        worst = { ...here, token };
      }
    }
    return {
      word: unit.raw,
      tokens: unit.tokens,
      worst: worst ? worst.score : null,
      phoneme: worst ? worst.phoneme : null,
      worstToken: worst ? worst.token : null,
      // A phrase is only "said" when every token of it was.
      heard: unit.tokens.every((token) => scoredTokens.has(token)),
    };
  });

  findings.sort(
    (a, b) => a.tier - b.tier || a.score - b.score || a.word.localeCompare(b.word)
  );

  const passed =
    targets.size === 0
      ? // A verdict on nothing. Vacuously satisfied is not the same as met.
        null
      : !anyPhonemeScore
        ? // No phoneme block anywhere: a silent `Dimension` downgrade, or a
          // truncated response. Unjudgeable, not a pass and not a fail.
          null
        : missingTargetWords.length > 0
          ? false
          : !blocked;

  return { passed, findings, missingTargetWords, targetWordScores };
}

// ---------------------------------------------------------------------------
// The per-turn score, as the session machine carries it
// ---------------------------------------------------------------------------

/**
 * Why scoring did not produce a verdict.
 *
 * Told apart because the answers differ completely: a missing credential is
 * the developer's problem, an offline phone is the learner's, and a response
 * that carries no phonemes is ours. None of them ever produces a number.
 *
 * `no-speech` is the odd one: the service worked and heard nothing it could
 * score. Saying "chấm hỏng" about that is a lie in the learner's favour, and
 * folding it into `unreadable` blames us for a take that had nothing in it —
 * so it gets its own member and its own wording. It still never blames the
 * microphone: `lib/wav.ts`'s peak check is the only thing allowed to talk
 * about signal, and even that is a diagnostic, never an excuse for a result.
 */
export type ScoringFailure =
  | "network"
  | "timeout"
  | "credential"
  | "service"
  | "no-audio"
  | "no-speech"
  | "unreadable";

/**
 * The lifecycle of one turn's score.
 *
 * `too-long` is not a failure — nothing was sent, on purpose, and saying
 * "chấm hỏng" about a deliberate decision would be misleading.
 */
export type TurnScore =
  | { state: "pending" }
  | { state: "scored"; assessment: TurnAssessment; latencyMs: number }
  | { state: "failed"; failure: ScoringFailure }
  | { state: "too-long"; durationMs: number };

/**
 * What a non-OK answer from `/api/pronunciation` means for the turn.
 *
 * A union rather than a `ScoringFailure`, because one status is not a failure
 * at all: see the 413 branch below.
 */
export type ScoringOutcome =
  | { kind: "failed"; failure: ScoringFailure }
  | { kind: "too-long" };

/**
 * Map an HTTP status (or a thrown error) onto what the turn's score becomes.
 *
 * `status === null` means the request never got an answer — the `fetch` threw
 * or the client's own timeout fired.
 */
export function classifyScoringOutcome(
  status: number | null,
  error?: unknown
): ScoringOutcome {
  if (status === null) {
    const name =
      typeof (error as { name?: unknown })?.name === "string"
        ? (error as { name: string }).name
        : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { kind: "failed", failure: "timeout" };
    }
    return { kind: "failed", failure: "network" };
  }
  // 503 = the key is not configured; 401 = Azure rejected it. Both are the
  // same thing to fix and neither is worth two messages.
  if (status === 401 || status === 403 || status === 503) {
    return { kind: "failed", failure: "credential" };
  }
  if (status === 504) return { kind: "failed", failure: "timeout" };
  // 413 is the route's own size cap firing where `isClipTooLong` did not — the
  // two guards are set from the same budget but measure different things
  // (milliseconds here, bytes there), so they can disagree at the edge.
  // Nothing broke and nothing is wrong with the take: the clip was too big to
  // send, which is exactly what `too-long` already says in words. Calling it
  // "Dịch vụ chấm báo lỗi" would tell the learner the wrong reason and offer
  // them no way to avoid it next time.
  if (status === 413) return { kind: "too-long" };
  return { kind: "failed", failure: "service" };
}

// ---------------------------------------------------------------------------
// Vietnamese copy
// ---------------------------------------------------------------------------

/**
 * NFR-10, deferred here from Story 2.2 because nothing left the device until
 * now. Said **once per session**, and **before the first request leaves** —
 * telling someone their voice was uploaded is not a disclosure.
 *
 * `RecordingNotice`'s shape on purpose: one notice channel, one strip of
 * screen, one set of styles. A second shape would be a second renderer.
 */
export const SCORING_DISCLOSURE: RecordingNotice = {
  glyph: "🔒",
  tone: "info",
  text:
    "Để chấm phát âm, bản ghi của bạn được gửi tới dịch vụ Microsoft Azure và " +
    "chấm xong thì thôi — Azure không giữ lại bản ghi, và ứng dụng này cũng " +
    "không lưu nó lên bất kỳ máy chủ nào. Bản ghi trên máy bạn bị xoá khi buổi " +
    "luyện kết thúc.",
};

/**
 * Claim the disclosure: what to say, and the flag to carry forward.
 *
 * Pure, and returning the next flag rather than reading a mutable one, so the
 * "exactly once per session" rule is enforced here instead of at the call site.
 * A caller that reads a boolean and forgets to set it says this every turn,
 * which is how a disclosure becomes noise people learn to dismiss.
 *
 * It is claimed only when something is actually about to be sent — a first
 * take that is over `MAX_CLIP_MS` never leaves the device, so burning the
 * disclosure on it would leave the *real* first upload silent.
 */
export function claimDisclosure(disclosed: boolean): {
  disclosed: boolean;
  notice: RecordingNotice | null;
} {
  if (disclosed) return { disclosed: true, notice: null };
  return { disclosed: true, notice: SCORING_DISCLOSURE };
}

/**
 * The turn carried no target words, so there was no gate to apply.
 *
 * `lib/dialogue/validate.ts` does not require a learner turn to have any, and
 * the honest answer is that there was nothing to judge — not that the service
 * failed, and certainly not `✓ Đạt`, which is what a gate over an empty set
 * quietly evaluates to.
 */
export const NO_TARGET_WORDS_NOTICE: RecordingNotice = {
  glyph: "⚠",
  tone: "warning",
  text:
    "Lượt này không có từ mục tiêu nên không có gì để chấm — không đoán bừa " +
    "một kết quả. Buổi luyện vẫn đi tiếp bình thường.",
};

/** Nothing was sent. Worded as a decision, because it is one. */
export const CLIP_TOO_LONG_NOTICE: RecordingNotice = {
  glyph: "⏱",
  tone: "warning",
  text:
    `Bản ghi dài hơn ${MAX_CLIP_MS / 1000} giây nên lượt này không gửi đi chấm. ` +
    "Mỗi lượt chỉ là một câu — ghi lại ngắn gọn hơn là chấm được. " +
    "Buổi luyện vẫn đi tiếp bình thường.",
};

/**
 * What happens to a take before anything is sent — the ordering, as a value.
 *
 * `kind: "skip"` = nothing leaves the device. `kind: "send"` = the request may
 * go, and `notice` is the once-per-session disclosure if this is the first one.
 *
 * `disclosed` is the flag to carry forward, and on the skip branch it comes
 * back **unchanged**: that is the whole reason this is a function. The order
 * `MAX_CLIP_MS`-then-`claimDisclosure` used to live inside a React event
 * handler where nothing could test it, and getting it backwards is invisible —
 * a first take that is too long burns the privacy notice, the real first upload
 * goes out silently, and NFR-10 is broken with every screen still looking
 * right.
 */
export type ScoringPlan =
  | {
      kind: "skip";
      /** Write this straight to the turn: nothing was sent, on purpose. */
      score: Extract<TurnScore, { state: "too-long" }>;
      notice: RecordingNotice;
      disclosed: boolean;
    }
  | {
      kind: "send";
      /** The card mounts on this the instant the request leaves. */
      score: Extract<TurnScore, { state: "pending" }>;
      /** The disclosure, on the first send of the session only. */
      notice: RecordingNotice | null;
      disclosed: boolean;
    };

export function scoringPlan(durationMs: number, disclosed: boolean): ScoringPlan {
  if (isClipTooLong(durationMs)) {
    return {
      kind: "skip",
      score: { state: "too-long", durationMs },
      notice: CLIP_TOO_LONG_NOTICE,
      // Untouched. A take that never left the device may not spend the one
      // disclosure the session has.
      disclosed,
    };
  }
  const claim = claimDisclosure(disclosed);
  return {
    kind: "send",
    score: { state: "pending" },
    notice: claim.notice,
    disclosed: claim.disclosed,
  };
}

/**
 * What the card says when scoring failed.
 *
 * Every one of them: says plainly that scoring failed, shows no number,
 * invents nothing, and does not blame the microphone — the take was fine, the
 * scoring was not. All of them end the same way, because it is true of all of
 * them: the session carries on.
 */
export const SCORING_FAILURE_NOTICES: Record<ScoringFailure, RecordingNotice> = {
  network: {
    glyph: "⚠",
    tone: "warning",
    text:
      "Không gửi được bản ghi đi chấm — có vẻ mất mạng. Lượt này không có điểm; " +
      "bạn vẫn nghe lại được bản ghi và bấm Tiếp để đi tiếp.",
  },
  timeout: {
    glyph: "⚠",
    tone: "warning",
    text:
      "Dịch vụ chấm không trả lời kịp. Lượt này không có điểm; bạn vẫn nghe lại " +
      "được bản ghi và bấm Tiếp để đi tiếp.",
  },
  credential: {
    glyph: "⚠",
    tone: "warning",
    text:
      "Dịch vụ chấm phát âm chưa dùng được (khoá Azure chưa cấu hình hoặc bị từ " +
      "chối). Lượt này không có điểm; buổi luyện vẫn đi tiếp bình thường.",
  },
  "no-speech": {
    glyph: "🔇",
    tone: "warning",
    text:
      "Dịch vụ chấm không nghe ra câu tiếng Anh nào trong bản ghi, nên lượt này " +
      "không có điểm. Bạn nghe lại bản ghi của mình xem sao, rồi ghi lại nếu " +
      "muốn. Buổi luyện vẫn đi tiếp bình thường.",
  },
  service: {
    glyph: "⚠",
    tone: "warning",
    text:
      "Dịch vụ chấm báo lỗi nên lượt này không có điểm. Bạn vẫn nghe lại được " +
      "bản ghi và bấm Tiếp để đi tiếp.",
  },
  "no-audio": {
    glyph: "⚠",
    tone: "warning",
    text:
      "Không đọc lại được bản ghi để gửi đi chấm, nên lượt này không có điểm. " +
      "Buổi luyện vẫn đi tiếp bình thường.",
  },
  unreadable: {
    glyph: "⚠",
    tone: "warning",
    text:
      "Dịch vụ chấm trả về kết quả không đọc được điểm từng âm, nên lượt này " +
      "không có điểm — không đoán bừa một con số. Buổi luyện vẫn đi tiếp bình thường.",
  },
};

/** How a tier-2 pattern is described, in the coach's voice: specific, short. */
const TIER2_PATTERN_TEXT: Record<Tier2Pattern, string> = {
  ending: "đuôi từ chưa bật ra",
  "final-consonant": "phụ âm cuối bị nuốt",
  cluster: "cụm phụ âm bị giản lược",
};

// ---------------------------------------------------------------------------
// The score card — the fourth projection
// ---------------------------------------------------------------------------

export type ScoreCardState = "pending" | "pass" | "fail" | "failed" | "too-long";

/** `ok` / `warn` / `bad` each carry a glyph as well as a colour. */
export type ChipLevel = "ok" | "warn" | "bad";

export interface ScoreChip {
  word: string;
  level: ChipLevel;
  glyph: string;
  /** The worst phoneme of this word, IPA, or `null` when nothing was wrong. */
  phoneme: string | null;
  score: number | null;
}

export interface ScoreCardFinding {
  glyph: string;
  word: string;
  phoneme: string;
  score: number;
  /** Vietnamese, specific, and never an excuse. */
  text: string;
}

/**
 * Everything the screen may render about one turn's score.
 *
 * **It carries no line.** `scoreCard` is handed the learner's line so it can
 * bound what it names against it, and returns words only — target words, plus
 * the specific words that scored badly, minus anything that would complete a
 * run of `MIN_LEAKED_CONTENT_WORDS` consecutive content words of the line.
 */
export interface ScoreCard {
  state: ScoreCardState;
  glyph: string;
  /** The verdict in words. Never colour alone, never a glyph alone. */
  label: string;
  tone: "info" | "success" | "danger" | "warning";
  /**
   * How long **scoring** took, already formatted, `tabular-nums` at the call
   * site. Only ever set on a verdict.
   */
  latencySeconds: string | null;
  /**
   * How long the **take** was — a different quantity entirely, and only ever
   * set on `too-long`.
   *
   * Two numbers used to share one unlabelled field, so a 41-second recording
   * rendered as `41.2s` right where every other card renders its assessment
   * latency: the same glyph, the same slot, the opposite meaning. They are
   * separated here so the screen cannot render one believing it is the other.
   */
  clipSeconds: string | null;
  /** One line under the verdict, or `null`. Never a guessed number. */
  detail: string | null;
  chips: ScoreChip[];
  /**
   * The prominent `!` row: every tier-2 pattern finding, **plus** target-word
   * phonemes that landed in the 30–59 band.
   *
   * The second half is deliberate. DESIGN.md's accessibility table calls `!`
   * plus a dashed border "cảnh báo tầng 2", which is a *presentation* tier —
   * "worth saying, does not block" — and a target phoneme above the pass line
   * but below the warn line is exactly that. Merging them here is what makes
   * the matrix's "still Đạt, plus a `!` finding naming that phoneme" true.
   * Nothing in this list can block: `blocksPass` findings never reach it.
   */
  tier2: ScoreCardFinding[];
  /** Tier 3 — function words and unremarkable misses, behind `<details>`. */
  tier3: ScoreCardFinding[];
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Would naming `candidate` alongside everything already named complete a run
 * of `MIN_LEAKED_CONTENT_WORDS` consecutive content words of the line?
 *
 * The same rule the hint validator enforces (`lib/dialogue/validate.ts`), for
 * the same reason: four consecutive content words is the point at which a
 * description stops describing and starts quoting.
 */
function completesRun(lineContent: readonly string[], named: ReadonlySet<string>): boolean {
  if (lineContent.length < MIN_LEAKED_CONTENT_WORDS) return false;
  for (let i = 0; i + MIN_LEAKED_CONTENT_WORDS <= lineContent.length; i += 1) {
    let all = true;
    for (let j = 0; j < MIN_LEAKED_CONTENT_WORDS; j += 1) {
      if (!named.has(lineContent[i + j])) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}

/**
 * The card's naming budget.
 *
 * Every word the card prints is claimed here first, in priority order — the
 * target words, then the findings worst-scoring first — and a claim is refused
 * when granting it would complete a run of `MIN_LEAKED_CONTENT_WORDS`
 * consecutive content words of the line.
 *
 * The seed is **claimed, not assumed**. The old version seeded `named` with
 * every target token and only ever tested the set after adding a *non-target*
 * word, so a seed that was already a forbidden run on its own was never
 * looked at. That was safe exactly while every target was a single word:
 * `MAX_TARGET_WORDS_PER_TURN` (2) < `MIN_LEAKED_CONTENT_WORDS` (4). An Anki
 * unit may be a whole phrase (`I don't mean to interrupt`), and two of those
 * are more than four tokens of the line in a row — printed verbatim under a
 * bubble whose `text` is deliberately `null`.
 */
function createNamer(line: string, targets: ReadonlySet<string>) {
  const lineContent = contentWords(line, targets);
  const named = new Set<string>();

  const claim = (tokens: readonly string[]): boolean => {
    const added: string[] = [];
    for (const token of tokens) {
      if (!token || named.has(token)) continue;
      named.add(token);
      added.push(token);
    }
    // Nothing new to disclose — already-named words are free.
    if (added.length === 0) return true;
    if (completesRun(lineContent, named)) {
      for (const token of added) named.delete(token);
      return false;
    }
    return true;
  };

  return {
    claim,
    /**
     * The label a target word may be printed under, or `null` for "print no
     * chip at all".
     *
     * A phrase that cannot be shown whole is shown by **one** token of itself —
     * its worst-scoring one, which is the informative one — rather than
     * truncated to a fragment of the line. If even that is refused, the card
     * says nothing about it: the verdict still stands, and the bound is the
     * story's central invariant, so it wins over the chip.
     */
    claimTarget(entry: TargetWordScore): string | null {
      if (claim(entry.tokens)) return entry.word;
      const representative =
        entry.worstToken ??
        // Deliberately the *plain* list: `targets` as `alwaysContent` would
        // make every token of the phrase content, and the fallback would pick
        // `I` out of `I don't mean to interrupt`.
        entry.tokens.find((token) => !isStopword(token)) ??
        entry.tokens[0];
      if (representative && claim([representative])) return representative;
      return null;
    },
  };
}

/** Drop the findings whose word the card may not name. */
function boundedFindings(
  findings: readonly PhonemeFinding[],
  claim: (tokens: readonly string[]) => boolean
): PhonemeFinding[] {
  const kept: PhonemeFinding[] = [];
  for (const finding of findings) {
    const tokens = tokenize(finding.word);
    if (tokens.length === 0) continue;
    if (claim(tokens)) kept.push(finding);
  }
  return kept;
}

function chipFor(word: string, worst: number | null, phoneme: string | null): ScoreChip {
  const level: ChipLevel =
    worst === null || worst >= WARN_THRESHOLD
      ? "ok"
      : worst >= PASS_THRESHOLD
        ? "warn"
        : "bad";
  return {
    word,
    level,
    glyph: level === "ok" ? "✓" : level === "warn" ? "!" : "✗",
    phoneme: level === "ok" ? null : phoneme,
    score: worst === null ? null : Math.round(worst),
  };
}

/**
 * The card for one turn.
 *
 * `line` is the learner's own line. It goes **in** so the disclosure can be
 * bounded against it and never comes out: nothing this function returns
 * carries it, which is what makes the card safe to render under a turn whose
 * text is still hidden.
 */
export function scoreCard(
  score: TurnScore | null | undefined,
  targetWords: readonly string[],
  line: string
): ScoreCard | null {
  if (!score) return null;

  // Fresh arrays per call: a shared `as const` literal would hand every card
  // the same frozen instance, and a caller sorting chips in place would be
  // sorting every other card's too.
  const empty = (): Pick<ScoreCard, "chips" | "tier2" | "tier3"> => ({
    chips: [],
    tier2: [],
    tier3: [],
  });

  if (score.state === "pending") {
    return {
      state: "pending",
      glyph: "⋯",
      label: "Đang chấm phát âm…",
      tone: "info",
      latencySeconds: null,
      clipSeconds: null,
      detail: "Bạn bấm Tiếp được ngay, không phải đợi.",
      ...empty(),
    };
  }

  if (score.state === "too-long") {
    return {
      state: "too-long",
      glyph: "⏱",
      label: "Không chấm lượt này",
      tone: "warning",
      latencySeconds: null,
      clipSeconds: formatSeconds(score.durationMs),
      detail: CLIP_TOO_LONG_NOTICE.text,
      ...empty(),
    };
  }

  if (score.state === "failed") {
    return {
      state: "failed",
      glyph: "⚠",
      label: "Chấm hỏng",
      tone: "warning",
      // No number at all — not the latency, not a score. Nothing here may look
      // like a measurement of the learner.
      latencySeconds: null,
      clipSeconds: null,
      detail: SCORING_FAILURE_NOTICES[score.failure].text,
      ...empty(),
    };
  }

  const { assessment, latencyMs } = score;

  // Unjudgeable is reported as a failure, never as a verdict: the alternative
  // is inventing one.
  if (assessment.passed === null) {
    // Two different reasons, two different sentences. "The service returned
    // something we could not read" is false when the truth is "this turn had
    // nothing to check".
    const noTargets = assessment.targetWordScores.length === 0;
    return {
      state: "failed",
      glyph: "⚠",
      label: noTargets ? "Không chấm lượt này" : "Chấm hỏng",
      tone: "warning",
      latencySeconds: null,
      clipSeconds: null,
      detail: noTargets
        ? NO_TARGET_WORDS_NOTICE.text
        : SCORING_FAILURE_NOTICES.unreadable.text,
      ...empty(),
    };
  }

  const targets = targetTokenSet(targetWords);
  const namer = createNamer(line, targets);

  // Chips first: naming the target words is what the card is for, so they get
  // the naming budget ahead of any finding. `claimTarget` may still refuse.
  const chips: ScoreChip[] = [];
  for (const entry of assessment.targetWordScores) {
    const label = namer.claimTarget(entry);
    if (label === null) continue;
    if (!entry.heard) {
      // Nothing was scored for it. Never a `✓`: this is the shape a miscue
      // takes on a live response, and a green tick on a word the learner
      // skipped is the one thing the chip must never say.
      chips.push({ word: label, level: "bad", glyph: "✗", phoneme: null, score: null });
      continue;
    }
    // `worst`/`phoneme` are aggregated across every occurrence of the word, so
    // a chip cannot contradict the verdict on a line that says it twice.
    chips.push(chipFor(label, entry.worst, entry.phoneme));
  }

  const kept = boundedFindings(assessment.findings, namer.claim);

  const toFinding = (finding: PhonemeFinding): ScoreCardFinding => ({
    glyph: finding.tier === 3 ? "·" : "!",
    word: finding.word,
    phoneme: finding.phoneme,
    score: Math.round(finding.score),
    text:
      finding.pattern !== null
        ? `${finding.word}: ${TIER2_PATTERN_TEXT[finding.pattern]} (/${finding.phoneme}/)`
        : `${finding.word}: âm /${finding.phoneme}/ chưa rõ`,
  });

  const tier2 = kept
    .filter((f) => (f.tier === 2 || f.tier === 1) && !f.blocksPass)
    .map(toFinding);
  const tier3 = kept.filter((f) => f.tier === 3).map(toFinding);

  const blocking = kept.filter((f) => f.blocksPass);
  const passed = assessment.passed;

  // The coach's voice, and its hardest rule: a genuinely bad result drops the
  // encouragement entirely. "Gần rồi!" to someone who got most of it wrong is
  // a lie, and they stop believing every later compliment.
  const detail = passed
    ? kept.some((f) => f.tier === 1)
      ? "Từ mục tiêu nghe ra được. Vẫn còn âm chưa gọn — xem bên dưới."
      : null
    : assessment.missingTargetWords.length > 0
      ? `Chưa nghe ra ${assessment.missingTargetWords.length === 1 ? "từ mục tiêu" : "các từ mục tiêu"}. Nói chậm và rõ hơn thử xem.`
      : blocking.length > 0
        ? `Âm /${blocking[0].phoneme}/ trong “${blocking[0].word}” chưa ra. Đọc lại riêng từ đó rồi ghi lại.`
        : "Từ mục tiêu chưa đạt. Đọc lại chậm hơn rồi ghi lại.";

  return {
    state: passed ? "pass" : "fail",
    glyph: passed ? "✓" : "✗",
    label: passed ? "Đạt" : "Chưa đạt",
    tone: passed ? "success" : "danger",
    latencySeconds: formatSeconds(latencyMs),
    clipSeconds: null,
    detail,
    chips,
    tier2,
    tier3,
  };
}

/**
 * Every word the card names, tokenized, for the leak test to walk.
 *
 * Exported so the invariant "the card's words never add up to the line" is
 * checkable from outside rather than trusted — and it walks **every string the
 * card carries**, not the three word-shaped fields. A version that read only
 * `chips`/`tier2`/`tier3` could not see `detail`, which is a free-text field
 * that names words: replacing its copy with a plausible "list all the problem
 * words" edit put the learner's whole line onto the card with the entire suite
 * still green, because the words came out reordered and a `toContain(line)`
 * check never fired.
 *
 * Returns tokens rather than display strings, so casing and punctuation cannot
 * hide a word from the run test.
 */
export function namedWords(card: ScoreCard | null): string[] {
  if (!card) return [];
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      out.push(...tokenize(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) walk(item);
    }
  };
  walk(card);
  return out;
}
