import { describe, expect, it } from "vitest";
import { isDialogueScript, validateScript } from "./validate";
import type { DialogueScript, DialogueTurn, Speaker } from "./types";

type TurnSpec = {
  speaker: Speaker;
  text: string;
  targetWords?: string[];
};

/** Build a script, assigning `index` by position the way the route does. */
function script(specs: TurnSpec[]): DialogueScript {
  return {
    version: 2,
    turns: specs.map(
      (spec, index): DialogueTurn => ({
        index,
        speaker: spec.speaker,
        text: spec.text,
        targetWords: spec.targetWords ?? [],
      })
    ),
  };
}

const WORDS = ["cold", "weather", "expensive"];

/** A script that satisfies every rule; each test breaks exactly one thing. */
function validSpecs(): TurnSpec[] {
  return [
    { speaker: "system", text: "It is really cold outside today.", targetWords: ["cold"] },
    { speaker: "learner", text: "I know, the weather changed fast.", targetWords: ["weather"] },
    { speaker: "system", text: "Did you buy a new coat yet?" },
    {
      speaker: "learner",
      text: "Not yet, good coats are expensive right now.",
      targetWords: ["expensive"],
    },
    { speaker: "system", text: "Some shops have a sale this week." },
    { speaker: "learner", text: "Then I will look for a cheap one." },
  ];
}

function violationsOf(value: unknown, words: string[] = WORDS): string[] {
  const result = validateScript(value, words);
  return result.ok ? [] : result.violations;
}

function joined(value: unknown, words: string[] = WORDS): string {
  return violationsOf(value, words).join("\n");
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
    expect(joined({ version: 1, turns: [] })).toContain("`version` must be 2");
  });

  it("rejects turns that is not an array", () => {
    expect(joined({ version: 2, turns: "nope" })).toContain("must be an array of turns");
  });

  it("rejects an unknown speaker", () => {
    const bad = {
      version: 2,
      turns: [{ index: 0, speaker: "narrator", text: "Hi", targetWords: [] }],
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

describe("isDialogueScript", () => {
  it("accepts a well-formed v2 script", () => {
    expect(isDialogueScript(script(validSpecs()))).toBe(true);
  });

  it("rejects legacy markdown and other non-scripts", () => {
    expect(isDialogueScript("**A (Alex):** Hello there")).toBe(false);
    expect(isDialogueScript(null)).toBe(false);
    expect(isDialogueScript(undefined)).toBe(false);
    expect(isDialogueScript({ version: 1, turns: [] })).toBe(false);
    expect(isDialogueScript({ version: 2 })).toBe(false);
    expect(
      isDialogueScript({ version: 2, turns: [{ index: 0, speaker: "x", text: "a", targetWords: [] }] })
    ).toBe(false);
  });

  it("accepts a script that is well-formed but rule-breaking", () => {
    // Shape guard only — content rules are `validateScript`'s job.
    const tooShort = script([{ speaker: "system", text: "Hi." }]);
    expect(isDialogueScript(tooShort)).toBe(true);
    expect(validateScript(tooShort, WORDS).ok).toBe(false);
  });
});
