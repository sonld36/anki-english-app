import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { SPEAKER_VOICES } from "@/lib/dialogue/types";
import { sampleAudioPayload, sampleAudioRequests } from "@/lib/sample-audio";

/**
 * The route is transport code, so Azure is stubbed at `fetch`. What is proved
 * here is what only the route can decide: that the key never leaves the
 * server, that model text becomes well-formed SSML, and that a missing
 * credential is a 503 in Vietnamese rather than a crash.
 */

const KEY = "azure-secret-key";

type AzureReply =
  | { kind: "audio"; bytes: number[]; contentType?: string }
  | { kind: "http"; status: number; body: string }
  | { kind: "throw"; message: string; name?: string };

interface AzureInit {
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/** Declared on the mock rather than on the impl, so `mock.calls` stays typed
 *  — what the route *sent* is most of what is under test here. */
type AzureFetch = (url: string, init?: AzureInit) => Promise<unknown>;

function stubAzure(reply: AzureReply) {
  const fetchMock = vi.fn<AzureFetch>(async () => {
    if (reply.kind === "throw") {
      const err = new Error(reply.message);
      if (reply.name) err.name = reply.name;
      throw err;
    }
    if (reply.kind === "http") {
      return {
        ok: false,
        status: reply.status,
        headers: new Headers({ "content-type": "text/plain" }),
        text: async () => reply.body,
      };
    }
    const bytes = new Uint8Array(reply.bytes);
    return {
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": reply.contentType ?? "audio/mpeg",
      }),
      arrayBuffer: async () => bytes.buffer,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function request(body: unknown = { text: "Hello there.", voice: SPEAKER_VOICES.system }) {
  return new NextRequest("http://localhost/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The SSML the route actually sent. */
function sentSsml(fetchMock: ReturnType<typeof stubAzure>): string {
  return fetchMock.mock.calls[0]?.[1]?.body ?? "";
}

function sentHeaders(
  fetchMock: ReturnType<typeof stubAzure>
): Record<string, string> {
  return fetchMock.mock.calls[0]?.[1]?.headers ?? {};
}

function sentUrl(fetchMock: ReturnType<typeof stubAzure>): string {
  return fetchMock.mock.calls[0]?.[0] ?? "";
}

beforeEach(() => {
  vi.stubEnv("AZURE_SPEECH_KEY", KEY);
  vi.stubEnv("AZURE_SPEECH_REGION", "southeastasia");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/tts — configuration", () => {
  it("503s in Vietnamese when the key is missing, without calling out", async () => {
    vi.stubEnv("AZURE_SPEECH_KEY", "");
    const fetchMock = stubAzure({ kind: "audio", bytes: [1] });

    const res = await POST(request());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(503);
    // The same message the pronunciation route uses — one missing credential,
    // one thing to fix.
    expect(body.error).toBe(
      "Chưa cấu hình AZURE_SPEECH_KEY / AZURE_SPEECH_REGION trong .env.local"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("503s when only the region is missing", async () => {
    vi.stubEnv("AZURE_SPEECH_REGION", "");
    const fetchMock = stubAzure({ kind: "audio", bytes: [1] });

    const res = await POST(request());

    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/tts — synthesis", () => {
  it("returns the audio bytes and asks Azure for the compact MP3 format", async () => {
    const fetchMock = stubAzure({ kind: "audio", bytes: [0xff, 0xfb, 0x90] });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([0xff, 0xfb, 0x90])
    );
    expect(sentHeaders(fetchMock)["X-Microsoft-OutputFormat"]).toBe(
      "audio-24khz-48kbitrate-mono-mp3"
    );
    expect(sentUrl(fetchMock)).toBe(
      "https://southeastasia.tts.speech.microsoft.com/cognitiveservices/v1"
    );
  });

  it("sends the key to Azure and never back to the browser", async () => {
    // `/api/live-token` hands `GEMINI_API_KEY` to the browser; this route is
    // the deliberate opposite, and this is the test that keeps it that way.
    const fetchMock = stubAzure({ kind: "audio", bytes: [1, 2, 3] });

    const res = await POST(request());
    const returned = Buffer.from(await res.arrayBuffer()).toString("utf8");

    expect(sentHeaders(fetchMock)["Ocp-Apim-Subscription-Key"]).toBe(KEY);
    expect(returned).not.toContain(KEY);
    expect(JSON.stringify([...res.headers])).not.toContain(KEY);
  });

  it("wraps the line in SSML with the requested voice", async () => {
    const fetchMock = stubAzure({ kind: "audio", bytes: [1] });

    await POST(request({ text: "Hello there.", voice: SPEAKER_VOICES.learner }));

    expect(sentSsml(fetchMock)).toBe(
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">' +
        `<voice name="${SPEAKER_VOICES.learner}">Hello there.</voice>` +
        "</speak>"
    );
    expect(sentHeaders(fetchMock)["Content-Type"]).toBe("application/ssml+xml");
  });

  it("escapes markup in the line instead of emitting malformed XML", async () => {
    const fetchMock = stubAzure({ kind: "audio", bytes: [1] });

    const res = await POST(
      request({
        text: `R&D is <b>great</b> — she said "it's fine".`,
        voice: SPEAKER_VOICES.system,
      })
    );

    expect(res.status).toBe(200);
    const ssml = sentSsml(fetchMock);
    expect(ssml).toContain(
      "R&amp;D is &lt;b&gt;great&lt;/b&gt; — she said &quot;it&apos;s fine&quot;."
    );
    // Exactly one voice element: nothing in the text opened a second one.
    expect(ssml.match(/<voice /g)).toHaveLength(1);
    expect(ssml.match(/<\/speak>/g)).toHaveLength(1);
  });

  it("tells the browser not to cache — IndexedDB is the cache", async () => {
    stubAzure({ kind: "audio", bytes: [1] });

    const res = await POST(request());

    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("drops lone surrogates but keeps whole emoji", async () => {
    // A lone surrogate does not encode to valid UTF-8, so the request body
    // itself is malformed and that line never gets audio — and no escaping
    // can rescue it.
    const fetchMock = stubAzure({ kind: "audio", bytes: [1] });

    const res = await POST(
      request({
        text: "Hi \uD83D there \uDE00 ok \uD83D\uDE00",
        voice: SPEAKER_VOICES.system,
      })
    );

    expect(res.status).toBe(200);
    const ssml = sentSsml(fetchMock);
    expect(ssml).toContain(">Hi  there  ok \uD83D\uDE00<");
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(ssml)).toBe(false);
  });

  it("drops control characters, which XML has no entity for", async () => {
    const fetchMock = stubAzure({ kind: "audio", bytes: [1] });

    await POST(
      request({ text: "Hel\u0000lo\u0007.", voice: SPEAKER_VOICES.system })
    );

    expect(sentSsml(fetchMock)).toContain("<voice ");
    expect(sentSsml(fetchMock)).toContain(">Hello.<");
  });
});

describe("POST /api/tts — request validation", () => {
  it("400s on a voice outside the allowed set, without calling Azure", async () => {
    // The voice lands in an SSML attribute; a closed set is the control.
    const fetchMock = stubAzure({ kind: "audio", bytes: [1] });

    const res = await POST(
      request({ text: "Hello.", voice: '"/><script>alert(1)</script>' })
    );
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("Giọng đọc không hợp lệ.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400s on an empty line", async () => {
    const fetchMock = stubAzure({ kind: "audio", bytes: [1] });

    const res = await POST(request({ text: "   ", voice: SPEAKER_VOICES.system }));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("Thiếu câu cần đọc.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400s past the length cap — the billed field needs a bound too", async () => {
    // `ALLOWED_VOICES` closes the voice field; nothing else closed the one
    // Azure charges per character.
    const fetchMock = stubAzure({ kind: "audio", bytes: [1] });

    const res = await POST(
      request({ text: "a".repeat(401), voice: SPEAKER_VOICES.system })
    );
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain("quá dài");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still accepts a line at the cap", async () => {
    const fetchMock = stubAzure({ kind: "audio", bytes: [1] });

    const res = await POST(
      request({ text: "a".repeat(400), voice: SPEAKER_VOICES.system })
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("takes the payload the app actually builds", async () => {
    // The one test that crosses the `{ text, voice }` contract end to end.
    // Renaming a field in `sampleAudioPayload` used to 400 every line in the
    // browser while the whole suite and `tsc` stayed green.
    stubAzure({ kind: "audio", bytes: [1, 2] });
    const [built] = await sampleAudioRequests({
      version: 3,
      turns: [
        { index: 0, speaker: "learner", text: "Good morning.", targetWords: [] },
      ],
    });

    const res = await POST(request(sampleAudioPayload(built)));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
  });

  it("400s on an unparseable body instead of throwing", async () => {
    stubAzure({ kind: "audio", bytes: [1] });

    const res = await POST(
      new NextRequest("http://localhost/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      })
    );
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("Yêu cầu không hợp lệ.");
  });
});

describe("POST /api/tts — Azure failures", () => {
  it("502s on a non-2xx and keeps the key out of the body", async () => {
    stubAzure({
      kind: "http",
      status: 500,
      body: `Internal error processing key ${KEY}`,
    });

    const res = await POST(request());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(502);
    expect(body.error).toContain("Azure TTS 500");
    expect(body.error).not.toContain(KEY);
    expect(body.error).toContain("***");
  });

  it("401s on a rejected credential — a whole-script condition, not a bad line", async () => {
    // The client stops the whole run on this status. As a 502 it would read as
    // one unlucky line and cost twelve more round trips.
    stubAzure({
      kind: "http",
      status: 401,
      body: `Access denied for key ${KEY}`,
    });

    const res = await POST(request());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toContain("AZURE_SPEECH_KEY");
    expect(body.error).not.toContain(KEY);
  });

  it("401s on a 403 too", async () => {
    stubAzure({ kind: "http", status: 403, body: "Forbidden" });

    expect((await POST(request())).status).toBe(401);
  });

  it("502s rather than caching an error page as if it were audio", async () => {
    // A 200 with an XML body stored under the content key would be cached
    // *forever*: the key looks populated, so nothing refetches it and the play
    // button silently does nothing for the life of the browser profile.
    stubAzure({
      kind: "audio",
      bytes: [0x3c, 0x3f, 0x78, 0x6d, 0x6c],
      contentType: "application/xml; charset=utf-8",
    });

    const res = await POST(request());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(502);
    expect(body.error).toContain("không phải audio");
  });

  it("504s on a timeout instead of hanging the sequential loop", async () => {
    stubAzure({ kind: "throw", message: "The operation was aborted due to timeout", name: "TimeoutError" });

    const res = await POST(request());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(504);
    expect(body.error).toContain("không phản hồi");
  });

  it("passes an abort signal to Azure", async () => {
    const fetchMock = stubAzure({ kind: "audio", bytes: [1] });

    await POST(request());

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("502s on a network error rather than throwing", async () => {
    stubAzure({ kind: "throw", message: "fetch failed" });

    const res = await POST(request());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(502);
    expect(body.error).toContain("fetch failed");
  });

  it("502s on an empty audio body instead of storing silence", async () => {
    stubAzure({ kind: "audio", bytes: [] });

    const res = await POST(request());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(502);
    expect(body.error).toContain("audio rỗng");
  });
});
