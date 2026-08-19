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

  const prompt = `You are an expert English dialogue writer for Vietnamese learners at ${level} level.

Create a natural, engaging dialogue between two people: Alex (A) and Sam (B).

Requirements:
- Setting/context: ${context}
- Level: ${level} (use vocabulary and grammar appropriate for this level)
- Length: 8-12 exchanges total
- Naturally incorporate ALL of the following target vocabulary words. Bold them when they appear.
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
  // Try models in order until one works
  const models = [
    "gemini-2.5-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
    "gemini-flash-latest",
  ];

  let lastError = "";

  for (const modelName of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 2048,
          },
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
