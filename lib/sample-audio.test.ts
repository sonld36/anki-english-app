import { describe, expect, it, vi } from "vitest";
import {
  SPEAKER_VOICES,
  type DialogueScript,
  type DialogueTurn,
} from "./dialogue/types";
import {
  STORAGE_FAILURE_MESSAGES,
  SampleAudioProviderError,
  classifyStorageError,
  generateSampleAudio,
  initialStatuses,
  pendingRequests,
  sampleAudioKey,
  sampleAudioPayload,
  sampleAudioRequests,
  type SampleAudioHaltReason,
  type SampleAudioRequest,
  type SampleAudioStatus,
  type SampleAudioStore,
} from "./sample-audio";

/**
 * The node test environment has no IndexedDB, which is exactly why the store
 * is a parameter here. Everything the story claims about *when* a request
 * happens is decided in this module and therefore provable; only the
 * IndexedDB wrapper itself is left to manual verification.
 */

function turn(partial: Partial<DialogueTurn> & { index: number }): DialogueTurn {
  return {
    speaker: "system",
    text: "A line.",
    targetWords: [],
    ...partial,
  };
}

function script(turns: DialogueTurn[]): DialogueScript {
  return { version: 3, turns };
}

/** An in-memory stand-in for the `"tts"` namespace of the blob store. */
function fakeStore(seed: Iterable<string> = []): SampleAudioStore & {
  blobs: Map<string, Blob>;
} {
  const blobs = new Map<string, Blob>();
  for (const key of seed) blobs.set(key, new Blob(["seeded"]));
  return {
    blobs,
    has: async (key) => blobs.has(key),
    get: async (key) => blobs.get(key),
    put: async (key, blob) => {
      blobs.set(key, blob);
    },
  };
}

describe("sampleAudioKey", () => {
  it("is stable for the same voice and text", async () => {
    const a = await sampleAudioKey("en-US-AvaNeural", "It is cold outside.");
    const b = await sampleAudioKey("en-US-AvaNeural", "It is cold outside.");

    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("separates the same line read by a different voice", async () => {
    // Two roles, two voices — one blob each, never a collision.
    const system = await sampleAudioKey(SPEAKER_VOICES.system, "See you later.");
    const learner = await sampleAudioKey(SPEAKER_VOICES.learner, "See you later.");

    expect(system).not.toBe(learner);
  });

  it("separates different text on the same voice", async () => {
    const a = await sampleAudioKey(SPEAKER_VOICES.system, "See you later.");
    const b = await sampleAudioKey(SPEAKER_VOICES.system, "See you tomorrow.");

    expect(a).not.toBe(b);
  });

  it("does not let the voice/text boundary blur", async () => {
    // A bare `voice + text` concatenation would hash both of these to
    // "en-US-AvaNeuralhello". The separator is what keeps the two fields apart.
    const a = await sampleAudioKey("en-US-A", "vaNeuralhello");
    const b = await sampleAudioKey("en-US-AvaNeural", "hello");

    expect(a).not.toBe(b);
  });
});

describe("sampleAudioRequests", () => {
  it("covers both roles, one request per turn", async () => {
    const requests = await sampleAudioRequests(
      script([
        turn({ index: 0, speaker: "system", text: "How are you?" }),
        turn({ index: 1, speaker: "learner", text: "I am fine." }),
      ])
    );

    expect(requests).toHaveLength(2);
    expect(requests.map((r) => r.voice)).toEqual([
      SPEAKER_VOICES.system,
      SPEAKER_VOICES.learner,
    ]);
    expect(requests.map((r) => r.turnIndexes)).toEqual([[0], [1]]);
  });

  it("collapses duplicate lines on the same voice into one blob", async () => {
    const requests = await sampleAudioRequests(
      script([
        turn({ index: 0, speaker: "system", text: "Really?" }),
        turn({ index: 1, speaker: "learner", text: "I think so." }),
        turn({ index: 2, speaker: "system", text: "Really?" }),
      ])
    );

    // One fetch, one stored blob, two turns served.
    expect(requests).toHaveLength(2);
    expect(requests[0].turnIndexes).toEqual([0, 2]);
  });

  it("keeps identical text on the two roles apart", async () => {
    const requests = await sampleAudioRequests(
      script([
        turn({ index: 0, speaker: "system", text: "Good morning." }),
        turn({ index: 1, speaker: "learner", text: "Good morning." }),
      ])
    );

    expect(requests).toHaveLength(2);
    expect(requests[0].key).not.toBe(requests[1].key);
  });

  it("skips a blank line rather than synthesising silence", async () => {
    const requests = await sampleAudioRequests(
      script([
        turn({ index: 0, text: "   " }),
        turn({ index: 1, text: "Something to say." }),
      ])
    );

    expect(requests.map((r) => r.turnIndexes)).toEqual([[1]]);
  });
});

describe("pendingRequests", () => {
  it("returns nothing when every line is already stored", async () => {
    // The story's central claim: reopening a script has nothing left to fetch.
    const target = script([
      turn({ index: 0, speaker: "system", text: "It is cold." }),
      turn({ index: 1, speaker: "learner", text: "Very cold." }),
    ]);
    const requests = await sampleAudioRequests(target);
    const store = fakeStore(requests.map((r) => r.key));

    expect(await pendingRequests(requests, store)).toEqual([]);
  });

  it("returns only the missing ones on a partial cache", async () => {
    const requests = await sampleAudioRequests(
      script([
        turn({ index: 0, speaker: "system", text: "One." }),
        turn({ index: 1, speaker: "learner", text: "Two." }),
        turn({ index: 2, speaker: "system", text: "Three." }),
      ])
    );
    const store = fakeStore([requests[0].key, requests[2].key]);

    const pending = await pendingRequests(requests, store);

    expect(pending.map((r) => r.turnIndexes)).toEqual([[1]]);
  });

  it("treats an unreadable store as empty rather than as full", async () => {
    // A broken store must not fake a complete cache and leave dead play
    // buttons behind; fetching and failing loudly on the write is honest.
    const requests = await sampleAudioRequests(
      script([turn({ index: 0, text: "One." })])
    );
    const store: SampleAudioStore = {
      has: async () => {
        throw new Error("InvalidStateError");
      },
      get: async () => undefined,
      put: async () => {},
    };

    expect(await pendingRequests(requests, store)).toHaveLength(1);
  });
});

describe("initialStatuses", () => {
  it("marks an already-stored turn ready, keyed by turn index", async () => {
    // Keyed by `DialogueTurn.index`, not by request key — the UI looks turns
    // up by index and would find nothing under a hash.
    const target = script([
      turn({ index: 0, speaker: "system", text: "One." }),
      turn({ index: 1, speaker: "learner", text: "Two." }),
    ]);
    const requests = await sampleAudioRequests(target);

    expect(initialStatuses(requests, [requests[1]])).toEqual({
      0: "ready",
      1: "idle",
    });
  });

  it("gives a fully stored script play buttons on every turn", async () => {
    // Iterating `pending` instead of `requests` would leave a *reopened*
    // script — the case with nothing pending — with no controls at all, and
    // nothing else in the system would notice.
    const requests = await sampleAudioRequests(
      script([
        turn({ index: 0, speaker: "system", text: "One." }),
        turn({ index: 1, speaker: "learner", text: "Two." }),
      ])
    );

    expect(initialStatuses(requests, [])).toEqual({ 0: "ready", 1: "ready" });
  });

  it("marks every turn a shared blob serves", async () => {
    const requests = await sampleAudioRequests(
      script([
        turn({ index: 0, speaker: "system", text: "Really?" }),
        turn({ index: 1, speaker: "learner", text: "Yes." }),
        turn({ index: 2, speaker: "system", text: "Really?" }),
      ])
    );

    expect(initialStatuses(requests, [])).toEqual({
      0: "ready",
      1: "ready",
      2: "ready",
    });
  });
});

describe("sampleAudioPayload", () => {
  it("names the fields the route reads", async () => {
    // The contract neither the route tests nor the driver tests would cross on
    // their own; `app/api/tts/route.test.ts` feeds this straight into `POST`.
    const [request] = await sampleAudioRequests(
      script([turn({ index: 0, speaker: "learner", text: "Good morning." })])
    );

    expect(sampleAudioPayload(request)).toEqual({
      text: "Good morning.",
      voice: SPEAKER_VOICES.learner,
    });
  });
});

describe("generateSampleAudio", () => {
  function requestList(count: number): SampleAudioRequest[] {
    return Array.from({ length: count }, (_, i) => ({
      key: `key-${i}`,
      voice: SPEAKER_VOICES.system,
      text: `Line ${i}.`,
      turnIndexes: [i],
    }));
  }

  it("issues no fetch at all when there is nothing pending", async () => {
    // The reopen case, end to end: `pendingRequests` returned [], so the
    // driver cannot reach the network however it is wired up.
    const fetchAudio = vi.fn(async () => new Blob(["audio"]));

    await generateSampleAudio([], fakeStore(), fetchAudio);

    expect(fetchAudio).not.toHaveBeenCalled();
  });

  it("fetches sequentially — the F0 tier is rate-limited", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchAudio = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return new Blob(["audio"]);
    });

    await generateSampleAudio(requestList(4), fakeStore(), fetchAudio);

    expect(fetchAudio).toHaveBeenCalledTimes(4);
    expect(maxInFlight).toBe(1);
  });

  it("stores each blob under its content key and reports ready", async () => {
    const store = fakeStore();
    const seen: [string, SampleAudioStatus][] = [];

    await generateSampleAudio(
      requestList(2),
      store,
      async () => new Blob(["audio"]),
      { onStatus: (request, status) => seen.push([request.key, status]) }
    );

    expect([...store.blobs.keys()]).toEqual(["key-0", "key-1"]);
    expect(seen).toEqual([
      ["key-0", "fetching"],
      ["key-0", "ready"],
      ["key-1", "fetching"],
      ["key-1", "ready"],
    ]);
  });

  it("marks one failed line and carries on with the rest", async () => {
    const store = fakeStore();
    const failures: string[] = [];
    const fetchAudio = vi.fn(async (request: SampleAudioRequest) => {
      if (request.key === "key-1") throw new Error("Azure TTS 429");
      return new Blob(["audio"]);
    });

    await generateSampleAudio(requestList(3), store, fetchAudio, {
      onStatus: (request, status) => {
        if (status === "failed") failures.push(request.key);
      },
    });

    expect(failures).toEqual(["key-1"]);
    expect([...store.blobs.keys()]).toEqual(["key-0", "key-2"]);
  });

  it("stops cleanly on a quota error and reports it once", async () => {
    const quota = new Error("The quota has been exceeded.");
    quota.name = "QuotaExceededError";
    const store: SampleAudioStore = {
      has: async () => false,
      get: async () => undefined,
      put: async () => {
        throw quota;
      },
    };
    const fetchAudio = vi.fn(async () => new Blob(["audio"]));
    const failed: number[] = [];
    const halts: [SampleAudioHaltReason, string][] = [];

    await generateSampleAudio(requestList(5), store, fetchAudio, {
      onStatus: (request, status) => {
        if (status === "failed") failed.push(request.turnIndexes[0]);
      },
      onHalt: (reason, message) => halts.push([reason, message]),
    });

    // One line attempted, one notice, then it gives up — the disk will not
    // have got emptier by line five.
    expect(fetchAudio).toHaveBeenCalledTimes(1);
    expect(halts).toEqual([["quota", STORAGE_FAILURE_MESSAGES.quota]]);
    // And nothing is left sitting at `idle`, which reads as "still queued".
    expect(failed).toEqual([0, 1, 2, 3, 4]);
  });

  it("stops on a plain write error too, as a write error", async () => {
    const store: SampleAudioStore = {
      has: async () => false,
      get: async () => undefined,
      put: async () => {
        throw new Error("Thao tác IndexedDB thất bại");
      },
    };
    const reported: SampleAudioHaltReason[] = [];

    await generateSampleAudio(
      requestList(3),
      store,
      async () => new Blob(["audio"]),
      { onHalt: (reason) => reported.push(reason) }
    );

    expect(reported).toEqual(["write-error"]);
  });

  it("stops the whole run on a provider failure and names it once", async () => {
    // No credential, or one Azure rejected: true of every remaining line. As a
    // per-line failure it would cost twelve pointless round trips and show
    // twelve warnings that never say why.
    const notice = "Chưa cấu hình AZURE_SPEECH_KEY / AZURE_SPEECH_REGION trong .env.local";
    const store = fakeStore();
    const fetchAudio = vi.fn(async () => {
      throw new SampleAudioProviderError(notice);
    });
    const failed: number[] = [];
    const halts: [SampleAudioHaltReason, string][] = [];

    await generateSampleAudio(requestList(4), store, fetchAudio, {
      onStatus: (request, status) => {
        if (status === "failed") failed.push(request.turnIndexes[0]);
      },
      onHalt: (reason, message) => halts.push([reason, message]),
    });

    expect(fetchAudio).toHaveBeenCalledTimes(1);
    expect(halts).toEqual([["provider", notice]]);
    expect(failed).toEqual([0, 1, 2, 3]);
  });

  it("shares one in-flight synthesis between concurrent runs", async () => {
    // React StrictMode mounts the effect twice; the second run reaches
    // `pendingRequests` before the first run's `put` has committed. Without a
    // shared in-flight map that first line is fetched — and billed — twice,
    // concurrently, which also breaks the one-at-a-time property above.
    const store = fakeStore();
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchAudio = vi.fn(async () => {
      await gate;
      return new Blob(["audio"]);
    });

    const first = generateSampleAudio(requestList(1), store, fetchAudio);
    const second = generateSampleAudio(requestList(1), store, fetchAudio);
    release!();
    await Promise.all([first, second]);

    expect(fetchAudio).toHaveBeenCalledTimes(1);
    expect([...store.blobs.keys()]).toEqual(["key-0"]);
  });

  it("stops when the caller has moved on, keeping the blob it already paid for", async () => {
    let cancelled = false;
    const store = fakeStore();
    const fetchAudio = vi.fn(async () => {
      cancelled = true;
      return new Blob(["audio"]);
    });

    await generateSampleAudio(
      requestList(3),
      store,
      fetchAudio,
      {},
      () => !cancelled
    );

    expect(fetchAudio).toHaveBeenCalledTimes(1);
    // A StrictMode remount cancels mid-flight; discarding a finished synthesis
    // would mean buying it from Azure a second time.
    expect([...store.blobs.keys()]).toEqual(["key-0"]);
  });
});

describe("classifyStorageError", () => {
  it("recognises a DOMException-style quota error by name", () => {
    const err = new Error("boom");
    err.name = "QuotaExceededError";

    expect(classifyStorageError(err)).toBe("quota");
  });

  it("recognises the Firefox name", () => {
    const err = new Error("boom");
    err.name = "NS_ERROR_DOM_QUOTA_REACHED";

    expect(classifyStorageError(err)).toBe("quota");
  });

  it("recognises a wrapped transaction error by its message", () => {
    expect(classifyStorageError(new Error("Quota exceeded."))).toBe("quota");
  });

  it("reads a DOMException, which is not an Error", () => {
    // The failure that actually matters is a `DOMException` off the aborted
    // IndexedDB transaction, and `domException instanceof Error` is false.
    expect(
      classifyStorageError({
        name: "QuotaExceededError",
        message: "The quota has been exceeded.",
      })
    ).toBe("quota");
  });

  it("calls anything else a write error", () => {
    expect(classifyStorageError(new Error("InvalidStateError"))).toBe(
      "write-error"
    );
    expect(classifyStorageError("nope")).toBe("write-error");
  });

  it("has a Vietnamese message for both, and both keep the script", () => {
    for (const message of Object.values(STORAGE_FAILURE_MESSAGES)) {
      expect(message).toContain("Kịch bản vẫn dùng bình thường");
    }
  });
});
