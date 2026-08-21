import { NextRequest, NextResponse } from "next/server";
import { ALLOWED_VOICES } from "@/lib/dialogue/types";

/**
 * Azure Text-to-Speech proxy: POST `{ text, voice }` → MP3 bytes.
 *
 * A **proxy**, not a token handout. `app/api/live-token/route.ts` returns the
 * raw `GEMINI_API_KEY` to the browser; that is a documented dev-only shortcut
 * and explicitly the mistake this route must not repeat. `AZURE_SPEECH_KEY`
 * stays on the server: it is the same key and the same bill as the
 * pronunciation assessment Epic 2 depends on, so leaking it costs more than
 * one feature.
 *
 * Same credentials as `app/api/pronunciation/route.ts`, different host:
 * `*.tts.speech.microsoft.com` here, `*.stt.…` there.
 */

/** Output format. MP3 at 24 kHz / 48 kbps: small enough to keep a whole
 *  script's audio in IndexedDB, good enough to hear a final consonant. */
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

/**
 * Longest line we will synthesise.
 *
 * `ALLOWED_VOICES` closes the voice field; this closes the one that is
 * *billed per character*. A dialogue line is a couple of hundred characters
 * and `MAX_TURNS` is 12, so this is far above anything the app itself sends —
 * it exists so a hand-crafted request cannot spend the month's F0 allowance in
 * one call.
 */
const MAX_TEXT_LENGTH = 400;

/**
 * How long to wait on Azure before giving up.
 *
 * Without this a hung connection stalls the sequential loop forever: the turn
 * spins, every later turn stays queued, and nothing ever errors. The
 * AnkiConnect proxy sets the precedent at 8s; synthesis legitimately takes
 * longer, so 15s. The client sets a slightly longer one, so the server's
 * message wins the race and the browser hears a real reason.
 */
const AZURE_TIMEOUT_MS = 15_000;

/**
 * XML escaping for SSML.
 *
 * `escapeHtml` in `lib/dialogue/words.ts` is the precedent but not the tool:
 * it escapes for HTML *element content* and leaves `"` and `'` alone, which is
 * fine for a text node and wrong the moment the value could end an attribute.
 * SSML is XML, so this escapes the full XML set. Model text reaches here
 * unvetted — an `&` in "R&D" alone is enough to make the document malformed
 * and the request fail.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Characters XML 1.0 cannot carry at all. There is no entity that makes any of
 * these legal, so they are dropped rather than encoded:
 *
 *  - C0/C1 control characters;
 *  - **lone surrogates** — a high surrogate with no low one after it, or a low
 *    one with no high one before it. Escaping cannot save these either: they do
 *    not encode to valid UTF-8, so the request body itself is malformed and
 *    that line never gets audio. They come from model text, usually an emoji
 *    cut in half by a length limit upstream;
 *  - U+FFFE / U+FFFF, the noncharacters.
 *
 * A well-formed surrogate *pair* is left alone — real emoji survive.
 */
function stripInvalidXmlChars(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      ""
    )
    .replace(/[\uFFFE\uFFFF]/g, "");
}

function buildSsml(text: string, voice: string): string {
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">` +
    `<voice name="${voice}">${escapeXml(stripInvalidXmlChars(text))}</voice>` +
    `</speak>`
  );
}

/**
 * Last line of defence on the error path: never echo the key back, whatever
 * Azure decided to put in its response body.
 */
function withoutKey(text: string, key: string): string {
  return key ? text.split(key).join("***") : text;
}

export async function POST(req: NextRequest) {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;

  if (!key || !region) {
    // Same wording as the pronunciation route — one missing key, one message.
    return NextResponse.json(
      {
        error:
          "Chưa cấu hình AZURE_SPEECH_KEY / AZURE_SPEECH_REGION trong .env.local",
      },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Yêu cầu không hợp lệ." }, { status: 400 });
  }

  const { text, voice } = (body ?? {}) as { text?: unknown; voice?: unknown };
  const line = typeof text === "string" ? text.trim() : "";
  if (!line) {
    return NextResponse.json({ error: "Thiếu câu cần đọc." }, { status: 400 });
  }
  if (line.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `Câu quá dài (tối đa ${MAX_TEXT_LENGTH} ký tự).` },
      { status: 400 }
    );
  }
  // The voice name lands in an SSML *attribute*. A closed set is the control
  // here, the same reflex as `ALLOWED_ACTIONS` in the Anki route — escaping an
  // attribute value is a weaker guarantee than never accepting a foreign one.
  if (typeof voice !== "string" || !ALLOWED_VOICES.includes(voice)) {
    return NextResponse.json({ error: "Giọng đọc không hợp lệ." }, { status: 400 });
  }

  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
        // Azure rejects TTS requests without one.
        "User-Agent": "anki-english-app",
      },
      body: buildSsml(line, voice),
      signal: AbortSignal.timeout(AZURE_TIMEOUT_MS),
    });

    if (!res.ok) {
      // A rejected credential is true of every line in the script, not of this
      // one — so it gets its own status, which the client stops the whole run
      // on. Reported the same way as a missing credential because it is the
      // same thing to fix.
      if (res.status === 401 || res.status === 403) {
        return NextResponse.json(
          {
            error:
              "Azure từ chối AZURE_SPEECH_KEY / AZURE_SPEECH_REGION — hãy kiểm tra lại .env.local.",
          },
          { status: 401 }
        );
      }
      const detail = withoutKey(await res.text(), key);
      return NextResponse.json(
        { error: `Azure TTS ${res.status}: ${detail.slice(0, 300)}` },
        { status: 502 }
      );
    }

    // A 200 is not a promise of audio: Azure answers some faults with an XML
    // or HTML error page. Stored under the content key that would be cached
    // *forever* — the key looks populated, so nothing ever refetches it, and
    // the play button silently does nothing for the life of the browser
    // profile. Checked here because this is the last place that can tell.
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("audio/")) {
      return NextResponse.json(
        { error: `Azure TTS trả về nội dung không phải audio (${contentType || "không rõ"}).` },
        { status: 502 }
      );
    }

    const audio = await res.arrayBuffer();
    if (audio.byteLength === 0) {
      return NextResponse.json(
        { error: "Azure TTS trả về audio rỗng." },
        { status: 502 }
      );
    }

    return new NextResponse(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        // The browser caches these in IndexedDB, keyed by content; an HTTP
        // cache on top would only duplicate them.
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return NextResponse.json(
        { error: `Azure TTS không phản hồi trong ${AZURE_TIMEOUT_MS / 1000}s.` },
        { status: 504 }
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: withoutKey(message, key) },
      { status: 502 }
    );
  }
}
