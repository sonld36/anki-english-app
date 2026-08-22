import { describe, expect, it, vi } from "vitest";
import {
  CAPTURE_FAILURE_NOTICES,
  EMPTY_TAKE_NOTICE,
  MISSING_TAKE_NOTICE,
  NO_SIGNAL_NOTICE,
  RECORDING_NAMESPACE,
  STORE_FAILURE_NOTICES,
  classifyCaptureError,
  isPermanentCaptureFailure,
  clearRecordings,
  loadTake,
  peakWarning,
  recordingKey,
  storeTake,
  type RecordingStore,
} from "./recording";
import { SAMPLE_AUDIO_NAMESPACE } from "./sample-audio";
import { LOW_PEAK_THRESHOLD } from "./wav";

/**
 * The node environment has neither IndexedDB nor `getUserMedia`, which is the
 * whole reason these decisions live outside the hook. A Map plays the store.
 */
function fakeStore(namespace: string, world: Map<string, Blob>) {
  const prefix = `${namespace}:`;
  const store: RecordingStore & { puts: number } = {
    puts: 0,
    async get(key) {
      return world.get(prefix + key);
    },
    async put(key, blob) {
      store.puts += 1;
      world.set(prefix + key, blob);
    },
    async clear() {
      for (const id of [...world.keys()]) {
        if (id.startsWith(prefix)) world.delete(id);
      }
    },
  };
  return store;
}

const wav = (n = 8) => new Blob([new Uint8Array(n)], { type: "audio/wav" });

/** A `DOMException` is not an `Error`; the classifier must not assume it is. */
const domError = (name: string, message = "") => ({ name, message });

describe("RECORDING_NAMESPACE", () => {
  it("is its own namespace, never the sample-audio one", () => {
    // Two declarations, one test: if these ever converge, clearing the
    // session's takes would silently delete every MP3 the user paid for.
    expect(RECORDING_NAMESPACE).toBe("recordings");
    expect(RECORDING_NAMESPACE).not.toBe(SAMPLE_AUDIO_NAMESPACE);
  });
});

describe("recordingKey", () => {
  it("is positional — entry id plus turn index, never a content hash", () => {
    expect(recordingKey("entry-1", 3)).toBe("entry-1:3");
  });

  it("separates two turns of one entry and one turn across two entries", () => {
    expect(recordingKey("a", 0)).not.toBe(recordingKey("a", 1));
    expect(recordingKey("a", 0)).not.toBe(recordingKey("b", 0));
  });

  it("is stable, so re-recording a turn lands on the same key", () => {
    expect(recordingKey("e", 2)).toBe(recordingKey("e", 2));
  });
});

describe("storeTake", () => {
  it("writes the take under its key", async () => {
    const world = new Map<string, Blob>();
    const store = fakeStore(RECORDING_NAMESPACE, world);
    const blob = wav();

    const result = await storeTake(store, recordingKey("e", 1), blob);

    expect(result).toEqual({ ok: true, key: "e:1" });
    expect(world.get("recordings:e:1")).toBe(blob);
  });

  it("replaces the previous take on a re-record, keeping exactly one blob", async () => {
    const world = new Map<string, Blob>();
    const store = fakeStore(RECORDING_NAMESPACE, world);
    const key = recordingKey("e", 1);

    await storeTake(store, key, wav(4));
    const second = wav(9);
    await storeTake(store, key, second);

    expect([...world.keys()]).toEqual(["recordings:e:1"]);
    expect(world.get("recordings:e:1")).toBe(second);
  });

  it("classifies a full disk as quota and says so in Vietnamese", async () => {
    const store = fakeStore(RECORDING_NAMESPACE, new Map());
    store.put = async () => {
      throw domError("QuotaExceededError");
    };

    const result = await storeTake(store, "e:0", wav());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failure).toBe("quota");
    expect(result.notice).toBe(STORE_FAILURE_NOTICES.quota);
    expect(result.notice.text).toMatch(/đầy/);
  });

  it("classifies anything else as a plain write error", async () => {
    const store = fakeStore(RECORDING_NAMESPACE, new Map());
    store.put = async () => {
      throw new Error("InvalidStateError");
    };

    const result = await storeTake(store, "e:0", wav());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failure).toBe("write-error");
  });

  it("never throws — a failed write must not cost the user the turn", async () => {
    const store = fakeStore(RECORDING_NAMESPACE, new Map());
    store.put = async () => {
      throw "a string, not an Error";
    };
    await expect(storeTake(store, "e:0", wav())).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("loadTake", () => {
  it("reads a stored take back", async () => {
    const world = new Map<string, Blob>();
    const store = fakeStore(RECORDING_NAMESPACE, world);
    const blob = wav();
    await storeTake(store, "e:2", blob);
    expect(await loadTake(store, "e:2")).toBe(blob);
  });

  it("reports a vanished blob as undefined rather than throwing", async () => {
    const store = fakeStore(RECORDING_NAMESPACE, new Map());
    expect(await loadTake(store, "e:2")).toBeUndefined();

    store.get = async () => {
      throw domError("InvalidStateError");
    };
    expect(await loadTake(store, "e:2")).toBeUndefined();
  });
});

describe("clearRecordings", () => {
  it("drops every take and leaves the sample audio alone", async () => {
    // One world, two namespaces — exactly the shape `lib/blob-store.ts` has.
    const world = new Map<string, Blob>();
    const takes = fakeStore(RECORDING_NAMESPACE, world);
    const samples = fakeStore(SAMPLE_AUDIO_NAMESPACE, world);

    await storeTake(takes, "e:0", wav());
    await storeTake(takes, "e:1", wav());
    await samples.put("abc123", wav());

    await clearRecordings(takes);

    expect([...world.keys()]).toEqual(["tts:abc123"]);
  });

  it("swallows a rejection — cleanup must never fail the UI", async () => {
    const store = fakeStore(RECORDING_NAMESPACE, new Map());
    store.clear = async () => {
      throw domError("InvalidStateError");
    };
    await expect(clearRecordings(store)).resolves.toBeUndefined();
  });

  it("only ever calls clear on the store it is handed", async () => {
    const store = fakeStore(RECORDING_NAMESPACE, new Map());
    const spy = vi.spyOn(store, "clear");
    await clearRecordings(store);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("classifyCaptureError", () => {
  it("reads a denied permission off the DOMException name", () => {
    expect(classifyCaptureError(domError("NotAllowedError"))).toBe(
      "permission-denied"
    );
    expect(classifyCaptureError(domError("PermissionDeniedError"))).toBe(
      "permission-denied"
    );
    // An insecure origin is the same conversation from the user's side.
    expect(classifyCaptureError(domError("SecurityError"))).toBe(
      "permission-denied"
    );
  });

  it("reads a missing device off its own names", () => {
    expect(classifyCaptureError(domError("NotFoundError"))).toBe("no-device");
    expect(classifyCaptureError(domError("DevicesNotFoundError"))).toBe(
      "no-device"
    );
  });

  it("reads a busy device — the everyday case — as its own failure", () => {
    // The microphone exists and is allowed; a video call is holding it.
    expect(classifyCaptureError(domError("NotReadableError"))).toBe(
      "device-busy"
    );
    expect(classifyCaptureError(domError("TrackStartError"))).toBe("device-busy");
    expect(classifyCaptureError(domError("AbortError"))).toBe("device-busy");
  });

  it("never blames the hardware for a constraint we asked for", () => {
    // `OverconstrainedError` is raised by our own audio constraints. Reporting
    // it as `no-device` tells the user to go and buy a microphone because of
    // our bug.
    expect(classifyCaptureError(domError("OverconstrainedError"))).toBe(
      "unavailable"
    );
    expect(classifyCaptureError(domError("ConstraintNotSatisfiedError"))).toBe(
      "unavailable"
    );
  });

  it("treats a worklet that failed to load as unavailable, not as a denial", () => {
    // `addModule` rejects with an ordinary Error and no useful name.
    expect(
      classifyCaptureError(new Error("Failed to load audio-processor.worklet.js"))
    ).toBe("unavailable");
    expect(classifyCaptureError(undefined)).toBe("unavailable");
    expect(classifyCaptureError(null)).toBe("unavailable");
  });

  it("still catches a denial reported only in the message", () => {
    expect(classifyCaptureError(new Error("The request is not allowed"))).toBe(
      "permission-denied"
    );
  });

  it("maps the four failures to four distinct notices, each with glyph and words", () => {
    const notices = Object.values(CAPTURE_FAILURE_NOTICES);
    expect(notices).toHaveLength(4);
    expect(new Set(notices.map((n) => n.text)).size).toBe(4);
    for (const notice of notices) {
      expect(notice.glyph.trim().length).toBeGreaterThan(0);
      expect(notice.text.trim().length).toBeGreaterThan(0);
      // Every one of them tells the user the session is not over.
      expect(notice.text).toMatch(/Tiếp/);
    }
  });

  it("tells a denied user why the mic is needed and how to turn it back on", () => {
    const notice = CAPTURE_FAILURE_NOTICES["permission-denied"];
    expect(notice.text).toMatch(/nghe lại/); // why
    expect(notice.text).toMatch(/Micro/); // how — where the setting lives
  });

  it("never tells the user to reload — the session is in memory and would be lost", () => {
    // "Tải lại trang" mid-session throws away every completed turn. Only the
    // no-signal notice may suggest it, and only as a last resort *before* a new
    // session, which its wording says explicitly.
    for (const [failure, notice] of Object.entries(CAPTURE_FAILURE_NOTICES)) {
      expect(notice.text, failure).not.toMatch(/rồi tải lại trang/);
    }
    expect(EMPTY_TAKE_NOTICE.text).not.toMatch(/tải lại/);
  });

  it("keeps the mic recoverable unless trying again genuinely cannot help", () => {
    expect(isPermanentCaptureFailure("permission-denied")).toBe(true);
    expect(isPermanentCaptureFailure("no-device")).toBe(true);
    // A held device is freed; a worklet fetch can fail once. Killing the mic
    // for the whole session over either is a permanent punishment for a
    // temporary fault.
    expect(isPermanentCaptureFailure("device-busy")).toBe(false);
    expect(isPermanentCaptureFailure("unavailable")).toBe(false);
  });

  it("keeps 'no signal' distinct from 'you said nothing'", () => {
    // A suspended AudioContext produces no samples at all. Answering that with
    // "nói to hơn" is advice that cannot possibly work.
    expect(NO_SIGNAL_NOTICE.text).not.toBe(EMPTY_TAKE_NOTICE.text);
    expect(NO_SIGNAL_NOTICE.text).not.toMatch(/to hơn/);
    expect(NO_SIGNAL_NOTICE.text).toMatch(/Tiếp/);
    expect(EMPTY_TAKE_NOTICE.text).toMatch(/to hơn/);
  });

  it("never blames the microphone for a result", () => {
    for (const notice of Object.values(CAPTURE_FAILURE_NOTICES)) {
      expect(notice.text).not.toMatch(/điểm|chấm/i);
    }
  });
});

describe("peakWarning", () => {
  it("warns below the threshold, with a glyph and words", () => {
    const notice = peakWarning(LOW_PEAK_THRESHOLD - 0.01);
    expect(notice).not.toBeNull();
    expect(notice?.glyph).toBe("!");
    expect(notice?.tone).toBe("warning");
    expect(notice?.text).toMatch(/micro/);
  });

  it("says nothing about a take at or above the threshold", () => {
    expect(peakWarning(LOW_PEAK_THRESHOLD)).toBeNull();
    expect(peakWarning(0.8)).toBeNull();
  });

  it("is a diagnostic, not an excuse — it never mentions the score", () => {
    expect(peakWarning(0)?.text).not.toMatch(/điểm|chấm/i);
  });
});

describe("the transient notices", () => {
  it("treat a silence-only take as 'you did not speak', not as broken hardware", () => {
    expect(EMPTY_TAKE_NOTICE.text).toMatch(/Không thu được tiếng nào/);
    expect(EMPTY_TAKE_NOTICE.glyph.length).toBeGreaterThan(0);
  });

  it("report a vanished blob without dressing it up", () => {
    expect(MISSING_TAKE_NOTICE.text).toMatch(/không còn/);
  });

  it("all carry words a screen reader can reach, never a glyph alone", () => {
    const all = [
      ...Object.values(CAPTURE_FAILURE_NOTICES),
      ...Object.values(STORE_FAILURE_NOTICES),
      EMPTY_TAKE_NOTICE,
      NO_SIGNAL_NOTICE,
      MISSING_TAKE_NOTICE,
      peakWarning(0)!,
    ];
    for (const notice of all) {
      expect(notice.text.trim().length).toBeGreaterThan(0);
      expect(["info", "warning", "danger"]).toContain(notice.tone);
    }
  });
});
