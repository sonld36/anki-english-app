import { NextRequest, NextResponse } from "next/server";
import type { VocabularyItem } from "@/lib/vocabulary/types";
import type { DialogueLevel } from "@/lib/gemini";
import {
  DIALOGUE_SCRIPT_VERSION,
  MAX_TARGET_WORDS_PER_SCRIPT,
  MAX_TARGET_WORDS_PER_TURN,
  MAX_TURNS,
  MIN_TURNS,
  type DialogueScript,
  type DialogueTurn,
  type Speaker,
} from "@/lib/dialogue/types";
import { validateScript } from "@/lib/dialogue/validate";

/**
 * Gemini `responseSchema` (OpenAPI subset). `index` is deliberately absent —
 * the route assigns it from array position, so the model cannot get it wrong.
 */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    turns: {
      type: "array",
      // Enforced structurally as well as in prose: turn count is one of the
      // likeliest repair triggers, and without a minimum an empty `turns`
      // array is schema-valid.
      minItems: MIN_TURNS,
      maxItems: MAX_TURNS,
      items: {
        type: "object",
        properties: {
          speaker: { type: "string", enum: ["system", "learner"] },
          text: { type: "string" },
          targetWords: { type: "array", items: { type: "string" } },
        },
        required: ["speaker", "text", "targetWords"],
        propertyOrdering: ["speaker", "text", "targetWords"],
      },
    },
  },
  required: ["turns"],
};

// Use Gemini REST API directly — most reliable approach.
// Try models in order until one works. gemini-2.0-flash and
// gemini-2.0-flash-lite were retired by Google; gemini-flash-latest is
// an unstable alias that returns frequent 503s. Pin to concrete current
// model names instead.
const models = [
  "gemini-2.5-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
];

type ModelCall =
  | { ok: true; raw: unknown; text: string }
  /** `fatal` stops the model fallback — the next model would fail identically. */
  | { ok: false; error: string; fatal: boolean };

async function callModel(
  apiKey: string,
  modelName: string,
  prompt: string
): Promise<ModelCall> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const generationConfig: Record<string, unknown> = {
      temperature: 0.8,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      // All current Gemini models default to "thinking" mode, which
      // eats into maxOutputTokens before any visible text is produced.
      // thinkingBudget: 0 is rejected (400) by some 3.x models, so use
      // a small positive budget instead — verified to work across
      // 2.5/3.5/3.6 flash variants and cuts hidden reasoning tokens
      // from 900+ down to under 200.
      thinkingConfig: { thinkingBudget: 128 },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await res.json();

    if (!res.ok) {
      const error = data?.error?.message ?? `HTTP ${res.status}`;
      // Only an auth failure is fatal — every model would reject the same key.
      // A 400 is NOT fatal: with responseSchema / propertyOrdering /
      // thinkingConfig in the request it just as likely means "this model
      // rejects this generation config", and one picky model must not take the
      // rest of the list down with it.
      return {
        ok: false,
        error,
        fatal: res.status === 401 || res.status === 403,
      };
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string" || !text.trim()) {
      return { ok: false, error: "Empty response", fatal: false };
    }

    try {
      return { ok: true, raw: JSON.parse(text), text };
    } catch {
      // A body that will not parse is a malfunction, not a rule violation —
      // fall through to the next model rather than spending the repair turn.
      return { ok: false, error: "Model returned unparseable JSON", fatal: false };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
      fatal: false,
    };
  }
}

/**
 * Turn raw model output into a `DialogueScript` without judging it. Anything
 * malformed is carried through as-is so `validateScript` can name it; the only
 * corrections made here are ones the model cannot get wrong: `index` comes
 * from array position, and each target word is snapped back to the spelling
 * that was requested so downstream code can join on it.
 */
function buildScript(raw: unknown, requestedWords: string[]): DialogueScript {
  const rawTurns = (raw as { turns?: unknown })?.turns;
  const list = Array.isArray(rawTurns) ? rawTurns : [];
  const canonical = new Map(
    requestedWords.map((word) => [word.trim().toLowerCase(), word.trim()])
  );

  const turns: DialogueTurn[] = list.map((entry, index) => {
    const turn = (entry ?? {}) as Partial<DialogueTurn>;
    const targetWords = Array.isArray(turn.targetWords) ? turn.targetWords : [];
    return {
      index,
      // Not validated here on purpose — the validator reports a bad speaker.
      speaker: turn.speaker as Speaker,
      text: typeof turn.text === "string" ? turn.text.trim() : "",
      targetWords: targetWords
        .filter((word): word is string => typeof word === "string")
        .map((word) => canonical.get(word.trim().toLowerCase()) ?? word.trim()),
    };
  });

  return { version: DIALOGUE_SCRIPT_VERSION, turns };
}

function isDialogueLevel(value: unknown): value is DialogueLevel {
  return typeof value === "string" && Object.hasOwn(levelGuide, value);
}

const levelGuide: Record<DialogueLevel, string> = {
  A2: "very simple, high-frequency everyday words and short, basic sentence structures (present simple, present continuous, simple past). Avoid idioms, phrasal verbs, and complex clauses.",
  B1: "common, everyday words and moderately simple sentence structures. Avoid rare or academic vocabulary and overly complex clauses.",
  B2: "natural, moderately varied vocabulary, but still avoid obscure or highly academic words that a general learner wouldn't know.",
};

function buildPrompt(
  cards: VocabularyItem[],
  context: string,
  level: DialogueLevel
): string {
  const wordList = cards.map((c) => `- ${c.word}: ${c.meaning}`).join("\n");

  return `You are an expert English dialogue writer for Vietnamese learners at ${level} level.

Write a natural, engaging two-person dialogue and return it as JSON matching the required schema. Return JSON only — no markdown, no commentary, no extra sections.

The two speakers are roles, not names:
- "system" — the conversation partner. Speaks first.
- "learner" — the Vietnamese learner who will practise saying these lines.
Alternate between them; both must appear.

Requirements:
- Setting/context: ${context}
- Between ${MIN_TURNS} and ${MAX_TURNS} turns in total.
- Level governs only the language AROUND the target words: apart from the target vocabulary, every other word must be simple and match ${level} level: ${levelGuide[level]}. Never simplify, inflect, or replace a target word itself.
- Use everyday, commonly-spoken expressions that native speakers actually use in daily conversation — avoid textbook-sounding or overly formal phrasing.
- Every target word listed below must appear at least once across the dialogue, spelled exactly as requested.
- Each turn may contain AT MOST ${MAX_TARGET_WORDS_PER_TURN} target words — never more than ${MAX_TARGET_WORDS_PER_TURN} in the same turn. Spread the words across turns instead of clustering them.
- For every turn, "targetWords" must list exactly the target words that literally appear in that turn's "text", and nothing else. Never list a word that is not in the text, and never omit one that is. An inflected form does not count: if the text says "colder", the target word "cold" is NOT present in that turn.
- Pronunciation constraint, important: a target word ending in -ed, -s, -d or -t must NOT be immediately followed by a word starting with that same consonant. Avoid "walked to", "cold drink", "needs some" — a native speaker does not release the ending there. Put a different word, or a comma, after the target word.
- Make the dialogue feel authentic — not forced or robotic.

Target vocabulary (ALL must appear):
${wordList}`;
}

function buildRepairPrompt(
  basePrompt: string,
  previousJson: string,
  violations: string[]
): string {
  return `${basePrompt}

---

Your previous attempt was rejected. This is what you returned:

${previousJson}

These rules were broken:
${violations.map((v) => `- ${v}`).join("\n")}

Rewrite the dialogue and return corrected JSON. Fix every problem listed above without introducing new ones, and keep all the original requirements.`;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    return NextResponse.json(
      { error: "GEMINI_API_KEY chưa được cấu hình. Thêm key vào file .env.local" },
      { status: 503 }
    );
  }

  let body: { cards?: VocabularyItem[]; context?: string; level?: unknown };
  try {
    body = await req.json();
  } catch {
    // An unparseable body must not throw past the Vietnamese error handling.
    return NextResponse.json(
      { error: "Yêu cầu không hợp lệ." },
      { status: 400 }
    );
  }

  const cards = body?.cards;
  if (!Array.isArray(cards) || cards.length === 0) {
    return NextResponse.json({ error: "Không có từ vựng" }, { status: 400 });
  }

  // `level` is client-supplied: anything not in the guide would inject the
  // literal `undefined` into the prompt.
  const level: DialogueLevel = isDialogueLevel(body?.level) ? body.level : "B1";
  const context = typeof body?.context === "string" ? body.context : "everyday life";

  // Filter before slicing, so a blank card cannot eat one of the 20 slots —
  // and so the prompt and the validator see the same list. Asking for a word
  // that is not in the requested set produces a script no retry can fix.
  const selected = cards
    .filter((c) => typeof c?.word === "string" && c.word.trim().length > 0)
    .slice(0, MAX_TARGET_WORDS_PER_SCRIPT);
  const requestedWords = selected.map((c) => c.word.trim());

  if (requestedWords.length === 0) {
    return NextResponse.json({ error: "Không có từ vựng" }, { status: 400 });
  }

  const basePrompt = buildPrompt(selected, context, level);

  // First pass: fall through the model list on transport-class failures only.
  let lastError = "";
  let workingModel: string | null = null;
  let firstAttempt: { raw: unknown; text: string } | null = null;

  for (const modelName of models) {
    const result = await callModel(apiKey, modelName, basePrompt);
    if (result.ok) {
      workingModel = modelName;
      firstAttempt = { raw: result.raw, text: result.text };
      break;
    }
    lastError = result.error;
    console.error(`Model ${modelName} failed:`, lastError);
    if (result.fatal) break;
  }

  if (!firstAttempt || !workingModel) {
    console.error("All Gemini models failed. Last error:", lastError);
    return NextResponse.json(
      { error: `Lỗi Gemini API: ${lastError}` },
      { status: 500 }
    );
  }

  const script = buildScript(firstAttempt.raw, requestedWords);
  const result = validateScript(script, requestedWords);
  if (result.ok) {
    return NextResponse.json({ script });
  }

  // Exactly one repair attempt, on the same model. A validation failure means
  // the model understood and got it wrong, so switching models is not the fix —
  // feeding back the specific violations is. The free tier allows one
  // concurrent request and a call runs 5–15s, so the loop stops here.
  console.warn(`Script from ${workingModel} rejected:`, result.violations);
  let violations = result.violations;

  const retry = await callModel(
    apiKey,
    workingModel,
    buildRepairPrompt(basePrompt, firstAttempt.text, violations)
  );

  if (!retry.ok) {
    // The repair call never came back. That is a transport failure, not a rule
    // failure — telling the user to change topic would be a lie, and only a
    // validated rejection may produce a 422.
    console.error(`Repair attempt on ${workingModel} failed:`, retry.error);
    return NextResponse.json(
      { error: `Lỗi Gemini API: ${retry.error}` },
      { status: 500 }
    );
  }

  const retryScript = buildScript(retry.raw, requestedWords);
  const retryResult = validateScript(retryScript, requestedWords);
  if (retryResult.ok) {
    return NextResponse.json({ script: retryScript });
  }

  violations = retryResult.violations;
  console.warn(`Repaired script from ${workingModel} rejected:`, violations);

  // `violations` is diagnostic: English, model-facing, never shown to the user.
  return NextResponse.json(
    {
      error:
        "Kịch bản sinh ra chưa đạt yêu cầu sau 2 lần thử. Bạn hãy thử lại, hoặc đổi chủ đề / giảm số từ.",
      violations,
    },
    { status: 422 }
  );
}
