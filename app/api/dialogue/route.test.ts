import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import type { DialogueScript } from "@/lib/dialogue/types";

/**
 * The route is transport code, so everything here is stubbed at `fetch`. What
 * it proves is the part the validator suite cannot: how many generation calls
 * happen, which model they go to, and which status the user ends up seeing.
 */

type GeminiHints = { situation: string; keywords: string[] };
type GeminiTurn = {
  speaker: string;
  text: string;
  targetWords: string[];
  hints?: GeminiHints;
};

let calls: { model: string; prompt: string }[] = [];

const CARDS = [
  { id: "1", word: "cold", meaning: "lạnh" },
  { id: "2", word: "weather", meaning: "thời tiết" },
];

function validTurns(): GeminiTurn[] {
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
    { speaker: "system", text: "Did you bring a warm coat?", targetWords: [] },
    {
      speaker: "learner",
      text: "Yes, I found my old one.",
      targetWords: [],
      hints: {
        situation: "Khi bạn trả lời rằng mình đã chuẩn bị xong.",
        keywords: ["found", "old"],
      },
    },
    { speaker: "system", text: "Good, you will need it.", targetWords: [] },
  ];
}

/** A turn set that breaks a rule: `cold` is claimed but only `colder` is there. */
function invalidTurns(): GeminiTurn[] {
  const turns = validTurns();
  turns[0] = {
    speaker: "system",
    text: "It is much colder outside today.",
    targetWords: ["cold"],
  };
  return turns;
}

/** Every script rule met; only the hint ladder is wrong (a learner turn has none). */
function hintOnlyBadTurns(): GeminiTurn[] {
  const turns = validTurns();
  delete turns[1].hints;
  return turns;
}

type Reply =
  | { kind: "script"; turns: GeminiTurn[] }
  | { kind: "text"; text: string }
  | { kind: "http"; status: number; message: string }
  | { kind: "throw"; message: string };

/** Answers Gemini calls in order; the last reply repeats once exhausted. */
function stubGemini(replies: Reply[]) {
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    const model = /models\/([^:]+):/.exec(url)?.[1] ?? "?";
    const body = JSON.parse(init?.body ?? "{}");
    calls.push({ model, prompt: body?.contents?.[0]?.parts?.[0]?.text ?? "" });

    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply.kind === "throw") throw new Error(reply.message);
    if (reply.kind === "http") {
      return {
        ok: false,
        status: reply.status,
        json: async () => ({ error: { message: reply.message } }),
      };
    }
    const text = reply.kind === "text" ? reply.text : JSON.stringify({ turns: reply.turns });
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function request(body: unknown = { cards: CARDS, context: "Coffee shop", level: "B1" }) {
  return new NextRequest("http://localhost/api/dialogue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  calls = [];
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/dialogue — valid script", () => {
  it("returns the script with speakers, indexes and per-turn target words", async () => {
    stubGemini([{ kind: "script", turns: validTurns() }]);

    const res = await POST(request());
    const body = (await res.json()) as { script: DialogueScript };

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(body.script.version).toBe(3);
    expect(body.script.turns.map((t) => t.index)).toEqual([0, 1, 2, 3, 4]);
    expect(body.script.turns[0].speaker).toBe("system");
    expect(body.script.turns[0].targetWords).toEqual(["cold"]);
    expect(body.script.turns[1].targetWords).toEqual(["weather"]);
  });

  it("carries the hint ladder through on learner turns only", async () => {
    // Hints ride along with the script in the same call — nothing is fetched
    // later, so whatever is here is all the learner will ever get.
    stubGemini([{ kind: "script", turns: validTurns() }]);

    const res = await POST(request());
    const body = (await res.json()) as { script: DialogueScript };

    expect(res.status).toBe(200);
    expect(body.script.turns[1].hints).toEqual({
      situation: "Khi bạn đồng tình với nhận xét về trời trở lạnh.",
      keywords: ["weather", "changed"],
    });
    expect(body.script.turns.filter((t) => t.hints).map((t) => t.speaker)).toEqual([
      "learner",
      "learner",
    ]);
  });

  it("asks for hints in the response schema, without requiring them per turn", async () => {
    const fetchMock = stubGemini([{ kind: "script", turns: validTurns() }]);

    await POST(request());

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body ?? "{}");
    const turnSchema = body.generationConfig.responseSchema.properties.turns.items;
    expect(turnSchema.properties.hints.required).toEqual(["situation", "keywords"]);
    // A system turn must be able to omit hints entirely.
    expect(turnSchema.required).not.toContain("hints");
  });

  it("strips hints the model put on a system turn", async () => {
    // They are kept through validation so the repair can be told about them,
    // but "only learner turns carry hints" is an invariant of the stored
    // shape: a script breaking it must never reach localStorage.
    const turns = validTurns();
    turns[2].hints = { situation: "Khi bạn hỏi thăm.", keywords: ["coat"] };
    stubGemini([{ kind: "script", turns }]);

    const res = await POST(request());
    const body = (await res.json()) as { script: DialogueScript };

    expect(res.status).toBe(200);
    expect(body.script.turns[2].hints).toBeUndefined();
    // The repair heard about it before it was stripped.
    expect(calls[1].prompt).toContain('Turn 3 is a "system" turn but carries `hints`');
    // And the learner ladders survived.
    expect(body.script.turns[1].hints?.keywords).toEqual(["weather", "changed"]);
  });

  it("200s on hints that are structurally junk rather than 422ing", async () => {
    const turns = validTurns();
    // Neither shape survives `buildHints`, so the turn reads as un-hinted —
    // a hint fault, never a script fault.
    (turns[1] as { hints?: unknown }).hints = [];
    (turns[3] as { hints?: unknown }).hints = { situation: 42, keywords: [7] };
    stubGemini([{ kind: "script", turns }]);

    const res = await POST(request());
    const body = (await res.json()) as { script: DialogueScript; violations?: string[] };

    expect(res.status).toBe(200);
    expect(body.violations).toBeUndefined();
    expect(body.script.turns[1].hints).toBeUndefined();
    expect(body.script.turns[3].hints).toBeUndefined();
    expect(calls[1].prompt).toContain('Turn 2 is a "learner" turn with no `hints`');
  });

  it("tells the model the hint rules in the prompt", async () => {
    stubGemini([{ kind: "script", turns: validTurns() }]);

    await POST(request());

    expect(calls[0].prompt).toContain('EVERY "learner" turn must carry a "hints" object');
    expect(calls[0].prompt).toContain("AT MOST 2 other content words");
    expect(calls[0].prompt).toContain("No hint level may reveal the whole line");
    // The prompt must state the rule the validator actually enforces: the
    // same threshold, counted in content words.
    expect(calls[0].prompt).toContain("never reuse 4 or more of its content words in a row");
    expect(calls[0].prompt).toContain(
      'EVERY keyword must be a word that literally appears in this turn\'s own "text"'
    );
  });

  it("snaps target words back to the requested spelling", async () => {
    const turns = validTurns();
    turns[0].targetWords = ["Cold"];
    stubGemini([{ kind: "script", turns }]);

    const res = await POST(request());
    const body = (await res.json()) as { script: DialogueScript };

    expect(body.script.turns[0].targetWords).toEqual(["cold"]);
  });

  it("asks for JSON against a response schema and keeps thinkingConfig", async () => {
    const fetchMock = stubGemini([{ kind: "script", turns: validTurns() }]);

    await POST(request());

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body ?? "{}");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.properties.turns.type).toBe("array");
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 128 });
  });

  it("constrains the turn count in the schema, not only in the prose", async () => {
    const fetchMock = stubGemini([{ kind: "script", turns: validTurns() }]);

    await POST(request());

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body ?? "{}");
    expect(body.generationConfig.responseSchema.properties.turns.minItems).toBe(5);
    expect(body.generationConfig.responseSchema.properties.turns.maxItems).toBe(12);
  });
});

describe("POST /api/dialogue — request validation", () => {
  it("drops blank-word cards before they reach the prompt", async () => {
    stubGemini([{ kind: "script", turns: validTurns() }]);

    await POST(
      request({
        cards: [{ id: "0", word: "   ", meaning: "nghĩa mồ côi" }, ...CARDS],
        context: "Coffee shop",
        level: "B1",
      })
    );

    // A prompt line of "- : nghĩa mồ côi" would ask for a word that is not in
    // the requested set, producing a script no retry could fix.
    expect(calls[0].prompt).not.toContain("nghĩa mồ côi");
    expect(calls[0].prompt).toContain("- cold: lạnh");
  });

  it("400s when every card has a blank word, without calling a model", async () => {
    stubGemini([{ kind: "script", turns: validTurns() }]);

    const res = await POST(
      request({ cards: [{ id: "1", word: "   ", meaning: "lạnh" }], context: "Cafe", level: "B1" })
    );
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("Không có từ vựng");
    expect(calls).toHaveLength(0);
  });

  it("falls back to B1 rather than injecting `undefined` into the prompt", async () => {
    stubGemini([{ kind: "script", turns: validTurns() }]);

    await POST(request({ cards: CARDS, context: "Coffee shop", level: "Z9" }));

    expect(calls[0].prompt).not.toContain("undefined");
    expect(calls[0].prompt).toContain("at B1 level");
  });

  it("400s on an unparseable body instead of throwing", async () => {
    stubGemini([{ kind: "script", turns: validTurns() }]);

    const req = new NextRequest("http://localhost/api/dialogue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("Yêu cầu không hợp lệ.");
    expect(calls).toHaveLength(0);
  });
});

describe("POST /api/dialogue — repair attempt", () => {
  it("retries exactly once, on the same model, with the violations fed back", async () => {
    stubGemini([
      { kind: "script", turns: invalidTurns() },
      { kind: "script", turns: validTurns() },
    ]);

    const res = await POST(request());
    const body = (await res.json()) as { script: DialogueScript };

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1].model).toBe(calls[0].model);
    expect(calls[1].prompt).toContain("Your previous attempt was rejected");
    expect(calls[1].prompt).toContain('does not contain "cold" as a whole word');
    expect(body.script.turns[0].text).toBe("It is really cold outside today.");
  });

  it("gives up with a 422 and the violations after the second failure", async () => {
    stubGemini([{ kind: "script", turns: invalidTurns() }]);

    const res = await POST(request());
    const body = (await res.json()) as { error: string; violations: string[] };

    // Exactly two successful generation calls, never a third.
    expect(calls).toHaveLength(2);
    expect(res.status).toBe(422);
    expect(body.error).toContain("chưa đạt yêu cầu");
    expect(body.violations.join("\n")).toContain('The target word "cold" never appears');
  });

  it("repairs once when only the hints are wrong, and takes the fix", async () => {
    stubGemini([
      { kind: "script", turns: hintOnlyBadTurns() },
      { kind: "script", turns: validTurns() },
    ]);

    const res = await POST(request());
    const body = (await res.json()) as { script: DialogueScript };

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1].prompt).toContain('Turn 2 is a "learner" turn with no `hints`');
    expect(body.script.turns[1].hints?.keywords).toEqual(["weather", "changed"]);
  });

  it("returns the script with a 200 when only the hints are still wrong", async () => {
    // Hints have no consumer until Story 2.4. A faulty rung must not cost the
    // user a whole generation — the violations are logged, not surfaced.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubGemini([{ kind: "script", turns: hintOnlyBadTurns() }]);

    const res = await POST(request());
    const body = (await res.json()) as {
      script: DialogueScript;
      violations?: string[];
    };

    expect(calls).toHaveLength(2);
    expect(res.status).toBe(200);
    expect(body.script.turns).toHaveLength(5);
    expect(body.script.turns[1].hints).toBeUndefined();
    expect(body.violations).toBeUndefined();
    expect(
      warn.mock.calls.some(
        (args) =>
          String(args[0]).includes("accepted with faulty hints") &&
          (args[1] as string[]).join("\n").includes(
            'Turn 2 is a "learner" turn with no `hints`'
          )
      )
    ).toBe(true);
    warn.mockRestore();
  });

  it("keeps a script-valid first attempt when the repair call transport-fails", async () => {
    // The first attempt satisfied every rule Epic 2 rests on; only a rung of
    // the ladder was wrong. A quota error on the repair must not turn that
    // into a 500 and cost the user the script they already had.
    stubGemini([
      { kind: "script", turns: hintOnlyBadTurns() },
      { kind: "http", status: 429, message: "Quota exceeded" },
    ]);

    const res = await POST(request());
    const body = (await res.json()) as { script?: DialogueScript; error?: string };

    expect(calls).toHaveLength(2);
    expect(res.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.script?.turns).toHaveLength(5);
    expect(body.script?.turns[0].text).toBe("It is really cold outside today.");
  });

  it("keeps a script-valid first attempt when the repair regresses", async () => {
    // The repair broke a script rule that the first attempt obeyed. Returning
    // the regression as a 422 would throw away a usable script over hints.
    stubGemini([
      { kind: "script", turns: hintOnlyBadTurns() },
      { kind: "script", turns: invalidTurns() },
    ]);

    const res = await POST(request());
    const body = (await res.json()) as { script?: DialogueScript; violations?: string[] };

    expect(calls).toHaveLength(2);
    expect(res.status).toBe(200);
    expect(body.violations).toBeUndefined();
    expect(body.script?.turns[0].text).toBe("It is really cold outside today.");
  });

  it("prefers the attempt with fewer hint faults when both are script-clean", async () => {
    const worse = hintOnlyBadTurns();
    delete worse[3].hints;
    const better = hintOnlyBadTurns();

    stubGemini([
      { kind: "script", turns: worse },
      { kind: "script", turns: better },
    ]);

    const res = await POST(request());
    const body = (await res.json()) as { script: DialogueScript };

    expect(res.status).toBe(200);
    // The repair fixed one of the two ladders; that is the one to keep.
    expect(body.script.turns[3].hints?.keywords).toEqual(["found", "old"]);
  });

  it("still 422s when a script rule fails, whatever the hints say", async () => {
    stubGemini([{ kind: "script", turns: invalidTurns() }]);

    const res = await POST(request());
    const body = (await res.json()) as { error: string; violations: string[] };

    expect(res.status).toBe(422);
    expect(body.violations.join("\n")).toContain('The target word "cold" never appears');
    // The 422 body stays script-level: hint faults are logged, never surfaced.
    expect(body.violations.join("\n")).not.toContain("`hints`");
  });

  it("does not switch models when the failure is a rule violation", async () => {
    stubGemini([{ kind: "script", turns: invalidTurns() }]);

    await POST(request());

    expect(new Set(calls.map((c) => c.model)).size).toBe(1);
  });

  it("500s when the repair call itself fails, rather than blaming the rules", async () => {
    stubGemini([
      { kind: "script", turns: invalidTurns() },
      { kind: "http", status: 429, message: "Quota exceeded" },
    ]);

    const res = await POST(request());
    const body = (await res.json()) as { error: string; violations?: string[] };

    // A quota error or timeout must not tell the user to change topic.
    expect(res.status).toBe(500);
    expect(body.error).toContain("Quota exceeded");
    expect(body.violations).toBeUndefined();
  });

  it("500s when the repair call times out", async () => {
    stubGemini([
      { kind: "script", turns: invalidTurns() },
      { kind: "throw", message: "The operation was aborted due to timeout" },
    ]);

    const res = await POST(request());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(body.error).toContain("timeout");
  });
});

describe("POST /api/dialogue — transport failures", () => {
  it("falls through the model list on quota errors, then 500s", async () => {
    stubGemini([{ kind: "http", status: 429, message: "Quota exceeded" }]);

    const res = await POST(request());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(body.error).toContain("Quota exceeded");
    expect(calls.map((c) => c.model)).toEqual([
      "gemini-2.5-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
    ]);
  });

  it("stops the fallback on an auth failure rather than burning every model", async () => {
    stubGemini([{ kind: "http", status: 403, message: "API key not valid" }]);

    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(calls).toHaveLength(1);
  });

  it("keeps falling through on a 400 — one picky model must not stop the rest", async () => {
    // With responseSchema / propertyOrdering / thinkingConfig in the request,
    // a 400 is as likely to mean "this model rejects this config" as bad auth.
    stubGemini([
      { kind: "http", status: 400, message: "Invalid JSON payload: minItems" },
      { kind: "script", turns: validTurns() },
    ]);

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(calls.map((c) => c.model)).toEqual(["gemini-2.5-flash", "gemini-3.6-flash"]);
  });

  it("treats an unparseable body as a transport failure and tries the next model", async () => {
    stubGemini([
      { kind: "text", text: "**A (Alex):** not JSON at all" },
      { kind: "script", turns: validTurns() },
    ]);

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(calls.map((c) => c.model)).toEqual(["gemini-2.5-flash", "gemini-3.6-flash"]);
  });

  it("reports a missing API key in Vietnamese without calling out", async () => {
    vi.stubEnv("GEMINI_API_KEY", "your_gemini_api_key_here");
    stubGemini([{ kind: "script", turns: validTurns() }]);

    const res = await POST(request());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(503);
    expect(body.error).toContain("GEMINI_API_KEY chưa được cấu hình");
    expect(calls).toHaveLength(0);
  });

  it("rejects an empty vocabulary list", async () => {
    stubGemini([{ kind: "script", turns: validTurns() }]);

    const res = await POST(request({ cards: [], context: "Coffee shop", level: "B1" }));

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
