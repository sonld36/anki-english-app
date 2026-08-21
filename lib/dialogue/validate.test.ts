import { describe, expect, it } from "vitest";
import { isDialogueScript, validateScript, withoutMalformedHints } from "./validate";
import { contentWords } from "./stopwords";
import {
  DIALOGUE_SCRIPT_VERSION,
  type DialogueHints,
  type DialogueScript,
  type DialogueTurn,
  type Speaker,
} from "./types";

type TurnSpec = {
  speaker: Speaker;
  text: string;
  targetWords?: string[];
  /**
   * Omit for the default: a valid ladder on learner turns, none on system
   * turns. `null` strips the hints deliberately. Script-rule tests rewrite
   * turns freely and should not have to restate a hint ladder to stay clear
   * of the hint rules they are not testing.
   */
  hints?: DialogueHints | null;
};

/**
 * A ladder that satisfies every hint rule whatever the line says. Keywords
 * have to come from the line itself, so they are derived from it rather than
 * invented.
 */
function defaultHints(spec: TurnSpec): DialogueHints {
  const targets = spec.targetWords?.filter((word) => word.trim()) ?? [];
  return {
    situation: "Khi bạn muốn đáp lại người kia trong tình huống này.",
    keywords: targets.length ? [...targets] : contentWords(spec.text).slice(0, 1),
  };
}

/** Build a script, assigning `index` by position the way the route does. */
function script(specs: TurnSpec[]): DialogueScript {
  return {
    version: DIALOGUE_SCRIPT_VERSION,
    turns: specs.map((spec, index): DialogueTurn => {
      const hints =
        spec.hints === undefined
          ? spec.speaker === "learner"
            ? defaultHints(spec)
            : undefined
          : (spec.hints ?? undefined);
      return {
        index,
        speaker: spec.speaker,
        text: spec.text,
        targetWords: spec.targetWords ?? [],
        ...(hints ? { hints } : {}),
      };
    }),
  };
}

const WORDS = ["cold", "weather", "expensive"];

/** A script that satisfies every rule; each test breaks exactly one thing. */
function validSpecs(): TurnSpec[] {
  return [
    { speaker: "system", text: "It is really cold outside today.", targetWords: ["cold"] },
    {
      speaker: "learner",
      text: "I know, the weather changed fast.",
      targetWords: ["weather"],
      hints: {
        situation: "Khi bạn đồng tình với nhận xét về trời trở lạnh.",
        keywords: ["weather", "changed"],
      },
    },
    { speaker: "system", text: "Did you buy a new coat yet?" },
    {
      speaker: "learner",
      text: "Not yet, good coats are expensive right now.",
      targetWords: ["expensive"],
      hints: {
        situation: "Khi bạn giải thích vì sao mình chưa mua món đồ đó.",
        keywords: ["expensive", "coats"],
      },
    },
    { speaker: "system", text: "Some shops have a sale this week." },
    {
      speaker: "learner",
      text: "Then I will look for a cheap one.",
      hints: {
        situation: "Khi bạn nói ra dự định tiếp theo của mình.",
        keywords: ["look", "cheap"],
      },
    },
  ];
}

function violationsOf(value: unknown, words: string[] = WORDS): string[] {
  const result = validateScript(value, words);
  return result.ok ? [] : result.violations;
}

function joined(value: unknown, words: string[] = WORDS): string {
  return violationsOf(value, words).join("\n");
}

function hintViolationsOf(value: unknown, words: string[] = WORDS): string[] {
  const result = validateScript(value, words);
  return result.ok ? [] : result.hintViolations;
}

function joinedHints(value: unknown, words: string[] = WORDS): string {
  return hintViolationsOf(value, words).join("\n");
}

describe("validateScript — valid script", () => {
  it("accepts a schema-conformant script that meets every rule", () => {
    expect(validateScript(script(validSpecs()), WORDS)).toEqual({ ok: true });
  });

  it("matches requested words case-insensitively", () => {
    expect(
      validateScript(script(validSpecs()), ["Cold", "WEATHER", "Expensive"])
    ).toEqual({ ok: true });
  });
});

describe("validateScript — target word coverage", () => {
  it("reports a requested word that appears in no turn", () => {
    const specs = validSpecs();
    specs[3] = { speaker: "learner", text: "Not yet, coats cost a lot right now." };

    expect(joined(script(specs))).toContain('The target word "expensive" never appears');
  });

  it("does not count a word that is in the text but not listed as a target", () => {
    // The word is right there in the prose, but nothing carries it as data —
    // that is exactly the substring-search behaviour this story removes.
    const specs = validSpecs();
    specs[3] = {
      speaker: "learner",
      text: "Not yet, good coats are expensive right now.",
      targetWords: [],
    };

    expect(joined(script(specs))).toContain('The target word "expensive" never appears');
  });
});

describe("validateScript — per-turn target word limit", () => {
  it("rejects a turn carrying 3 target words", () => {
    const specs = validSpecs();
    specs[0] = {
      speaker: "system",
      text: "The cold weather makes warm coats expensive here.",
      targetWords: ["cold", "weather", "expensive"],
    };
    specs[1] = { speaker: "learner", text: "I know, it happened fast." };
    specs[3] = { speaker: "learner", text: "Not yet, I am still looking." };

    expect(joined(script(specs))).toContain("carries 3 target words");
  });

  it("allows exactly 2 target words in one turn", () => {
    const specs = validSpecs();
    specs[0] = {
      speaker: "system",
      text: "The cold weather arrived early this year.",
      targetWords: ["cold", "weather"],
    };
    specs[1] = { speaker: "learner", text: "I know, it happened fast." };

    expect(validateScript(script(specs), WORDS)).toEqual({ ok: true });
  });

  it("rejects the same target word listed twice in one turn", () => {
    const specs = validSpecs();
    specs[0].targetWords = ["cold", "Cold"];

    expect(joined(script(specs))).toContain('lists the target word "Cold" more than once');
  });
});

describe("validateScript — hallucinated labels", () => {
  it("rejects a target word that is absent from its own turn's text", () => {
    const specs = validSpecs();
    specs[2] = {
      speaker: "system",
      text: "Did you buy a new coat yet?",
      targetWords: ["cold"],
    };

    expect(joined(script(specs))).toContain(
      'Turn 3 lists the target word "cold" but its text does not contain "cold" as a whole word'
    );
  });

  it("rejects a target word that was never requested", () => {
    const specs = validSpecs();
    specs[4] = {
      speaker: "system",
      text: "Some shops have a sale this week.",
      targetWords: ["sale"],
    };

    expect(joined(script(specs))).toContain(
      'Turn 5 lists "sale", which is not one of the requested target words'
    );
  });

  it("reports a hallucinated word once, without inflating the script-wide cap", () => {
    const specs = validSpecs();
    specs[4] = {
      speaker: "system",
      text: "Some shops have a sale this week.",
      targetWords: ["sale"],
    };

    const violations = violationsOf(script(specs));
    expect(violations).toHaveLength(1);
    expect(violations.join("\n")).not.toContain("distinct target words");
  });
});

describe("validateScript — substring trap", () => {
  it("does not treat an inflected form as the target word", () => {
    const specs = validSpecs();
    specs[0] = {
      speaker: "system",
      text: "It is much colder outside today.",
      targetWords: ["cold"],
    };

    const violations = joined(script(specs));
    // Both halves of the trap: the label is rejected...
    expect(violations).toContain(
      'Turn 1 lists the target word "cold" but its text does not contain "cold" as a whole word'
    );
    // ...and the word does not count as covered anywhere else.
    expect(violations).toContain('The target word "cold" never appears');
  });

});

describe("validateScript — consonant clash", () => {
  it("rejects a -ed target word followed by t (walked to)", () => {
    const specs = validSpecs();
    specs[0] = {
      speaker: "system",
      text: "I walked to the shop this morning.",
      targetWords: ["walked"],
    };
    specs[1] = { speaker: "learner", text: "That is a long way in this weather.", targetWords: ["weather"] };

    expect(joined(script(specs), ["walked", "weather", "expensive"])).toContain(
      'Turn 1 puts "walked to" in the text'
    );
  });

  it("rejects a -d target word followed by d (cold drink)", () => {
    const specs = validSpecs();
    specs[0] = {
      speaker: "system",
      text: "I would love a cold drink right now.",
      targetWords: ["cold"],
    };

    expect(joined(script(specs))).toContain('Turn 1 puts "cold drink" in the text');
  });

  it("rejects a -s target word followed by s", () => {
    const specs = validSpecs();
    specs[0] = {
      speaker: "system",
      text: "She always needs some help in the morning.",
      targetWords: ["needs"],
    };
    specs[3] = { speaker: "learner", text: "Not yet, coats are expensive.", targetWords: ["expensive"] };

    expect(joined(script(specs), ["needs", "weather", "expensive"])).toContain(
      'Turn 1 puts "needs some" in the text'
    );
  });

  it("catches a clash that straddles a line break", () => {
    const specs = validSpecs();
    specs[0] = {
      speaker: "system",
      text: "It is cold\ndownstairs this morning.",
      targetWords: ["cold"],
    };

    expect(joined(script(specs))).toContain('Turn 1 puts "cold downstairs" in the text');
  });

  it("allows the clash consonant when punctuation separates the words", () => {
    const specs = validSpecs();
    specs[0] = {
      speaker: "system",
      text: "It is cold, dark and windy today.",
      targetWords: ["cold"],
    };

    expect(validateScript(script(specs), WORDS)).toEqual({ ok: true });
  });

  it("allows a target word whose ending does not trigger the rule", () => {
    // "weather" ends in -r, so nothing after it can clash.
    const specs = validSpecs();
    specs[1] = {
      speaker: "learner",
      text: "I know, the weather really changed fast.",
      targetWords: ["weather"],
    };

    expect(validateScript(script(specs), WORDS)).toEqual({ ok: true });
  });
});

describe("validateScript — turn count", () => {
  it("rejects 4 turns", () => {
    const specs = validSpecs().slice(0, 4);
    expect(joined(script(specs))).toContain("The dialogue has 4 turns");
  });

  it("rejects 13 turns", () => {
    const specs = validSpecs();
    while (specs.length < 13) {
      specs.push({
        speaker: specs.length % 2 === 0 ? "system" : "learner",
        text: `Filler line number ${specs.length}.`,
      });
    }
    expect(joined(script(specs))).toContain("The dialogue has 13 turns");
  });

  it("accepts the boundary counts 5 and 12", () => {
    const five = validSpecs().slice(0, 5);
    five[3] = {
      speaker: "learner",
      text: "Not yet, good coats are expensive right now.",
      targetWords: ["expensive"],
    };
    expect(validateScript(script(five), WORDS)).toEqual({ ok: true });

    const twelve = validSpecs();
    while (twelve.length < 12) {
      twelve.push({
        speaker: twelve.length % 2 === 0 ? "system" : "learner",
        text: `Filler line number ${twelve.length}.`,
      });
    }
    expect(validateScript(script(twelve), WORDS)).toEqual({ ok: true });
  });
});

describe("validateScript — speakers", () => {
  it("rejects a script where only one speaker talks", () => {
    const specs = validSpecs().map((spec) => ({ ...spec, speaker: "system" as Speaker }));
    expect(joined(script(specs))).toContain('No turn is spoken by "learner"');
  });
});

describe("validateScript — script-wide target word cap", () => {
  it("rejects more than 20 distinct target words", () => {
    const words = Array.from({ length: 21 }, (_, i) => `w${i + 1}`);
    const specs: TurnSpec[] = [];
    for (let i = 0; i < words.length; i += 2) {
      const pair = words.slice(i, i + 2);
      specs.push({
        speaker: i % 4 === 0 ? "system" : "learner",
        text: `A line holding ${pair.join(" and ")} together.`,
        targetWords: pair,
      });
    }

    const violations = violationsOf(script(specs), words);
    expect(violations.join("\n")).toContain("uses 21 distinct target words");
    // Nothing else should be wrong: 11 turns, 2 words each, all covered.
    expect(violations).toHaveLength(1);
  });
});

describe("validateScript — malformed input", () => {
  it("rejects a non-object", () => {
    expect(joined("**A (Alex):** hello")).toContain(
      "The script must be a JSON object"
    );
  });

  it("rejects a wrong version", () => {
    // Fresh model output must be the current generation. Version 2 is readable
    // from storage (see `isDialogueScript`) but is never generated again.
    expect(joined({ version: 1, turns: [] })).toContain("`version` must be 3");
    expect(joined({ version: 2, turns: [] })).toContain("`version` must be 3");
  });

  it("rejects turns that is not an array", () => {
    expect(joined({ version: 3, turns: "nope" })).toContain("must be an array of turns");
  });

  it("rejects an unknown speaker", () => {
    const bad = {
      version: 3,
      turns: [{ index: 0, speaker: "narrator", text: "Hi", targetWords: [] }],
    };
    expect(joined(bad)).toContain("Turn 1 is malformed");
  });

  it("rejects a turn whose hints are not the right shape", () => {
    const bad = {
      version: 3,
      turns: [
        { index: 0, speaker: "learner", text: "Hi", targetWords: [], hints: "nope" },
      ],
    };
    expect(joined(bad)).toContain("Turn 1 is malformed");
  });

  it("rejects an index that does not match its position", () => {
    const bad = script(validSpecs());
    bad.turns[2].index = 7;
    expect(joined(bad)).toContain("Turn 3 has `index` 7; it must be 2");
  });

  it("rejects an empty text", () => {
    const specs = validSpecs();
    specs[4] = { speaker: "system", text: "   " };
    expect(joined(script(specs))).toContain("Turn 5 has empty `text`.");
  });
});

describe("validateScript — hint ladder", () => {
  it("accepts a script whose learner turns all carry a valid ladder", () => {
    expect(validateScript(script(validSpecs()), WORDS)).toEqual({ ok: true });
  });

  it("reports a learner turn with no hints", () => {
    const specs = validSpecs();
    specs[1].hints = null;

    expect(joinedHints(script(specs))).toContain(
      'Turn 2 is a "learner" turn with no `hints`'
    );
  });

  it("reports hints on a system turn", () => {
    const specs = validSpecs();
    specs[2].hints = {
      situation: "Khi bạn hỏi thăm người kia.",
      keywords: ["buy", "coat"],
    };

    expect(joinedHints(script(specs))).toContain(
      'Turn 3 is a "system" turn but carries `hints`'
    );
  });

  it("keeps hint violations out of the script violations", () => {
    // The whole point of the second array: a script whose only faults are
    // hints still passes every rule Epic 2 rests on.
    const specs = validSpecs();
    specs[1].hints = null;

    const result = validateScript(script(specs), WORDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toEqual([]);
    expect(result.hintViolations).toHaveLength(1);
  });

  describe("level 1 — the situation", () => {
    it("rejects a situation that repeats the whole line", () => {
      const specs = validSpecs();
      specs[3].hints = {
        situation: "Câu này nghĩa là: Not yet, good coats are expensive right now.",
        keywords: ["expensive", "coats"],
      };

      expect(joinedHints(script(specs))).toContain(
        "`hints.situation` contains the whole line"
      );
    });

    it("rejects a situation borrowing 4 content words of the line in a row", () => {
      const specs = validSpecs();
      specs[3].hints = {
        situation: "Khi bạn nói good coats are expensive right now với bạn mình.",
        keywords: ["expensive", "coats"],
      };

      expect(joinedHints(script(specs))).toContain(
        "reuses 4 content words of the line in a row"
      );
    });

    it("rejects a short line quoted in full, below the 4-word threshold", () => {
      // The window is clamped to the line: quoting both content words of a
      // 2-word line reveals as much as quoting 4 words of a longer one.
      const specs = validSpecs();
      specs[5] = {
        speaker: "learner",
        text: "I will look for a cheap one.",
        hints: {
          situation: "Khi bạn nói mình sẽ look cheap một chút nữa.",
          keywords: ["look"],
        },
      };

      expect(joinedHints(script(specs))).toContain(
        "reuses 2 content words of the line in a row"
      );
    });

    it("rejects a situation written in English", () => {
      // Cheap heuristic, deliberately a hint rule: level 1 is Vietnamese, and
      // an English "situation" is usually a translation wearing a disguise.
      const specs = validSpecs();
      specs[1].hints = {
        situation: "You agree that it turned cold.",
        keywords: ["weather", "changed"],
      };

      expect(joinedHints(script(specs))).toContain("does not look like Vietnamese");
    });

    it("does not ask for Vietnamese in the script violations", () => {
      const specs = validSpecs();
      specs[1].hints = {
        situation: "You agree that it turned cold.",
        keywords: ["weather", "changed"],
      };

      expect(violationsOf(script(specs))).toEqual([]);
    });

    it("allows a situation that mentions the target word without quoting the line", () => {
      const specs = validSpecs();
      specs[3].hints = {
        situation: "Khi bạn thấy một món đồ expensive và quyết định chưa mua.",
        keywords: ["expensive", "coats"],
      };

      expect(hintViolationsOf(script(specs))).toEqual([]);
    });

    it("rejects an empty situation", () => {
      const specs = validSpecs();
      specs[1].hints = { situation: "   ", keywords: ["weather", "changed"] };

      expect(joinedHints(script(specs))).toContain("empty `hints.situation`");
    });
  });

  describe("level 2 — the keywords", () => {
    it("rejects keywords that omit one of the turn's target words", () => {
      const specs = validSpecs();
      specs[3].hints = {
        situation: "Khi bạn giải thích vì sao mình chưa mua món đồ đó.",
        keywords: ["coats"],
      };

      expect(joinedHints(script(specs))).toContain(
        '`hints.keywords` omits the target word "expensive"'
      );
    });

    it("does not accept an inflected form in place of the target word", () => {
      const specs = validSpecs();
      specs[1].hints = {
        situation: "Khi bạn đồng tình với nhận xét về trời trở lạnh.",
        keywords: ["weathering"],
      };

      expect(joinedHints(script(specs))).toContain(
        '`hints.keywords` omits the target word "weather"'
      );
    });

    it("rejects keywords carrying 3 content words beyond the target words", () => {
      const specs = validSpecs();
      specs[3].hints = {
        situation: "Khi bạn giải thích vì sao mình chưa mua món đồ đó.",
        keywords: ["expensive", "coats", "good", "now"],
      };

      expect(joinedHints(script(specs))).toContain(
        "adds 3 content words beyond the target words"
      );
    });

    it("allows exactly 2 extra content words, and does not count function words", () => {
      const specs = validSpecs();
      specs[1].hints = {
        situation: "Khi bạn đồng tình với nhận xét về trời trở lạnh.",
        // "the" and "so" are function words: they buy the hint nothing, so
        // they cost it nothing either.
        keywords: ["weather", "the changed", "so fast"],
      };

      // Still a reconstruction of the line, but the extras rule itself passes.
      expect(joinedHints(script(specs)).includes("content words beyond")).toBe(false);
    });

    it("rejects keywords that together rebuild the whole line", () => {
      const specs = validSpecs();
      specs[1] = {
        speaker: "learner",
        text: "The weather changed fast.",
        targetWords: ["weather"],
        hints: {
          situation: "Khi bạn đồng tình với nhận xét về trời trở lạnh.",
          keywords: ["weather", "changed", "fast"],
        },
      };

      const reported = joinedHints(script(specs));
      expect(reported).toContain("covers every content word of the line");
      // Two extras is within the limit — this is the reconstruction rule
      // firing on its own, not the breadth rule in disguise.
      expect(reported).not.toContain("content words beyond");
    });

    it("does not fire the reconstruction rule on a line the targets alone cover", () => {
      // "look" and "cheap" are the only content words of turn 6; a hint that
      // lists them is unavoidable, so this must not be an unfixable violation.
      const specs = validSpecs();
      expect(hintViolationsOf(script(specs))).toEqual([]);
    });

    it("rejects a keyword that is not in the turn's own line", () => {
      const specs = validSpecs();
      specs[1].hints = {
        situation: "Khi bạn đồng tình với nhận xét về trời trở lạnh.",
        keywords: ["weather", "umbrella"],
      };

      expect(joinedHints(script(specs))).toContain(
        `"umbrella" does not appear in the turn's own text`
      );
    });

    it("counts a target word as content even when the stopword list has it", () => {
      // An A2 deck ships `like` as vocabulary, and the stopword list has it as
      // a preposition. The target word must still count as part of the line,
      // or the leak rule quietly stops protecting it — note the reported
      // window, which only contains "like" because the list was subtracted.
      const specs = validSpecs();
      specs[0] = { speaker: "system", text: "How do you feel about today?" };
      specs[1] = {
        speaker: "learner",
        text: "I like the weather here.",
        targetWords: ["like", "weather"],
        hints: {
          situation: "Khi bạn nói like weather với người kia.",
          keywords: ["like", "weather"],
        },
      };

      expect(joinedHints(script(specs), ["like", "weather", "expensive"])).toContain(
        'reuses 2 content words of the line in a row ("like weather")'
      );
    });

    it("rejects empty keywords", () => {
      const specs = validSpecs();
      specs[5].hints = {
        situation: "Khi bạn nói ra dự định tiếp theo của mình.",
        keywords: [],
      };

      expect(joinedHints(script(specs))).toContain("empty `hints.keywords`");
    });
  });
});

describe("isDialogueScript", () => {
  it("accepts a well-formed v3 script", () => {
    expect(isDialogueScript(script(validSpecs()))).toBe(true);
  });

  it("accepts a v2 script that predates hints", () => {
    // The matrix row that keeps this morning's history entries loading: a
    // stored script with no hints anywhere is still a script.
    const legacy = {
      version: 2,
      turns: [
        { index: 0, speaker: "system", text: "It is cold today.", targetWords: ["cold"] },
        { index: 1, speaker: "learner", text: "Yes, very much so.", targetWords: [] },
      ],
    };
    expect(isDialogueScript(legacy)).toBe(true);
  });

  it("rejects legacy markdown and other non-scripts", () => {
    expect(isDialogueScript("**A (Alex):** Hello there")).toBe(false);
    expect(isDialogueScript(null)).toBe(false);
    expect(isDialogueScript(undefined)).toBe(false);
    expect(isDialogueScript({ version: 1, turns: [] })).toBe(false);
    expect(isDialogueScript({ version: 4, turns: [] })).toBe(false);
    expect(isDialogueScript({ version: 3 })).toBe(false);
    expect(
      isDialogueScript({ version: 3, turns: [{ index: 0, speaker: "x", text: "a", targetWords: [] }] })
    ).toBe(false);
  });

  it("accepts a stored script once its malformed hints are stripped", () => {
    // The persistence guarantee: a garbled ladder costs the entry its hints,
    // never its script. `lib/history.ts` runs this on read.
    const stored = {
      version: 3,
      turns: [
        { index: 0, speaker: "system", text: "It is cold today.", targetWords: ["cold"] },
        {
          index: 1,
          speaker: "learner",
          text: "Yes, very much so.",
          targetWords: [],
          hints: { situation: "Khi bạn đồng tình.", keywords: null },
        },
      ],
    };

    expect(isDialogueScript(stored)).toBe(false);

    const repaired = withoutMalformedHints(stored);
    expect(isDialogueScript(repaired)).toBe(true);
    expect((repaired as DialogueScript).turns[1].hints).toBeUndefined();
    // The rest of the entry is untouched, and the input is not mutated.
    expect((repaired as DialogueScript).turns[0]).toBe(stored.turns[0]);
    expect(stored.turns[1].hints).not.toBeUndefined();
  });

  it("returns the same object when every hint is well-formed", () => {
    const good = script(validSpecs());
    expect(withoutMalformedHints(good)).toBe(good);
  });

  it("rejects a turn whose hints are present but malformed", () => {
    const bad = {
      version: 3,
      turns: [
        {
          index: 0,
          speaker: "learner",
          text: "a",
          targetWords: [],
          hints: { situation: "Khi bạn…", keywords: "not an array" },
        },
      ],
    };
    expect(isDialogueScript(bad)).toBe(false);
  });

  it("accepts a script that is well-formed but rule-breaking", () => {
    // Shape guard only — content rules are `validateScript`'s job.
    const tooShort = script([{ speaker: "system", text: "Hi." }]);
    expect(isDialogueScript(tooShort)).toBe(true);
    expect(validateScript(tooShort, WORDS).ok).toBe(false);
  });
});
