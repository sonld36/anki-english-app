import { describe, expect, it } from "vitest";
import { MIN_LEAKED_CONTENT_WORDS } from "./dialogue/types";
import { containsSequence, contentWords, tokenize } from "./dialogue/stopwords";
import {
  CLIP_TOO_LONG_NOTICE,
  MAX_CLIP_MS,
  NO_TARGET_WORDS_NOTICE,
  PASS_THRESHOLD,
  SCORING_DISCLOSURE,
  SCORING_FAILURE_NOTICES,
  WARN_THRESHOLD,
  assessTurn,
  azureNBest,
  azureWords,
  claimDisclosure,
  classifyScoringOutcome,
  isClipTooLong,
  isConsonant,
  namedWords,
  parseAssessment,
  scoreCard,
  scoringPlan,
  tier2Pattern,
  type AssessedWord,
  type ScoreCard,
  type TurnScore,
} from "./pronunciation";

// ---------------------------------------------------------------------------
// Fixtures — shaped exactly like a live Azure response
// ---------------------------------------------------------------------------

/**
 * The REST API for short audio puts the scores FLAT on `NBest[0]` and on each
 * word/phoneme. Building the fixtures through this helper rather than by hand
 * is what keeps the tests honest about that: writing them in the Speech SDK's
 * nested shape would make every field `undefined` with no error, which is the
 * exact trap the lab page's comment warns about.
 */
function azureResponse(
  words: { word: string; phonemes: [string, number][] }[],
  extra: Record<string, unknown> = {}
) {
  return {
    DisplayText: words.map((w) => w.word).join(" "),
    NBest: [
      {
        // Deliberately excellent. Nothing above the phoneme may gate anything,
        // and these are here so a test can prove that.
        PronScore: 98,
        AccuracyScore: 99,
        FluencyScore: 97,
        CompletenessScore: 100,
        ProsodyScore: 96,
        Words: words.map((w) => ({
          Word: w.word,
          AccuracyScore: 99,
          ErrorType: "None",
          Phonemes: w.phonemes.map(([Phoneme, AccuracyScore]) => ({
            Phoneme,
            AccuracyScore,
          })),
        })),
        ...extra,
      },
    ],
  };
}

/** The learner's line for the leak tests. */
const LINE = "I walked to the shop and asked for a cold drink today.";
const TARGETS = ["cold", "drink"];

function assessed(words: { word: string; phonemes: [string, number][] }[]) {
  return parseAssessment(azureResponse(words));
}

/** "cold" and "drink" both clean, everything else silent-good. */
const CLEAN: AssessedWord[] = assessed([
  { word: "cold", phonemes: [["k", 95], ["oʊ", 92], ["l", 90], ["d", 88]] },
  { word: "drink", phonemes: [["d", 91], ["ɹ", 93], ["ɪ", 90], ["ŋ", 89], ["k", 94]] },
]);

// ---------------------------------------------------------------------------

describe("the wire shape", () => {
  it("reads the flat REST layout, not the Speech SDK's nested one", () => {
    const raw = azureResponse([{ word: "cold", phonemes: [["k", 80]] }]);
    expect(azureNBest(raw)?.PronScore).toBe(98);
    expect(azureWords(raw)).toHaveLength(1);
    expect(azureWords(raw)[0].Phonemes?.[0]).toEqual({
      Phoneme: "k",
      AccuracyScore: 80,
    });
  });

  it("is empty rather than throwing on a response that is not one", () => {
    for (const raw of [null, undefined, {}, { NBest: [] }, { NBest: "x" }, 7]) {
      expect(azureWords(raw)).toEqual([]);
      expect(parseAssessment(raw)).toEqual([]);
    }
  });

  it("drops a phoneme with no numeric score rather than defaulting it to 0", () => {
    // Defaulting would invent a failing number out of an absent one — and a
    // silent `Dimension` downgrade to Basic strips exactly these fields, so
    // the defaulting version would report Chưa đạt on every turn forever.
    const raw = {
      NBest: [
        {
          Words: [
            {
              Word: "cold",
              Phonemes: [
                { Phoneme: "k", AccuracyScore: 70 },
                { Phoneme: "d" },
                { Phoneme: "l", AccuracyScore: "80" },
              ],
            },
          ],
        },
      ],
    };
    expect(parseAssessment(raw)).toEqual([
      { word: "cold", phonemes: [{ phoneme: "k", score: 70 }] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Matrix: the verdict
// ---------------------------------------------------------------------------

describe("Matrix — take scores clean", () => {
  it("is Đạt when every phoneme of every target word is at or above the warn line", () => {
    const assessment = assessTurn(CLEAN, TARGETS);
    expect(assessment.passed).toBe(true);
    expect(assessment.findings).toEqual([]);
    expect(assessment.missingTargetWords).toEqual([]);
  });

  it("renders ✓ Đạt with target-word chips and the latency in seconds", () => {
    const card = scoreCard(
      { state: "scored", assessment: assessTurn(CLEAN, TARGETS), latencyMs: 1_900 },
      TARGETS,
      LINE
    );
    expect(card?.state).toBe("pass");
    expect(card?.glyph).toBe("✓");
    // The word, not only the glyph and not only the colour.
    expect(card?.label).toBe("Đạt");
    expect(card?.latencySeconds).toBe("1.9s");
    // The take's own length is a different quantity and does not live here.
    expect(card?.clipSeconds).toBeNull();
    expect(card?.chips.map((c) => c.word)).toEqual(["cold", "drink"]);
    expect(card?.chips.every((c) => c.level === "ok" && c.glyph === "✓")).toBe(true);
  });
});

describe("Matrix — below the warn line", () => {
  const WARNED = assessed([
    { word: "cold", phonemes: [["k", 95], ["oʊ", 92], ["l", 90], ["d", 45]] },
    { word: "drink", phonemes: [["d", 91], ["ɹ", 93], ["ɪ", 90], ["ŋ", 89], ["k", 94]] },
  ]);

  it("still passes: 30–59 warns, it never blocks", () => {
    const assessment = assessTurn(WARNED, TARGETS);
    expect(assessment.passed).toBe(true);
    expect(assessment.findings).toHaveLength(1);
    expect(assessment.findings[0]).toMatchObject({
      tier: 1,
      word: "cold",
      phoneme: "d",
      score: 45,
      blocksPass: false,
    });
  });

  it("still says Đạt, and names that phoneme with a `!`", () => {
    const card = scoreCard(
      { state: "scored", assessment: assessTurn(WARNED, TARGETS), latencyMs: 1_500 },
      TARGETS,
      LINE
    );
    expect(card?.state).toBe("pass");
    expect(card?.label).toBe("Đạt");
    const chip = card?.chips.find((c) => c.word === "cold");
    expect(chip).toMatchObject({ level: "warn", glyph: "!", phoneme: "d", score: 45 });
    expect(card?.tier2.map((f) => f.glyph)).toEqual(["!"]);
    expect(card?.tier2[0].phoneme).toBe("d");
  });
});

describe("Matrix — below the pass line", () => {
  const FAILED = assessed([
    { word: "cold", phonemes: [["k", 95], ["oʊ", 92], ["l", 90], ["d", 12]] },
    { word: "drink", phonemes: [["d", 91], ["ɹ", 93], ["ɪ", 90], ["ŋ", 89], ["k", 94]] },
  ]);

  it("is Chưa đạt, and marks the phoneme that blocked it", () => {
    const assessment = assessTurn(FAILED, TARGETS);
    expect(assessment.passed).toBe(false);
    expect(assessment.findings[0]).toMatchObject({
      tier: 1,
      word: "cold",
      phoneme: "d",
      blocksPass: true,
    });
  });

  it("is direct and carries no filler praise", () => {
    const card = scoreCard(
      { state: "scored", assessment: assessTurn(FAILED, TARGETS), latencyMs: 2_000 },
      TARGETS,
      LINE
    );
    expect(card?.state).toBe("fail");
    expect(card?.glyph).toBe("✗");
    expect(card?.label).toBe("Chưa đạt");
    expect(card?.chips.find((c) => c.word === "cold")).toMatchObject({
      level: "bad",
      glyph: "✗",
    });
    // EXPERIENCE.md's hardest rule: a genuinely bad result drops the
    // encouragement entirely. "Gần rồi!" to someone who got it wrong is a lie.
    expect(card?.detail).not.toMatch(/gần rồi|tốt lắm|giỏi|tuyệt/i);
    expect(card?.detail).toContain("cold");
    // And it never blames the microphone to save face.
    expect(JSON.stringify(card)).not.toMatch(/micro|mic\b/i);
  });

  it("fails a target word Azure never heard at all", () => {
    // Miscue: the learner skipped it. "Đạt" on a word that was never said
    // would make the verdict meaningless.
    const assessment = assessTurn(
      assessed([{ word: "drink", phonemes: [["d", 95], ["ɹ", 95], ["ɪ", 95], ["ŋ", 95], ["k", 95]] }]),
      TARGETS
    );
    expect(assessment.passed).toBe(false);
    expect(assessment.missingTargetWords).toEqual(["cold"]);

    const card = scoreCard(
      { state: "scored", assessment, latencyMs: 1_000 },
      TARGETS,
      LINE
    );
    expect(card?.chips.find((c) => c.word === "cold")).toMatchObject({
      level: "bad",
      glyph: "✗",
      score: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Matrix: the tiers
// ---------------------------------------------------------------------------

describe("Matrix — tier-2 pattern on any word", () => {
  it("recognises the three patterns structurally, without looking at a score", () => {
    // walked = /w ɔ k t/: the final /t/ is the -ed ending.
    const walked: [string, number][] = [["w", 90], ["ɔ", 90], ["k", 90], ["t", 10]];
    expect(tier2Pattern("walked", assessedPhonemes(walked), 3)).toBe("ending");
    // books = /b ʊ k s/: the final /s/ is the plural.
    const books: [string, number][] = [["b", 90], ["ʊ", 90], ["k", 90], ["s", 10]];
    expect(tier2Pattern("books", assessedPhonemes(books), 3)).toBe("ending");
    // shop = /ʃ ɒ p/: a plain final consonant, no inflection.
    const shop: [string, number][] = [["ʃ", 90], ["ɒ", 90], ["p", 10]];
    expect(tier2Pattern("shop", assessedPhonemes(shop), 2)).toBe("final-consonant");
    // strong = /s t ɹ ɒ ŋ/: the /t/ sits inside a cluster.
    const strong: [string, number][] = [["s", 90], ["t", 10], ["ɹ", 90], ["ɒ", 90], ["ŋ", 90]];
    expect(tier2Pattern("strong", assessedPhonemes(strong), 1)).toBe("cluster");
    // A vowel is never a tier-2 pattern.
    expect(tier2Pattern("shop", assessedPhonemes(shop), 1)).toBeNull();
  });

  it("shows the pattern prominently and never lets it block Đạt", () => {
    // Both target words are clean; `walked` drops its -ed entirely.
    const words = [
      ...CLEAN,
      ...assessed([{ word: "walked", phonemes: [["w", 90], ["ɔ", 90], ["k", 88], ["t", 3]] }]),
    ];
    const assessment = assessTurn(words, TARGETS);
    expect(assessment.passed).toBe(true);

    const tier2 = assessment.findings.filter((f) => f.tier === 2);
    expect(tier2).toHaveLength(1);
    expect(tier2[0]).toMatchObject({ word: "walked", phoneme: "t", pattern: "ending" });
    expect(tier2[0].blocksPass).toBe(false);

    const card = scoreCard(
      { state: "scored", assessment, latencyMs: 1_800 },
      TARGETS,
      LINE
    );
    expect(card?.state).toBe("pass");
    expect(card?.tier2).toHaveLength(1);
    expect(card?.tier2[0].glyph).toBe("!");
    expect(card?.tier2[0].text).toContain("đuôi từ");
    // Never in the details drawer — the epic calls tier 2 prominent.
    expect(card?.tier3).toEqual([]);
  });

  it("knows a consonant from a vowel, stress marks and all", () => {
    expect(isConsonant("t")).toBe(true);
    expect(isConsonant("ˈt")).toBe(true);
    expect(isConsonant("ŋ")).toBe(true);
    expect(isConsonant("dʒ")).toBe(true);
    expect(isConsonant("ɪ")).toBe(false);
    expect(isConsonant("oʊ")).toBe(false);
  });
});

describe("Matrix — tier-3 detail", () => {
  it("hides a low-scoring function word behind the details disclosure", () => {
    // `the` ends in a vowel and `and` ends in /d/ — a final consonant. A
    // function word stays tier 3 anyway, or one weak /d/ in every `and` buries
    // the two findings that actually matter.
    const words = [
      ...CLEAN,
      ...assessed([
        { word: "the", phonemes: [["ð", 20], ["ə", 40]] },
        { word: "and", phonemes: [["æ", 88], ["n", 88], ["d", 15]] },
      ]),
    ];
    const assessment = assessTurn(words, TARGETS);
    expect(assessment.passed).toBe(true);
    expect(assessment.findings.every((f) => f.tier === 3)).toBe(true);

    const card = scoreCard(
      { state: "scored", assessment, latencyMs: 1_700 },
      TARGETS,
      LINE
    );
    expect(card?.tier2).toEqual([]);
    expect(card?.tier3.length).toBeGreaterThan(0);
    expect(card?.tier3.every((f) => f.glyph === "·")).toBe(true);
  });

  it("treats a target word as content even when the stopword list disagrees", () => {
    // An A2/B1 deck ships `right`, `like` and `well` as vocabulary. A target
    // word is never glue, whatever the list says.
    const words = assessed([{ word: "right", phonemes: [["ɹ", 90], ["aɪ", 90], ["t", 8]] }]);
    const assessment = assessTurn(words, ["right"]);
    expect(assessment.passed).toBe(false);
    expect(assessment.findings[0]).toMatchObject({ tier: 1, blocksPass: true });
  });
});

// ---------------------------------------------------------------------------
// Matrix: the states that are not a verdict
// ---------------------------------------------------------------------------

describe("Matrix — scoring in flight", () => {
  it("mounts a card at once, in a worded pending state, with no number", () => {
    const card = scoreCard({ state: "pending" }, TARGETS, LINE);
    expect(card?.state).toBe("pending");
    expect(card?.label).toBe("Đang chấm phát âm…");
    expect(card?.latencySeconds).toBeNull();
    expect(card?.clipSeconds).toBeNull();
    expect(card?.chips).toEqual([]);
    // The card must not imply the learner has to wait for it.
    expect(card?.detail).toContain("Tiếp");
    expect(JSON.stringify(card)).not.toMatch(/\d+\s*điểm/);
  });
});

describe("Matrix — first upload of a session", () => {
  it("discloses once and then never again", () => {
    const first = claimDisclosure(false);
    expect(first.notice).toBe(SCORING_DISCLOSURE);
    expect(first.disclosed).toBe(true);

    const second = claimDisclosure(first.disclosed);
    expect(second.notice).toBeNull();
    expect(second.disclosed).toBe(true);
  });

  it("says the voice leaves the device for Azure, and is not kept there", () => {
    expect(SCORING_DISCLOSURE.text).toContain("Azure");
    expect(SCORING_DISCLOSURE.text).toMatch(/không giữ lại/);
    // The shared notice shape, not a parallel one.
    expect(Object.keys(SCORING_DISCLOSURE).sort()).toEqual(["glyph", "text", "tone"]);
  });
});

describe("Matrix — take over 30 s", () => {
  it("is the cost guard, at exactly 30 s", () => {
    expect(MAX_CLIP_MS).toBe(30_000);
    expect(isClipTooLong(MAX_CLIP_MS)).toBe(false);
    expect(isClipTooLong(MAX_CLIP_MS + 1)).toBe(true);
    expect(isClipTooLong(1_500)).toBe(false);
  });

  it("reports a decision, not a failure, and does not call the take bad", () => {
    const card = scoreCard({ state: "too-long", durationMs: 41_200 }, TARGETS, LINE);
    expect(card?.state).toBe("too-long");
    expect(card?.label).toBe("Không chấm lượt này");
    expect(card?.chips).toEqual([]);
    expect(card?.detail).toBe(CLIP_TOO_LONG_NOTICE.text);
    expect(CLIP_TOO_LONG_NOTICE.text).toContain("30 giây");
    expect(CLIP_TOO_LONG_NOTICE.text).toMatch(/vẫn đi tiếp/);
    // Not "chấm hỏng": nothing broke, we chose not to send it.
    expect(card?.detail).not.toMatch(/hỏng|lỗi/i);
  });
});

describe("Matrix — scoring fails", () => {
  it("tells the failures apart from what the transport actually said", () => {
    const failure = (status: number | null, error?: unknown) => {
      const outcome = classifyScoringOutcome(status, error);
      return outcome.kind === "failed" ? outcome.failure : outcome.kind;
    };
    expect(failure(503)).toBe("credential");
    expect(failure(401)).toBe("credential");
    expect(failure(403)).toBe("credential");
    expect(failure(504)).toBe("timeout");
    expect(failure(502)).toBe("service");
    expect(failure(500)).toBe("service");
    expect(failure(400)).toBe("service");
    expect(failure(null, { name: "TimeoutError" })).toBe("timeout");
    expect(failure(null, { name: "AbortError" })).toBe("timeout");
    expect(failure(null, new TypeError("Failed to fetch"))).toBe("network");
  });

  it("reads a 413 as the clip being too big to send, not as a service fault", () => {
    // The route's byte cap and `isClipTooLong` are set from the same budget
    // but measure different things, so they can disagree at the edge. When the
    // server's guard fires and ours did not, nothing broke and nothing is
    // wrong with the take — telling the learner "Dịch vụ chấm báo lỗi" names
    // the wrong cause and gives them nothing to do differently.
    expect(classifyScoringOutcome(413)).toEqual({ kind: "too-long" });

    const card = scoreCard({ state: "too-long", durationMs: 31_000 }, TARGETS, LINE);
    expect(card?.state).toBe("too-long");
    expect(card?.detail).not.toMatch(/hỏng|lỗi/i);
  });

  it("says scoring failed, in Vietnamese, and invents no number", () => {
    for (const failure of Object.keys(SCORING_FAILURE_NOTICES) as (keyof typeof SCORING_FAILURE_NOTICES)[]) {
      const card = scoreCard({ state: "failed", failure }, TARGETS, LINE);
      expect(card?.state).toBe("failed");
      expect(card?.label).toBe("Chấm hỏng");
      // No latency, no score, no chips — nothing that could read as a measurement.
      expect(card?.latencySeconds).toBeNull();
      expect(card?.clipSeconds).toBeNull();
      expect(card?.chips).toEqual([]);
      expect(card?.tier2).toEqual([]);
      expect(card?.tier3).toEqual([]);
      // Not one digit in the copy: nothing here may read as a measurement.
      // (The `tier2`/`tier3` field *names* carry digits, so this is asserted
      // on the text rather than on the serialised object.)
      expect(card?.detail).not.toMatch(/[0-9]/);
      // Never blames the microphone, and never tells a mid-session learner to
      // reload — that discards every completed turn.
      expect(card?.detail).not.toMatch(/micro/i);
      expect(card?.detail).not.toMatch(/tải lại trang/);
    }
  });

  it("reports an unjudgeable response as a failure rather than guessing", () => {
    // Words came back with no phoneme block at all — a silent `Dimension`
    // downgrade to Basic answers 200 exactly like this.
    const assessment = assessTurn(
      [{ word: "cold", phonemes: [] }, { word: "drink", phonemes: [] }],
      TARGETS
    );
    expect(assessment.passed).toBeNull();

    const card = scoreCard(
      { state: "scored", assessment, latencyMs: 1_400 },
      TARGETS,
      LINE
    );
    expect(card?.state).toBe("failed");
    expect(card?.detail).toBe(SCORING_FAILURE_NOTICES.unreadable.text);
    expect(card?.detail).toContain("không đoán bừa một con số");
  });

  it("has no card at all before anything has been asked", () => {
    expect(scoreCard(null, TARGETS, LINE)).toBeNull();
    expect(scoreCard(undefined, TARGETS, LINE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The two invariants that matter most
// ---------------------------------------------------------------------------

describe("the gate reads phoneme scores and nothing else", () => {
  it("is Chưa đạt on a response where every score above the phoneme is excellent", () => {
    // Measured on this project: `walked` scored 97 at word level while its
    // final /t/ was 0, with ErrorType "None". Every gate above the phoneme
    // rewards swallowing sounds — the exact failure this product exists to fix.
    const raw = azureResponse([
      { word: "cold", phonemes: [["k", 99], ["oʊ", 99], ["l", 99], ["d", 0]] },
      { word: "drink", phonemes: [["d", 99], ["ɹ", 99], ["ɪ", 99], ["ŋ", 99], ["k", 99]] },
    ]);
    // The fixture really does carry the flattering utterance-level scores.
    expect(azureNBest(raw)?.PronScore).toBe(98);
    expect(azureWords(raw)[0].AccuracyScore).toBe(99);
    expect(azureWords(raw)[0].ErrorType).toBe("None");

    const assessment = assessTurn(parseAssessment(raw), TARGETS);
    expect(assessment.passed).toBe(false);
  });

  it("ignores a bad utterance-level score when every target phoneme is fine", () => {
    // The mirror image: careful reading is slow and broken up, which costs
    // Fluency and Prosody. It must not cost the verdict.
    const raw = azureResponse(
      [
        { word: "cold", phonemes: [["k", 80], ["oʊ", 80], ["l", 80], ["d", 80]] },
        { word: "drink", phonemes: [["d", 80], ["ɹ", 80], ["ɪ", 80], ["ŋ", 80], ["k", 80]] },
      ],
      { PronScore: 31, FluencyScore: 12, ProsodyScore: 20, CompletenessScore: 40 }
    );
    expect(assessTurn(parseAssessment(raw), TARGETS).passed).toBe(true);
  });

  it("gates exactly at PASS_THRESHOLD, and warns exactly at WARN_THRESHOLD", () => {
    expect(PASS_THRESHOLD).toBe(30);
    expect(WARN_THRESHOLD).toBe(60);

    const at = (score: number) =>
      assessTurn(assessed([{ word: "cold", phonemes: [["d", score]] }]), ["cold"]);

    expect(at(PASS_THRESHOLD).passed).toBe(true);
    expect(at(PASS_THRESHOLD - 1).passed).toBe(false);
    // The warn line is a finding, never a block.
    expect(at(WARN_THRESHOLD).findings).toEqual([]);
    expect(at(WARN_THRESHOLD - 1).findings).toHaveLength(1);
    expect(at(WARN_THRESHOLD - 1).passed).toBe(true);
  });

  it("names none of the forbidden scores anywhere in the module's output", () => {
    const raw = azureResponse([
      { word: "cold", phonemes: [["k", 20], ["d", 10]] },
      { word: "drink", phonemes: [["d", 15]] },
    ]);
    const card = scoreCard(
      { state: "scored", assessment: assessTurn(parseAssessment(raw), TARGETS), latencyMs: 1_000 },
      TARGETS,
      LINE
    );
    const serialised = JSON.stringify(card);
    for (const forbidden of [
      "PronScore",
      "FluencyScore",
      "CompletenessScore",
      "ProsodyScore",
      "ErrorType",
      "DisplayText",
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
    // 98, 99, 97, 100 and 96 are the utterance/word-level numbers in the
    // fixture. None of them travelled: the chips carry each target word's
    // *worst phoneme* — /d/ at 10 in `cold`, /d/ at 15 in `drink`.
    expect(card?.chips.map((c) => c.score)).toEqual([10, 15]);
  });
});

describe("the card's words never add up to the line", () => {
  /**
   * The rule the hint validator already enforces: `MIN_LEAKED_CONTENT_WORDS`
   * consecutive content words is the point at which naming stops describing
   * and starts quoting.
   */
  function leakedRun(
    words: string[],
    line: string,
    targets: readonly string[]
  ): string[] | null {
    const always = new Set(targets.flatMap((t) => tokenize(t)));
    const named = new Set(words.flatMap((w) => tokenize(w)));
    const lineContent = contentWords(line, always);
    for (let i = 0; i + MIN_LEAKED_CONTENT_WORDS <= lineContent.length; i += 1) {
      const window = lineContent.slice(i, i + MIN_LEAKED_CONTENT_WORDS);
      const covered = window.filter((token) => named.has(token));
      if (containsSequence(covered, window)) return window;
    }
    return null;
  }

  function assertNoRun(words: string[], line: string, targets: readonly string[]) {
    expect(leakedRun(words, line, targets)).toBeNull();
  }

  it("holds even when the learner butchers every single word", () => {
    // The worst case for disclosure: every phoneme of every word at 0, so the
    // unbounded card would name the entire sentence back.
    const everyWord = LINE.replace(/[.,]/g, "")
      .split(/\s+/)
      .map((word) => ({ word, phonemes: [["t", 0]] as [string, number][] }));

    const assessment = assessTurn(assessed(everyWord), TARGETS);
    expect(assessment.passed).toBe(false);

    const card = scoreCard(
      { state: "scored", assessment, latencyMs: 2_100 },
      TARGETS,
      LINE
    );
    const words = namedWords(card);

    // The target words are named — that is what the card is for.
    expect(words).toContain("cold");
    expect(words).toContain("drink");
    // The line itself never appears, and no run of it is reconstructable.
    expect(JSON.stringify(card)).not.toContain(LINE);
    assertNoRun(words, LINE, TARGETS);
  });

  it("walks the free-text fields too, not only the word-shaped ones", () => {
    // `detail` is prose that names words, and it used to be invisible to both
    // guards: `namedWords` read only chips/tier2/tier3, and the whole-line
    // `toContain` check misses as soon as the words come out reordered. A
    // plausible "list the problem words" edit to this one string therefore put
    // the entire learner line on the card with the suite still green.
    const leaking: ScoreCard = {
      state: "fail",
      glyph: "✗",
      label: "Chưa đạt",
      tone: "danger",
      latencySeconds: "2.0s",
      clipSeconds: null,
      detail: "Các từ cần sửa: today, asked, shop, drink, cold, walked.",
      chips: [],
      tier2: [],
      tier3: [],
    };
    expect(JSON.stringify(leaking)).not.toContain(LINE);
    expect(leakedRun(namedWords(leaking), LINE, TARGETS)).not.toBeNull();

    // And the real card, built by `scoreCard`, does not trip it.
    const card = scoreCard(
      { state: "scored", assessment: assessTurn(CLEAN, TARGETS), latencyMs: 1_000 },
      TARGETS,
      LINE
    );
    expect(leakedRun(namedWords(card), LINE, TARGETS)).toBeNull();
  });

  it("names the badly-scored words it can afford to", () => {
    // A single bad word is well short of a run, so nothing is withheld: the
    // bound must not be a blanket ban on saying anything useful.
    const words = [
      ...CLEAN,
      ...assessed([{ word: "asked", phonemes: [["ɑ", 88], ["s", 88], ["k", 88], ["t", 4]] }]),
    ];
    const card = scoreCard(
      { state: "scored", assessment: assessTurn(words, TARGETS), latencyMs: 1_600 },
      TARGETS,
      LINE
    );
    expect(namedWords(card)).toContain("asked");
    assertNoRun(namedWords(card), LINE, TARGETS);
  });

  it("never carries the line even though it is handed the line", () => {
    // `scoreCard` takes the line so it can bound itself against it. Nothing it
    // returns may contain it.
    const states: TurnScore[] = [
      { state: "pending" },
      { state: "failed", failure: "service" },
      { state: "too-long", durationMs: 45_000 },
      { state: "scored", assessment: assessTurn(CLEAN, TARGETS), latencyMs: 1_000 },
    ];
    for (const state of states) {
      const serialised = JSON.stringify(scoreCard(state, TARGETS, LINE));
      expect(serialised).not.toContain(LINE);
      expect(serialised).not.toContain("shop");
      expect(serialised).not.toContain("today");
    }
  });
});

// ---------------------------------------------------------------------------

function assessedPhonemes(pairs: [string, number][]) {
  return pairs.map(([phoneme, score]) => ({ phoneme, score }));
}

// ---------------------------------------------------------------------------
// The pass gate, per target word
// ---------------------------------------------------------------------------

describe("coverage is asked per target word, not once for the whole response", () => {
  it("never passes a target word nothing was scored for, even beside one that was", () => {
    // The realistic shape, not a contrived one: the route sets
    // `EnableMiscue: true`, so a reference word the learner skipped comes back
    // *inside* `Words` — present, with a phoneme list that carries no
    // `AccuracyScore` at all. A single counter across every target lets `cold`
    // carry `drink` to a pass, and the card puts a green ✓ on a word that was
    // never said.
    const raw = {
      NBest: [
        {
          PronScore: 96,
          Words: [
            {
              Word: "cold",
              Phonemes: [
                { Phoneme: "k", AccuracyScore: 90 },
                { Phoneme: "d", AccuracyScore: 88 },
              ],
            },
            {
              Word: "drink",
              ErrorType: "Omission",
              Phonemes: [{ Phoneme: "d" }, { Phoneme: "ɹ" }],
            },
          ],
        },
      ],
    };
    const assessment = assessTurn(parseAssessment(raw), TARGETS);
    expect(assessment.passed).toBe(false);
    expect(assessment.missingTargetWords).toEqual(["drink"]);

    const card = scoreCard(
      { state: "scored", assessment, latencyMs: 1_100 },
      TARGETS,
      LINE
    );
    expect(card?.state).toBe("fail");
    expect(card?.chips.find((c) => c.word === "drink")).toMatchObject({
      level: "bad",
      glyph: "✗",
      score: null,
    });
    // Whatever else it says, it may not say this word was fine.
    expect(card?.chips.some((c) => c.word === "drink" && c.level === "ok")).toBe(
      false
    );
  });

  it("is unjudgeable — not a fail — when nothing in the response carried a score", () => {
    // Every word stripped of scores is a `Dimension` downgrade, not a learner
    // who said nothing; blaming them for it would be inventing a result.
    const assessment = assessTurn(
      [{ word: "cold", phonemes: [] }, { word: "drink", phonemes: [] }],
      TARGETS
    );
    expect(assessment.passed).toBeNull();
  });

  it("is a fail — not unjudgeable — when the response scored other words fine", () => {
    // The learner said something, just not the target words.
    const spoken = assessed([
      { word: "warm", phonemes: [["w", 90], ["ɔ", 90], ["m", 90]] },
      { word: "juice", phonemes: [["dʒ", 90], ["u", 90], ["s", 90]] },
    ]);
    const assessment = assessTurn(spoken, TARGETS);
    expect(assessment.passed).toBe(false);
    expect(assessment.missingTargetWords.sort()).toEqual(["cold", "drink"]);
  });

  it("refuses to call a turn with no target words Đạt", () => {
    // `lib/dialogue/validate.ts` does not require a learner turn to carry any.
    // A gate over an empty set is vacuously satisfied — which is exactly how a
    // confident `✓ Đạt` gets rendered for a turn nothing was ever checked on.
    const assessment = assessTurn(CLEAN, []);
    expect(assessment.passed).toBeNull();

    const card = scoreCard(
      { state: "scored", assessment, latencyMs: 1_200 },
      [],
      LINE
    );
    expect(card?.state).not.toBe("pass");
    expect(card?.chips).toEqual([]);
    // And it says the true reason, not "the service returned nothing readable".
    expect(card?.detail).toBe(NO_TARGET_WORDS_NOTICE.text);
    expect(card?.label).toBe("Không chấm lượt này");
    expect(card?.detail).not.toMatch(/[0-9]/);
  });

  it("scores a target word said twice by its worst occurrence, chip and verdict alike", () => {
    const line = "The cold water and the cold wind both hurt.";
    const words = assessed([
      { word: "cold", phonemes: [["k", 90], ["oʊ", 88], ["l", 86], ["d", 85]] },
      { word: "wind", phonemes: [["w", 90], ["ɪ", 90], ["n", 90], ["d", 90]] },
      { word: "cold", phonemes: [["k", 88], ["oʊ", 84], ["l", 80], ["d", 15]] },
    ]);
    const assessment = assessTurn(words, ["cold"]);
    expect(assessment.passed).toBe(false);

    const card = scoreCard(
      { state: "scored", assessment, latencyMs: 1_300 },
      ["cold"],
      line
    );
    // The chip used to come from the first occurrence while the verdict came
    // from the worst, so the card contradicted its own headline: `✗ Chưa đạt`
    // over a green `✓ cold`.
    expect(card?.state).toBe("fail");
    expect(card?.chips).toHaveLength(1);
    expect(card?.chips[0]).toMatchObject({
      word: "cold",
      level: "bad",
      phoneme: "d",
      score: 15,
    });
  });

  it("matches every token of a hyphenated target, not just the first", () => {
    const line = "It is a well-known problem in this city.";
    const targets = ["well-known"];
    // Azure returns it as one word; `tokenize` makes it two tokens, and
    // matching on the first alone left `known` permanently unheard — so a
    // hyphenated target could never pass, however well it was said.
    const oneWord = assessed([
      {
        word: "well-known",
        phonemes: [["w", 92], ["ɛ", 90], ["l", 88], ["n", 90], ["oʊ", 91], ["n", 89]],
      },
    ]);
    expect(assessTurn(oneWord, targets).missingTargetWords).toEqual([]);
    expect(assessTurn(oneWord, targets).passed).toBe(true);

    // And split into two, which Azure also does.
    const twoWords = assessed([
      { word: "well", phonemes: [["w", 92], ["ɛ", 90], ["l", 88]] },
      { word: "known", phonemes: [["n", 90], ["oʊ", 91], ["n", 89]] },
    ]);
    expect(assessTurn(twoWords, targets).passed).toBe(true);

    const card = scoreCard(
      { state: "scored", assessment: assessTurn(oneWord, targets), latencyMs: 1_000 },
      targets,
      line
    );
    expect(card?.state).toBe("pass");
    expect(card?.chips[0]).toMatchObject({ word: "well-known", level: "ok" });
  });
});

// ---------------------------------------------------------------------------
// The leak bound, on the targets themselves
// ---------------------------------------------------------------------------

describe("the bound covers the target words too, phrases included", () => {
  function leaked(words: string[], line: string, targets: readonly string[]) {
    const always = new Set(targets.flatMap((t) => tokenize(t)));
    const named = new Set(words.flatMap((w) => tokenize(w)));
    const lineContent = contentWords(line, always);
    for (let i = 0; i + MIN_LEAKED_CONTENT_WORDS <= lineContent.length; i += 1) {
      const window = lineContent.slice(i, i + MIN_LEAKED_CONTENT_WORDS);
      if (containsSequence(window.filter((t) => named.has(t)), window)) return window;
    }
    return null;
  }

  it("never prints a phrase target verbatim under a bubble with no text", () => {
    // `lib/vocabulary/sources/anki.ts` accepts a unit of up to 80 characters
    // with spaces in it, and `lib/dialogue/words.ts` names this exact one as a
    // real Anki target. Rendered as a chip it is most of the hidden line.
    const line = "Sorry, I don't mean to interrupt, but could I ask a question?";
    const targets = ["I don't mean to interrupt"];
    const words = assessed([
      { word: "Sorry", phonemes: [["s", 88], ["ɒ", 85], ["ɹ", 20], ["i", 80]] },
      { word: "I", phonemes: [["aɪ", 90]] },
      { word: "don't", phonemes: [["d", 88], ["oʊ", 85], ["n", 84], ["t", 80]] },
      { word: "mean", phonemes: [["m", 90], ["i", 88], ["n", 86]] },
      { word: "to", phonemes: [["t", 82], ["u", 80]] },
      { word: "interrupt", phonemes: [["ɪ", 84], ["n", 82], ["ɹ", 80], ["ʌ", 78], ["p", 70], ["t", 10]] },
      { word: "ask", phonemes: [["æ", 88], ["s", 86], ["k", 25]] },
      { word: "question", phonemes: [["k", 88], ["w", 86], ["ɛ", 84], ["s", 82], ["tʃ", 80], ["ə", 80], ["n", 78]] },
    ]);
    const assessment = assessTurn(words, targets);
    expect(assessment.passed).toBe(false);

    const card = scoreCard(
      { state: "scored", assessment, latencyMs: 2_000 },
      targets,
      line
    );
    const serialised = JSON.stringify(card);
    expect(serialised).not.toContain("I don't mean to interrupt");
    expect(serialised).not.toContain("don't mean");
    // A phrase that cannot be shown whole is shown by its worst single token —
    // still useful, still one word.
    expect(card?.chips.map((c) => c.word)).toEqual(["interrupt"]);
    expect(leaked(namedWords(card), line, targets)).toBeNull();
  });

  it("checks the seed itself, not only what is added after it", () => {
    // The seed used to be trusted: every target token went into `named` up
    // front and the run test only ran after adding a *non-target* word, so a
    // seed that was already four consecutive content words of the line was
    // never looked at.
    const line = "I need to make a quick decision today.";
    const targets = ["make a quick decision"];
    const words = assessed([
      { word: "need", phonemes: [["n", 88], ["i", 86], ["d", 84]] },
      { word: "make", phonemes: [["m", 88], ["eɪ", 86], ["k", 82]] },
      { word: "a", phonemes: [["ə", 80]] },
      { word: "quick", phonemes: [["k", 86], ["w", 84], ["ɪ", 82], ["k", 80]] },
      { word: "decision", phonemes: [["d", 84], ["ɪ", 82], ["s", 80], ["ʒ", 18], ["ə", 78], ["n", 76]] },
      { word: "today", phonemes: [["t", 88], ["u", 86], ["d", 84], ["eɪ", 82]] },
    ]);
    const card = scoreCard(
      { state: "scored", assessment: assessTurn(words, targets), latencyMs: 1_800 },
      targets,
      line
    );
    expect(JSON.stringify(card)).not.toContain("make a quick decision");
    expect(card?.chips.map((c) => c.word)).toEqual(["decision"]);
    expect(leaked(namedWords(card), line, targets)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

describe("classification does not invent a pattern it cannot see", () => {
  const pattern = (word: string, pairs: [string, number][], index: number) =>
    tier2Pattern(word, assessedPhonemes(pairs), index);

  it("calls an `-s`/`-ed` ending an ending only when a stem is left behind", () => {
    // These four are the whole point: `red`, `bed`, `bus` and `famous` all end
    // in the *spelling* of an inflection and carry none, and "đuôi từ chưa bật
    // ra" about them is coaching for a suffix the word does not have.
    expect(pattern("red", [["ɹ", 90], ["ɛ", 90], ["d", 5]], 2)).toBe("final-consonant");
    expect(pattern("bed", [["b", 90], ["ɛ", 90], ["d", 5]], 2)).toBe("final-consonant");
    expect(pattern("bus", [["b", 90], ["ʌ", 90], ["s", 5]], 2)).toBe("final-consonant");
    expect(pattern("famous", [["f", 90], ["eɪ", 90], ["m", 90], ["ə", 90], ["s", 5]], 4))
      .toBe("final-consonant");
    // The stem-vowel rule, on the words it was written for.
    expect(pattern("sled", [["s", 90], ["l", 90], ["ɛ", 90], ["d", 5]], 3))
      .toBe("final-consonant");
    expect(pattern("bread", [["b", 90], ["ɹ", 90], ["ɛ", 90], ["d", 5]], 3))
      .toBe("final-consonant");
    expect(pattern("need", [["n", 90], ["i", 90], ["d", 5]], 2)).toBe("final-consonant");
    expect(pattern("glass", [["g", 90], ["l", 90], ["æ", 90], ["s", 5]], 3))
      .toBe("final-consonant");
    expect(pattern("this", [["ð", 90], ["ɪ", 90], ["s", 5]], 2)).toBe("final-consonant");
    expect(pattern("hundred", [["h", 90], ["ʌ", 90], ["n", 90], ["d", 90], ["ɹ", 90], ["ɪ", 90], ["d", 5]], 6))
      .toBe("final-consonant");

    // And the real inflections still are ones.
    expect(pattern("walked", [["w", 90], ["ɔ", 90], ["k", 90], ["t", 5]], 3)).toBe("ending");
    expect(pattern("played", [["p", 90], ["l", 90], ["eɪ", 90], ["d", 5]], 3)).toBe("ending");
    expect(pattern("wanted", [["w", 90], ["ɑ", 90], ["n", 90], ["ɪ", 90], ["d", 5]], 4))
      .toBe("ending");
    expect(pattern("books", [["b", 90], ["ʊ", 90], ["k", 90], ["s", 5]], 3)).toBe("ending");
    expect(pattern("bags", [["b", 90], ["æ", 90], ["g", 90], ["z", 5]], 3)).toBe("ending");
    expect(pattern("boxes", [["b", 90], ["ɑ", 90], ["k", 90], ["s", 90], ["ɪ", 90], ["z", 5]], 5))
      .toBe("ending");
  });

  it("knows the symbols a live response actually emits, diacritics and all", () => {
    // An unlisted symbol fails *silently*: the finding is demoted from the
    // prominent row to the details drawer with no error anywhere, so the only
    // way this stays true is by enumerating the inventory.
    const consonants = [
      "p", "b", "t", "d", "k", "g", "ɡ", "ʔ", "ɾ",
      "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ", "h",
      "m", "n", "ŋ", "l", "ɫ", "r", "ɹ", "j", "w",
      // The affricate, all four ways it has been seen written.
      "tʃ", "dʒ", "ʧ", "ʤ", "t͡ʃ", "d͡ʒ",
      // Stress, length and the syllabic ring are decoration, not identity.
      "ˈt", "ˌd", "sː", "n̩", "l̩", "m̩",
    ];
    for (const symbol of consonants) {
      expect([symbol, isConsonant(symbol)]).toEqual([symbol, true]);
    }
    const vowels = [
      "i", "ɪ", "e", "ɛ", "æ", "ɑ", "ɔ", "o", "ʊ", "u", "ʌ", "ə", "ɚ", "ɝ",
      "aɪ", "aʊ", "ɔɪ", "oʊ", "eɪ", "ˈɑ", "ɑ̃",
    ];
    for (const symbol of vowels) {
      expect([symbol, isConsonant(symbol)]).toEqual([symbol, false]);
    }
  });

  it("normalises Azure's word the same way everywhere", () => {
    // `isStopword` used to be handed the raw `Word`, so a word carrying
    // punctuation missed the stopword list and was promoted out of tier 3 —
    // and every weak /d/ in every `and,` landed in the prominent row, which is
    // the exact burial the tier split exists to prevent.
    const words = [
      ...CLEAN,
      ...assessed([
        { word: "and,", phonemes: [["æ", 88], ["n", 88], ["d", 15]] },
        { word: "don’t", phonemes: [["d", 88], ["oʊ", 85], ["n", 84], ["t", 12]] },
      ]),
    ];
    const assessment = assessTurn(words, TARGETS);
    expect(assessment.findings.every((f) => f.tier === 3)).toBe(true);

    const card = scoreCard(
      { state: "scored", assessment, latencyMs: 1_400 },
      TARGETS,
      LINE
    );
    expect(card?.tier2).toEqual([]);
    expect(card?.tier3.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The order the disclosure and the cost guard are applied in
// ---------------------------------------------------------------------------

describe("scoringPlan", () => {
  it("checks the clip guard first, so a too-long take cannot burn the disclosure", () => {
    // The ordering used to live in a React event handler, where nothing could
    // test it. Reversed, it is invisible: the privacy notice is spent on a take
    // that never leaves the device, and the *real* first upload goes out with
    // nothing said — NFR-10 broken, every screen still looking right.
    const first = scoringPlan(MAX_CLIP_MS + 1_000, false);
    expect(first.kind).toBe("skip");
    expect(first.score).toEqual({
      state: "too-long",
      durationMs: MAX_CLIP_MS + 1_000,
    });
    expect(first.notice).toBe(CLIP_TOO_LONG_NOTICE);
    // Unspent.
    expect(first.disclosed).toBe(false);

    const second = scoringPlan(1_500, first.disclosed);
    expect(second.kind).toBe("send");
    expect(second.score).toEqual({ state: "pending" });
    expect(second.notice).toBe(SCORING_DISCLOSURE);
    expect(second.disclosed).toBe(true);

    // And exactly once per session, not once per turn.
    const third = scoringPlan(1_500, second.disclosed);
    expect(third.kind).toBe("send");
    expect(third.notice).toBeNull();
    expect(third.disclosed).toBe(true);
  });

  it("agrees with the guard it is built on, exactly at the boundary", () => {
    expect(scoringPlan(MAX_CLIP_MS, true).kind).toBe("send");
    expect(scoringPlan(MAX_CLIP_MS + 1, true).kind).toBe("skip");
    expect(isClipTooLong(MAX_CLIP_MS + 1)).toBe(true);
  });
});
