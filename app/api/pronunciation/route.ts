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
 *
 * The app's **second Azure proxy**, and it holds the same line the first one
 * does (`app/api/tts/route.ts`): one bounded timeout on each side, a 401 branch
 * for a credential Azure *rejects* as distinct from one that was never
 * configured, the key redacted out of anything a provider echoes back, and a
 * cap on every field that is billed (the audio by the second, the reference
 * text by the character). The provider name is a closed set, the same reflex
 * `ALLOWED_ACTIONS` and `ALLOWED_VOICES` apply to their own fields. `app/api/live-token/route.ts` hands the raw
 * `GEMINI_API_KEY` to the browser; that is a documented dev-only shortcut and
 * explicitly the mistake neither proxy may repeat.
 */

/**
 * How long to wait on a provider before giving up.
 *
 * Without it a hung connection stalls the learner's turn forever: the score
 * card sits in its pending state, nothing errors, and no notice ever appears.
 * Same 15s as the TTS proxy; `hooks/useTurnScorer.ts` waits 20s, so the
 * server's message wins the race and the browser hears a real reason.
 */
const PROVIDER_TIMEOUT_MS = 15_000;

/**
 * The providers this route will talk to, as a closed set.
 *
 * `provider` arrives in a `FormData` the browser fills in, so it is user input
 * like any other. Before this it was compared against the literal `"gemini"`
 * and *everything else* — a typo, a probe, the name of a provider someone
 * hoped we had — fell through to Azure and was billed there. The reflex is
 * `ALLOWED_ACTIONS` in `app/api/anki/route.ts` and `ALLOWED_VOICES` in
 * `app/api/tts/route.ts`: name what is allowed and refuse the rest, rather
 * than name one thing and let the default catch the world.
 */
const ALLOWED_PROVIDERS = ["azure", "gemini"] as const;
type Provider = (typeof ALLOWED_PROVIDERS)[number];

/** What an absent field means. The session screen only ever sends `"azure"`. */
const DEFAULT_PROVIDER: Provider = "azure";

function isProvider(value: string): value is Provider {
  return (ALLOWED_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Largest take we will forward, in the unit this side can actually measure.
 *
 * `MAX_CLIP_MS` (30 s) in `lib/pronunciation.ts` is the same limit in the unit
 * the *client* measures. The two are deliberately declared apart — the same
 * two-declarations-one-test shape as `SPEAKER_VOICES` / `ALLOWED_VOICES` and
 * `DIALOGUE_SCRIPT_VERSION` / `SUPPORTED_SCRIPT_VERSIONS` — so `route.test.ts`
 * can derive one from the other and fail the moment either moves. It is spelt
 * as the arithmetic rather than as a magic number for the same reason.
 *
 * There is no fudge factor above it: `encodeWav` in `lib/wav.ts` writes a
 * 44-byte header and then nothing but PCM, so the conversion is exact, and
 * slack here is seconds of audio someone is billed for. Assessment is billed
 * per second, which makes this the field a hand-crafted request would use to
 * spend the month's F0 allowance in one call — the same reflex as
 * `MAX_TEXT_LENGTH` in the TTS route.
 */
const SAMPLE_RATE_HZ = 16_000;
const BYTES_PER_SAMPLE = 2;
const WAV_HEADER_BYTES = 44;
const MAX_CLIP_SECONDS = 30;
const MAX_AUDIO_BYTES =
  WAV_HEADER_BYTES + MAX_CLIP_SECONDS * SAMPLE_RATE_HZ * BYTES_PER_SAMPLE;

/**
 * ...and the floor, which matters for the same reason.
 *
 * A zero-byte upload, or a bare WAV header with no samples after it, carries
 * no audio at all — and yet both cleared the cap above and were forwarded to a
 * provider that bills for the call and cannot return a verdict. "Nothing was
 * said" is already a notice on the client (`trimSilence` returning empty);
 * this is the server-side half of it. It answers 400, not 413: the request is
 * malformed, not too large.
 */
const MIN_AUDIO_BYTES = WAV_HEADER_BYTES + BYTES_PER_SAMPLE;

/**
 * Longest reference sentence we will accept.
 *
 * It is JSON-encoded and base64'd into the `Pronunciation-Assessment`
 * **header**, so an unbounded value stops being a scoring request and becomes
 * a request-size failure at the provider, reported with nothing anyone can act
 * on; it is also part of what Azure charges for. Same number and the same
 * reflex as `MAX_TEXT_LENGTH` in `app/api/tts/route.ts` — a dialogue turn is
 * one sentence, so this sits far above anything the app itself sends.
 */
const MAX_REFERENCE_TEXT_LENGTH = 400;

/**
 * `AZURE_SPEECH_REGION` is interpolated straight into the request host, so the
 * only thing that may live in it is a bare region name: `southeastasia`
 * belongs there, `evil.com/x?` does not. The value is server-owned
 * (`.env.local`) rather than user input, which is why an unusable one reports
 * the same 503 as an absent one — there is one thing wrong and one place to
 * fix it, and the alternative is a request quietly aimed somewhere else.
 */
const REGION_PATTERN = /^[a-z0-9-]+$/i;

/**
 * Last line of defence on every error path: never echo a key back, whatever
 * the provider decided to put in its response body or its thrown message.
 * Copied in shape from `app/api/tts/route.ts` — one redactor per proxy.
 */
function withoutKeys(text: string, ...keys: (string | undefined)[]): string {
  let safe = text;
  for (const key of keys) {
    if (key) safe = safe.split(key).join("***");
  }
  return safe;
}

interface AzureConfig {
  ReferenceText: string;
  GradingSystem: "HundredMark";
  Granularity: "Phoneme";
  // Without this the service silently falls back to "Basic", which returns only
  // AccuracyScore — no ErrorType, no Fluency/Completeness/Prosody. Verified 2026-08-20.
  Dimension: "Comprehensive";
  EnableMiscue: boolean;
  EnableProsodyAssessment: boolean;
  PhonemeAlphabet: "IPA";
  NBestPhonemeCount: number;
}

async function assessWithAzure(wav: ArrayBuffer, referenceText: string) {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;

  if (!key || !region || !REGION_PATTERN.test(region)) {
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
    Dimension: "Comprehensive",
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
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  const latencyMs = Date.now() - started;

  const raw = withoutKeys(await res.text(), key);
  if (!res.ok) {
    // A rejected credential is not a fault of this recording — it is true of
    // every request this session will make, and it is fixed in `.env.local`,
    // not by trying again. Same status and the same conversation as the
    // missing-key 503 above, and the same branch `/api/tts` grew.
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json(
        {
          error:
            "Azure từ chối AZURE_SPEECH_KEY / AZURE_SPEECH_REGION — hãy kiểm tra lại .env.local.",
        },
        { status: 401 }
      );
    }
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
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  const latencyMs = Date.now() - started;

  // The key travels in the query string here, so it can come back in an echoed
  // URL as easily as in a body.
  const body = withoutKeys(await res.text(), apiKey);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json(
        { error: "Google từ chối GEMINI_API_KEY — hãy kiểm tra lại .env.local." },
        { status: 401 }
      );
    }
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

/**
 * Both ends of the size check in one place, so the pre-buffer `Blob.size`
 * answer and the post-buffer `byteLength` one cannot drift apart. `null` means
 * the take is a plausible one to pay for.
 */
function audioSizeError(bytes: number): NextResponse | null {
  if (bytes < MIN_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "Bản ghi rỗng nên không chấm được." },
      { status: 400 }
    );
  }
  if (bytes > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "Bản ghi quá dài để chấm." },
      { status: 413 }
    );
  }
  return null;
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Yêu cầu không hợp lệ." }, { status: 400 });
  }
  const audio = form.get("audio");
  const referenceText = String(form.get("referenceText") ?? "").trim();
  const providerField = String(form.get("provider") ?? "").trim();
  const provider = providerField === "" ? DEFAULT_PROVIDER : providerField;

  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "Thiếu file audio" }, { status: 400 });
  }
  if (!referenceText) {
    return NextResponse.json({ error: "Thiếu câu tham chiếu" }, { status: 400 });
  }
  if (referenceText.length > MAX_REFERENCE_TEXT_LENGTH) {
    return NextResponse.json(
      {
        error: `Câu tham chiếu quá dài (tối đa ${MAX_REFERENCE_TEXT_LENGTH} ký tự).`,
      },
      { status: 400 }
    );
  }
  if (!isProvider(provider)) {
    return NextResponse.json(
      { error: "Nhà cung cấp chấm điểm không hợp lệ." },
      { status: 400 }
    );
  }

  // Checked before the buffer is materialised, and again after: `Blob.size` is
  // the cheap answer, and the client already refuses to send anything over
  // `MAX_CLIP_MS` (`lib/pronunciation.ts`). This is the server-side half of
  // that guard, because the cost lives here.
  const oversizeOrEmpty = audioSizeError(audio.size);
  if (oversizeOrEmpty) return oversizeOrEmpty;

  const wav = await audio.arrayBuffer();
  const bufferedSizeError = audioSizeError(wav.byteLength);
  if (bufferedSizeError) return bufferedSizeError;

  try {
    return provider === "gemini"
      ? await assessWithGemini(wav, referenceText)
      : await assessWithAzure(wav, referenceText);
  } catch (err) {
    // Matches `/api/tts`: a timeout is its own status so the client can say
    // "the service did not answer in time" rather than inventing a cause, and
    // every other transport fault is a 502 with the key stripped out of the
    // message. The old 500 leaked whatever the thrown error carried.
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return NextResponse.json(
        {
          error: `Dịch vụ chấm không phản hồi trong ${PROVIDER_TIMEOUT_MS / 1000}s.`,
        },
        { status: 504 }
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: withoutKeys(
          message,
          process.env.AZURE_SPEECH_KEY,
          process.env.GEMINI_API_KEY
        ),
      },
      { status: 502 }
    );
  }
}
