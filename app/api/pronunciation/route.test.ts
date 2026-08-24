import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MAX_CLIP_MS } from "@/lib/pronunciation";
import { POST } from "./route";

/**
 * The app's second Azure proxy, held to the line the first one set
 * (`app/api/tts/route.test.ts`): the key never leaves the server on any path,
 * a rejected credential is told apart from a missing one, a hung provider ends
 * in a bounded time, and every field that is *billed* has a cap.
 *
 * Both providers are stubbed at `fetch` — everything here is transport, and
 * the judgement it feeds lives in `lib/pronunciation.ts`.
 */

const KEY = "azure-secret-key";
const GEMINI_KEY = "gemini-secret-key";

type Reply =
  | { kind: "json"; body: unknown }
  /** A 200 whose body is not JSON — Azure answers some faults with an HTML page. */
  | { kind: "text"; body: string }
  | { kind: "http"; status: number; body: string }
  | { kind: "throw"; message: string; name?: string };

interface Init {
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

type ProviderFetch = (url: string, init?: Init) => Promise<unknown>;

function stubProvider(reply: Reply) {
  const fetchMock = vi.fn<ProviderFetch>(async () => {
    if (reply.kind === "throw") {
      const err = new Error(reply.message);
      if (reply.name) err.name = reply.name;
      throw err;
    }
    if (reply.kind === "http") {
      return { ok: false, status: reply.status, text: async () => reply.body };
    }
    if (reply.kind === "text") {
      return { ok: true, status: 200, text: async () => reply.body };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(reply.body) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** A minimal but shape-correct Azure assessment response. */
const AZURE_OK = {
  DisplayText: "cold drink",
  NBest: [
    {
      PronScore: 88,
      Words: [
        { Word: "cold", Phonemes: [{ Phoneme: "k", AccuracyScore: 90 }] },
      ],
    },
  ],
};

/** A minimal but shape-correct Gemini response: JSON nested inside a text part. */
const GEMINI_OK = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify({
              heardTranscript: "it is cold today",
              matchesReference: true,
              overallScore: 80,
              intonationScore: 70,
              wordIssues: [],
              summaryVi: "Nghe rõ.",
            }),
          },
        ],
      },
    },
  ],
};

function request(
  bytes = 2_048,
  referenceText = "It is cold today.",
  provider: string | null = "azure"
) {
  const form = new FormData();
  form.append(
    "audio",
    new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
    "take.wav"
  );
  form.append("referenceText", referenceText);
  if (provider !== null) form.append("provider", provider);
  return new NextRequest("http://localhost/api/pronunciation", {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  vi.stubEnv("AZURE_SPEECH_KEY", KEY);
  vi.stubEnv("AZURE_SPEECH_REGION", "southeastasia");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/pronunciation — configuration", () => {
  it("503s in Vietnamese when the credential is missing, without calling out", async () => {
    vi.stubEnv("AZURE_SPEECH_KEY", "");
    const fetchMock = stubProvider({ kind: "json", body: AZURE_OK });

    const res = await POST(request());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(503);
    // Word for word the message `/api/tts` uses: one missing credential, one
    // thing to fix, one sentence.
    expect(body.error).toBe(
      "Chưa cấu hình AZURE_SPEECH_KEY / AZURE_SPEECH_REGION trong .env.local"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("503s the same way when only the region is missing", async () => {
    vi.stubEnv("AZURE_SPEECH_REGION", "");
    const fetchMock = stubProvider({ kind: "json", body: AZURE_OK });

    const res = await POST(request());
    const body = (await res.json()) as { error: string };

    // Half a credential is not a credential: the region is interpolated into
    // the host, so without it the request would be aimed at `https://.stt…`.
    expect(res.status).toBe(503);
    expect(body.error).toBe(
      "Chưa cấu hình AZURE_SPEECH_KEY / AZURE_SPEECH_REGION trong .env.local"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("puts the region in the host and nowhere else", async () => {
    const fetchMock = stubProvider({ kind: "json", body: AZURE_OK });
    await POST(request());

    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url.startsWith("https://southeastasia.stt.speech.microsoft.com/")).toBe(
      true
    );
  });

  it.each([
    ["a path escape", "southeastasia.evil.com/v1?x="],
    ["a space", "southeast asia"],
    ["an @ before another host", "user@evil.com"],
  ])(
    "refuses to build a URL from a region containing %s",
    async (_label, region) => {
      vi.stubEnv("AZURE_SPEECH_REGION", region);
      const fetchMock = stubProvider({ kind: "json", body: AZURE_OK });

      const res = await POST(request());

      // The value is server-owned, so this is a misconfiguration and reports
      // as one — but it must never become a request to somewhere else.
      expect(res.status).toBe(503);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );
});

describe("POST /api/pronunciation — the assessment config", () => {
  it("still asks for Comprehensive, phoneme granularity and IPA", async () => {
    const fetchMock = stubProvider({ kind: "json", body: AZURE_OK });
    await POST(request());

    const header = fetchMock.mock.calls[0]?.[1]?.headers?.[
      "Pronunciation-Assessment"
    ] as string;
    const config = JSON.parse(Buffer.from(header, "base64").toString());

    // Without `Comprehensive` Azure silently degrades to Basic: HTTP 200, and
    // the phoneme block this whole story gates on simply is not there.
    expect(config.Dimension).toBe("Comprehensive");
    expect(config.Granularity).toBe("Phoneme");
    expect(config.PhonemeAlphabet).toBe("IPA");
    expect(config.EnableMiscue).toBe(true);
    expect(config.ReferenceText).toBe("It is cold today.");
  });

  it("returns the provider's JSON verbatim, with a latency", async () => {
    stubProvider({ kind: "json", body: AZURE_OK });
    const res = await POST(request());
    const body = (await res.json()) as { provider: string; raw: unknown };

    expect(res.status).toBe(200);
    expect(body.provider).toBe("azure");
    expect(body.raw).toEqual(AZURE_OK);
  });
});

describe("POST /api/pronunciation — the key never comes back", () => {
  it("sends the key to Azure and never to the browser", async () => {
    const fetchMock = stubProvider({ kind: "json", body: AZURE_OK });
    const res = await POST(request());

    expect(fetchMock.mock.calls[0]?.[1]?.headers?.["Ocp-Apim-Subscription-Key"]).toBe(
      KEY
    );
    expect(JSON.stringify(await res.json())).not.toContain(KEY);
  });

  it("redacts the key out of an error body Azure echoes back", async () => {
    // Azure has been seen to quote the offending request back. Before this the
    // route interpolated that body straight into its own error.
    stubProvider({
      kind: "http",
      status: 400,
      body: `Bad request for key ${KEY} in region southeastasia`,
    });

    const res = await POST(request());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(502);
    expect(body.error).not.toContain(KEY);
    expect(body.error).toContain("***");
  });

  it("redacts the key out of a thrown transport message too", async () => {
    stubProvider({ kind: "throw", message: `connect ECONNREFUSED (key=${KEY})` });

    const res = await POST(request());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(502);
    expect(body.error).not.toContain(KEY);
  });
});

describe("POST /api/pronunciation — Matrix: credential rejected", () => {
  it("401s with a credential message when Azure rejects the key", async () => {
    stubProvider({ kind: "http", status: 401, body: `denied for ${KEY}` });

    const res = await POST(request());
    const body = (await res.json()) as { error: string };

    // Its own status, not a generic 502: it is true of every request this
    // session will make and it is fixed in `.env.local`, not by retrying.
    expect(res.status).toBe(401);
    expect(body.error).toBe(
      "Azure từ chối AZURE_SPEECH_KEY / AZURE_SPEECH_REGION — hãy kiểm tra lại .env.local."
    );
    expect(body.error).not.toContain(KEY);
  });

  it("treats a 403 the same way", async () => {
    stubProvider({ kind: "http", status: 403, body: "forbidden" });
    expect((await POST(request())).status).toBe(401);
  });
});

/**
 * The lab's second provider. It is reached only from
 * `app/lab/pronunciation/page.tsx`, which is exactly why it needs tests of its
 * own: nothing else would notice if its redaction or its 401 branch were
 * deleted, and `GEMINI_API_KEY` travels in the **query string** here, so an
 * echoed URL leaks it as readily as an echoed body.
 */
describe("POST /api/pronunciation — the gemini branch", () => {
  const geminiRequest = (bytes = 2_048, text = "It is cold today.") =>
    request(bytes, text, "gemini");

  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", GEMINI_KEY);
  });

  it("503s when GEMINI_API_KEY is not configured, without calling out", async () => {
    vi.stubEnv("GEMINI_API_KEY", "your_gemini_api_key_here");
    const fetchMock = stubProvider({ kind: "json", body: GEMINI_OK });

    const res = await POST(geminiRequest());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(503);
    expect(body.error).toBe("GEMINI_API_KEY chưa được cấu hình");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the key to Google and never to the browser", async () => {
    const fetchMock = stubProvider({ kind: "json", body: GEMINI_OK });
    const res = await POST(geminiRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(GEMINI_KEY);
    expect(JSON.stringify(body)).not.toContain(GEMINI_KEY);
  });

  it("redacts the key out of an error body that echoes the request URL", async () => {
    // The key is in the query string, so a proxy or an error page quoting the
    // URL back hands it straight to the browser unless it is stripped here.
    stubProvider({
      kind: "http",
      status: 500,
      body: `Internal error calling ...:generateContent?key=${GEMINI_KEY}`,
    });

    const res = await POST(geminiRequest());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(502);
    expect(body.error).not.toContain(GEMINI_KEY);
    expect(body.error).toContain("***");
  });

  it("401s with a credential message when Google rejects the key", async () => {
    stubProvider({
      kind: "http",
      status: 403,
      body: `API key not valid: ${GEMINI_KEY}`,
    });

    const res = await POST(geminiRequest());
    const body = (await res.json()) as { error: string };

    // Not a 502 carrying the body: a rejected credential is fixed in
    // `.env.local`, not by retrying, and its body carries the key.
    expect(res.status).toBe(401);
    expect(body.error).toBe(
      "Google từ chối GEMINI_API_KEY — hãy kiểm tra lại .env.local."
    );
    expect(body.error).not.toContain(GEMINI_KEY);
  });

  it("treats a 401 the same way", async () => {
    stubProvider({ kind: "http", status: 401, body: "unauthorized" });
    expect((await POST(geminiRequest())).status).toBe(401);
  });

  it("redacts the key out of a thrown transport message too", async () => {
    stubProvider({
      kind: "throw",
      message: `connect ECONNREFUSED (url=...?key=${GEMINI_KEY})`,
    });

    const res = await POST(geminiRequest());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(502);
    expect(body.error).not.toContain(GEMINI_KEY);
  });

  it("502s when the answer carries no content", async () => {
    stubProvider({ kind: "json", body: { candidates: [] } });
    const res = await POST(geminiRequest());
    expect(res.status).toBe(502);
  });
});

describe("POST /api/pronunciation — the provider is a closed set", () => {
  it("400s on a provider outside the set rather than falling through to Azure", async () => {
    const fetchMock = stubProvider({ kind: "json", body: AZURE_OK });

    const res = await POST(request(2_048, "It is cold today.", "openai"));
    const body = (await res.json()) as { error: string };

    // The whole point: an unknown name used to mean "not gemini", which meant
    // Azure, which meant a bill. Same reflex as `ALLOWED_ACTIONS` /
    // `ALLOWED_VOICES` — name what is allowed and refuse the rest.
    expect(res.status).toBe(400);
    expect(body.error).toBe("Nhà cung cấp chấm điểm không hợp lệ.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400s rather than guessing when the name is only nearly right", async () => {
    const fetchMock = stubProvider({ kind: "json", body: AZURE_OK });
    const res = await POST(request(2_048, "It is cold today.", "Gemini "));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("defaults to azure when the field is absent", async () => {
    const fetchMock = stubProvider({ kind: "json", body: AZURE_OK });

    const res = await POST(request(2_048, "It is cold today.", null));
    const body = (await res.json()) as { provider: string };

    expect(res.status).toBe(200);
    expect(body.provider).toBe("azure");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("stt.speech.microsoft.com");
  });
});

/**
 * `MAX_CLIP_MS` (client, milliseconds) and the route's byte cap (server,
 * bytes) are one limit written twice. The conversion is redone here from the
 * imported constant, so moving either declaration alone fails this file
 * instead of silently widening what gets billed.
 */
const WAV_HEADER_BYTES = 44;
const MAX_WAV_BYTES = WAV_HEADER_BYTES + (MAX_CLIP_MS / 1000) * 16_000 * 2;

describe("POST /api/pronunciation — bounded and capped", () => {
  it("passes an abort signal, so a hung provider cannot stall the turn", async () => {
    const fetchMock = stubProvider({ kind: "json", body: AZURE_OK });
    await POST(request());
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("504s when the request times out, so the client can say why", async () => {
    stubProvider({ kind: "throw", message: "timed out", name: "TimeoutError" });

    const res = await POST(request());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(504);
    expect(body.error).toContain("15s");
  });

  it("refuses audio past the cap without calling out — assessment is billed per second", async () => {
    const fetchMock = stubProvider({ kind: "json", body: AZURE_OK });

    const res = await POST(request(1_400_000));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(413);
    expect(body.error).toBe("Bản ghi quá dài để chấm.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps the upload at exactly MAX_CLIP_MS of 16 kHz / 16-bit mono PCM", async () => {
    // Sanity on the arithmetic itself: 30 s = 960,000 bytes of PCM + header.
    expect(MAX_WAV_BYTES).toBe(960_044);

    const atCap = stubProvider({ kind: "json", body: AZURE_OK });
    expect((await POST(request(MAX_WAV_BYTES))).status).toBe(200);
    expect(atCap).toHaveBeenCalled();

    const pastCap = stubProvider({ kind: "json", body: AZURE_OK });
    expect((await POST(request(MAX_WAV_BYTES + 1))).status).toBe(413);
    expect(pastCap).not.toHaveBeenCalled();
  });

  it("400s on a reference text past the cap — it is base64'd into a header", async () => {
    const fetchMock = stubProvider({ kind: "json", body: AZURE_OK });

    const res = await POST(request(2_048, "a".repeat(401)));
    const body = (await res.json()) as { error: string };

    // Unbounded, it stops being a scoring request and becomes a request-size
    // failure at the provider with no message anyone can act on.
    expect(res.status).toBe(400);
    expect(body.error).toContain("400");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still accepts a reference sentence at the cap", async () => {
    const fetchMock = stubProvider({ kind: "json", body: AZURE_OK });
    expect((await POST(request(2_048, "a".repeat(400)))).status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("POST /api/pronunciation — bad requests", () => {
  it("400s with no audio", async () => {
    stubProvider({ kind: "json", body: AZURE_OK });
    const form = new FormData();
    form.append("referenceText", "hi");
    const res = await POST(
      new NextRequest("http://localhost/api/pronunciation", {
        method: "POST",
        body: form,
      })
    );
    expect(res.status).toBe(400);
  });

  it("400s with no reference text", async () => {
    stubProvider({ kind: "json", body: AZURE_OK });
    const res = await POST(request(1_024, "   "));
    expect(res.status).toBe(400);
  });

  it.each([
    ["a zero-byte upload", 0],
    ["a bare WAV header with no samples", WAV_HEADER_BYTES],
  ])("400s on %s instead of paying for silence", async (_label, bytes) => {
    const fetchMock = stubProvider({ kind: "json", body: AZURE_OK });

    const res = await POST(request(bytes));
    const body = (await res.json()) as { error: string };

    // Both cleared the upper bound and were forwarded: a billed call that
    // cannot produce a verdict. The message says nothing about the mic.
    expect(res.status).toBe(400);
    expect(body.error).toBe("Bản ghi rỗng nên không chấm được.");
    expect(body.error).not.toContain("micro");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("502s on a non-JSON body rather than crashing", async () => {
    // A 200 carrying an HTML error page — Azure does this — must not reach
    // `JSON.parse` unguarded.
    stubProvider({ kind: "text", body: "<html>nope</html>" });

    const res = await POST(request());
    expect(res.status).toBe(502);
  });
});
