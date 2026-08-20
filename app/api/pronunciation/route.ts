import { NextRequest, NextResponse } from "next/server";

/**
 * Pronunciation assessment lab endpoint. Two providers, deliberately kept
 * side by side so we can compare them on the same recording:
 *
 *  - azure:  real phoneme-level scoring (the candidate for production)
 *  - gemini: qualitative LLM judgement, usable today with the key we already
 *            have. NOT a substitute — it has no acoustic model, so treat its
 *            numbers as opinion, not measurement.
 *
 * Audio must be mono 16 kHz 16-bit PCM WAV (see lib/wav.ts).
 */

interface AzureConfig {
  ReferenceText: string;
  GradingSystem: "HundredMark";
  Granularity: "Phoneme";
  EnableMiscue: boolean;
  EnableProsodyAssessment: boolean;
  PhonemeAlphabet: "IPA";
  NBestPhonemeCount: number;
}

async function assessWithAzure(wav: ArrayBuffer, referenceText: string) {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;

  if (!key || !region) {
    return NextResponse.json(
      {
        error:
          "Chưa cấu hình AZURE_SPEECH_KEY / AZURE_SPEECH_REGION trong .env.local",
      },
      { status: 503 }
    );
  }

  const config: AzureConfig = {
    ReferenceText: referenceText,
    GradingSystem: "HundredMark",
    Granularity: "Phoneme",
    // Miscue detection is what surfaces Omission/Insertion — the dropped final
    // consonants and swallowed endings that matter most for Vietnamese speakers.
    EnableMiscue: true,
    EnableProsodyAssessment: true,
    PhonemeAlphabet: "IPA",
    NBestPhonemeCount: 5,
  };

  const url =
    `https://${region}.stt.speech.microsoft.com` +
    `/speech/recognition/conversation/cognitiveservices/v1` +
    `?language=en-US&format=detailed`;

  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
      "Pronunciation-Assessment": Buffer.from(JSON.stringify(config)).toString(
        "base64"
      ),
      Accept: "application/json",
    },
    body: wav,
  });
  const latencyMs = Date.now() - started;

  const raw = await res.text();
  if (!res.ok) {
    return NextResponse.json(
      { error: `Azure ${res.status}: ${raw.slice(0, 500)}` },
      { status: 502 }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: `Azure trả về phản hồi không phải JSON: ${raw.slice(0, 300)}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ provider: "azure", latencyMs, raw: parsed });
}

async function assessWithGemini(wav: ArrayBuffer, referenceText: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    return NextResponse.json(
      { error: "GEMINI_API_KEY chưa được cấu hình" },
      { status: 503 }
    );
  }

  const prompt = `You are assessing the English pronunciation of a Vietnamese learner.

The learner was asked to say exactly this sentence:
"${referenceText}"

Listen to the attached audio and assess it. Vietnamese speakers of English
systematically make these errors — check for each of them specifically:
- dropping final consonants (walked -> walk, find -> fine)
- dropping the -s plural / third-person ending and the -ed past ending
- simplifying consonant clusters (strong -> song, texts -> tex)
- substituting /th/ with /t/ or /d/
- confusing /s/ and /sh/, and short vs long vowels (ship vs sheep)
- flat, monotone intonation with no sentence stress

Report only what you can actually hear. Do not invent errors to seem thorough,
and do not smooth over real ones to be kind.`;

  const schema = {
    type: "object",
    properties: {
      heardTranscript: {
        type: "string",
        description: "Verbatim transcription of what was actually said, including errors — do NOT correct it",
      },
      matchesReference: { type: "boolean" },
      overallScore: { type: "integer", description: "0-100" },
      intonationScore: { type: "integer", description: "0-100" },
      wordIssues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            word: { type: "string" },
            issue: { type: "string" },
            severity: { type: "string", enum: ["low", "medium", "high"] },
            breaksComprehension: { type: "boolean" },
          },
          required: ["word", "issue", "severity", "breaksComprehension"],
        },
      },
      summaryVi: { type: "string", description: "One-paragraph summary in Vietnamese" },
    },
    required: [
      "heardTranscript",
      "matchesReference",
      "overallScore",
      "intonationScore",
      "wordIssues",
      "summaryVi",
    ],
  };

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
    apiKey;

  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: "audio/wav",
                data: Buffer.from(wav).toString("base64"),
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: schema,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  const latencyMs = Date.now() - started;

  const body = await res.text();
  if (!res.ok) {
    return NextResponse.json(
      { error: `Gemini ${res.status}: ${body.slice(0, 500)}` },
      { status: 502 }
    );
  }

  const json = JSON.parse(body);
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    return NextResponse.json(
      { error: "Gemini không trả về nội dung", raw: json },
      { status: 502 }
    );
  }

  return NextResponse.json({
    provider: "gemini",
    latencyMs,
    raw: JSON.parse(text),
  });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const audio = form.get("audio");
  const referenceText = String(form.get("referenceText") ?? "").trim();
  const provider = String(form.get("provider") ?? "azure");

  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "Thiếu file audio" }, { status: 400 });
  }
  if (!referenceText) {
    return NextResponse.json({ error: "Thiếu câu tham chiếu" }, { status: 400 });
  }

  const wav = await audio.arrayBuffer();

  try {
    return provider === "gemini"
      ? await assessWithGemini(wav, referenceText)
      : await assessWithAzure(wav, referenceText);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
