import { NextRequest, NextResponse } from "next/server";
import type { ParsedCard } from "@/lib/anki";
import type { DialogueLevel } from "@/lib/gemini";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    return NextResponse.json(
      { error: "GEMINI_API_KEY chưa được cấu hình. Thêm key vào file .env.local" },
      { status: 503 }
    );
  }

  const { cards, context, level } = (await req.json()) as {
    cards: ParsedCard[];
    context: string;
    level: DialogueLevel;
  };

  if (!cards?.length) {
    return NextResponse.json({ error: "Không có từ vựng" }, { status: 400 });
  }

  const wordList = cards
    .slice(0, 20)
    .map((c) => `- **${c.word}**: ${c.meaning}`)
    .join("\n");

  const levelGuide: Record<DialogueLevel, string> = {
    A2: "very simple, high-frequency everyday words and short, basic sentence structures (present simple, present continuous, simple past). Avoid idioms, phrasal verbs, and complex clauses.",
    B1: "common, everyday words and moderately simple sentence structures. Avoid rare or academic vocabulary and overly complex clauses.",
    B2: "natural, moderately varied vocabulary, but still avoid obscure or highly academic words that a general learner wouldn't know.",
  };

  const prompt = `You are an expert English dialogue writer for Vietnamese learners at ${level} level.

Create a natural, engaging dialogue between two people: Alex (A) and Sam (B).

Requirements:
- Setting/context: ${context}
- Level: ${level} (use vocabulary and grammar appropriate for this level)
- Except for the bolded target vocabulary words, every other word in the dialogue must be simple and match ${level} level: ${levelGuide[level]}
- Use everyday, commonly-spoken expressions that native speakers actually use in daily conversation — avoid textbook-sounding or overly formal phrasing
- Length: at least 5 exchanges (lines), up to 12
- Naturally incorporate ALL of the following target vocabulary words. Bold them when they appear.
- Each individual line (one **A (Alex):** or **B (Sam):** line) must contain AT MOST 2 target vocabulary words — never more than 2 in the same line. Spread the words across multiple lines instead of clustering them.
- Make the dialogue feel authentic — not forced or robotic
- After the dialogue, add a "## 📚 Vocabulary in Context" section with:
  - Each target word used in a short, memorable example sentence different from the dialogue

Target vocabulary to use (ALL must appear):
${wordList}

Format using markdown. Start with the dialogue directly (no intro text).
Use this format for each line:
**A (Alex):** [dialogue line]
**B (Sam):** [dialogue line]`;

  // Use Gemini REST API directly — most reliable approach
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

  let lastError = "";

  for (const modelName of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      const generationConfig: Record<string, unknown> = {
        temperature: 0.8,
        maxOutputTokens: 4096,
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
        lastError = data?.error?.message ?? `HTTP ${res.status}`;
        console.error(`Model ${modelName} failed:`, lastError);
        // If quota exceeded, try next model. If key invalid, stop.
        if (res.status === 400 || res.status === 403) break;
        continue;
      }

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        lastError = "Empty response";
        continue;
      }

      return NextResponse.json({ dialogue: text });
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Unknown error";
      console.error(`Model ${modelName} error:`, err);
    }
  }

  console.error("All Gemini models failed. Last error:", lastError);
  return NextResponse.json(
    { error: `Lỗi Gemini API: ${lastError}` },
    { status: 500 }
  );
}
