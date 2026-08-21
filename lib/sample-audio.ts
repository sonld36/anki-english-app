// Sample-audio decision logic: which lines need synthesising, under what key,
// and what a failure means. Deliberately free of IndexedDB and of React.
//
// `vitest.config.mts` runs in `environment: "node"`, which has no IndexedDB.
// Rather than fake one, everything worth testing lives here and takes the
// store as a parameter (`SampleAudioStore`), so the claims this story rests on
// — *a reopened script fetches nothing*, one blob per distinct line and voice,
// a full disk stops generation cleanly — are covered by real tests. Only the
// thin wrapper in `lib/blob-store.ts` is verified by hand.

import { SPEAKER_VOICES, type DialogueScript } from "./dialogue/types";

/** Namespace this story owns in the blob store. Epic 2 adds its own. */
export const SAMPLE_AUDIO_NAMESPACE = "tts";

/** Per-turn generation state, as the UI needs to show it. */
export type SampleAudioStatus = "idle" | "fetching" | "ready" | "failed";

export interface SampleAudioRequest {
  /** `sha256(voice + " " + text)`, hex — see `sampleAudioKey`. */
  key: string;
  voice: string;
  text: string;
  /**
   * Every turn this one blob serves. Two turns with identical text *and* voice
   * share a key, so they share a fetch and a stored blob; the same text on the
   * other role gets a different voice and therefore a different key.
   */
  turnIndexes: number[];
}

/**
 * The content key.
 *
 * Not `HistoryEntry.id`: audio is generated before the user clicks save, so
 * there is no entry id yet. The content hash exists the moment the script
 * does, is stable across reopening, and deduplicates identical lines across
 * different scripts for free.
 *
 * The voice is part of the hashed input, not a prefix on the key, so that the
 * same line read by the two roles can never collide.
 */
export async function sampleAudioKey(
  voice: string,
  text: string
): Promise<string> {
  const bytes = new TextEncoder().encode(`${voice} ${text}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * One request per distinct (voice, text) pair, in first-appearance order.
 *
 * Both roles are included: the learner has to hear the line they are about to
 * say, not only the line said to them.
 */
export async function sampleAudioRequests(
  script: DialogueScript
): Promise<SampleAudioRequest[]> {
  const byKey = new Map<string, SampleAudioRequest>();
  for (const turn of script.turns) {
    const text = turn.text.trim();
    if (!text) continue;
    const voice = SPEAKER_VOICES[turn.speaker];
    const key = await sampleAudioKey(voice, text);
    const existing = byKey.get(key);
    if (existing) existing.turnIndexes.push(turn.index);
    else byKey.set(key, { key, voice, text, turnIndexes: [turn.index] });
  }
  return [...byKey.values()];
}

/** The body `/api/tts` expects. */
export interface SampleAudioPayload {
  text: string;
  voice: string;
}

/**
 * The request body, built here rather than inline in the hook.
 *
 * The field names are a contract with `app/api/tts/route.ts` that neither the
 * route tests (which build their own bodies) nor the driver tests (which
 * inject a fake fetcher) would otherwise cross. Renaming `voice` to
 * `voiceName` in the hook used to 400 every line in the browser while the
 * whole suite and `tsc` stayed green; `route.test.ts` now feeds this
 * function's output straight into `POST`.
 */
export function sampleAudioPayload(
  request: SampleAudioRequest
): SampleAudioPayload {
  return { text: request.text, voice: request.voice };
}

/**
 * The store as this module needs it — a key/value view of one namespace.
 * `lib/blob-store.ts` supplies the real one; tests supply a Map.
 */
export interface SampleAudioStore {
  has(key: string): Promise<boolean>;
  get(key: string): Promise<Blob | undefined>;
  put(key: string, blob: Blob): Promise<void>;
}

/**
 * Which requests still need a network call.
 *
 * This is the story's central claim in one function: reopening a script whose
 * audio is stored returns an empty list, so nothing downstream can fetch.
 *
 * A `has` that throws counts as missing. If the store is unusable (private
 * browsing, a corrupt database) we would rather fetch and fail loudly on the
 * write — which the user is told about once — than silently believe every
 * line is already stored and offer play buttons that do nothing.
 */
export async function pendingRequests(
  requests: SampleAudioRequest[],
  store: SampleAudioStore
): Promise<SampleAudioRequest[]> {
  const pending: SampleAudioRequest[] = [];
  for (const request of requests) {
    let stored = false;
    try {
      stored = await store.has(request.key);
    } catch {
      stored = false;
    }
    if (!stored) pending.push(request);
  }
  return pending;
}

/**
 * The per-turn state a script starts in, keyed by `DialogueTurn.index`.
 *
 * Extracted for the same reason the store is a parameter: iterating `pending`
 * instead of `requests` here would leave a *reopened* script — the case with
 * nothing pending — showing no play controls at all, and nothing else in the
 * system would notice. The mapping from request to turn indexes is the part
 * worth pinning.
 */
export function initialStatuses(
  requests: SampleAudioRequest[],
  pending: SampleAudioRequest[]
): Record<number, SampleAudioStatus> {
  const pendingKeys = new Set(pending.map((request) => request.key));
  const statuses: Record<number, SampleAudioStatus> = {};
  for (const request of requests) {
    const status: SampleAudioStatus = pendingKeys.has(request.key)
      ? "idle"
      : "ready";
    for (const index of request.turnIndexes) statuses[index] = status;
  }
  return statuses;
}

/**
 * A failure that is about the *provider*, not about one line.
 *
 * A missing or rejected Azure credential is true of the whole script. Treated
 * as a per-line failure it costs twelve pointless round trips and shows the
 * user twelve identical warnings without ever naming the cause, which is
 * exactly what the "Azure not configured" row of the matrix says must not
 * happen. `notice` carries the route's own Vietnamese message.
 */
export class SampleAudioProviderError extends Error {
  readonly notice: string;

  constructor(notice: string) {
    super(notice);
    this.name = "SampleAudioProviderError";
    this.notice = notice;
  }
}

/** Why generation stopped. All three are reported the same way: once. */
export type SampleAudioHaltReason = "quota" | "write-error" | "provider";

/** Why writing stopped. Both are reported the same way: once. */
export type StorageFailure = "quota" | "write-error";

/**
 * Quota errors do not have one name across browsers: Chrome throws a
 * `DOMException` named `QuotaExceededError`, older Firefox
 * `NS_ERROR_DOM_QUOTA_REACHED`, and a wrapped transaction error can arrive
 * with only a message. Anything unrecognised is a plain write error — which is
 * told to the user just as plainly, so a misclassification costs wording,
 * never behaviour.
 *
 * `name` and `message` are read by duck-typing rather than through
 * `instanceof Error`, because the error that actually matters here is a
 * `DOMException`, and a `DOMException` is *not* an `Error`.
 */
export function classifyStorageError(error: unknown): StorageFailure {
  const fields = (error ?? {}) as { name?: unknown; message?: unknown };
  const name = typeof fields.name === "string" ? fields.name : "";
  const message =
    typeof fields.message === "string" ? fields.message : String(error);
  if (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    /quota|storage.*full/i.test(message)
  ) {
    return "quota";
  }
  return "write-error";
}

/**
 * What the user is told, once. Both messages end the same way on purpose: the
 * script stays fully usable, only the listening is lost.
 */
export const STORAGE_FAILURE_MESSAGES: Record<StorageFailure, string> = {
  quota:
    "Bộ nhớ trình duyệt đã đầy nên không lưu được giọng mẫu. Kịch bản vẫn dùng bình thường, bạn chỉ không nghe được phần đọc mẫu.",
  "write-error":
    "Không lưu được giọng mẫu vào bộ nhớ trình duyệt. Kịch bản vẫn dùng bình thường, bạn chỉ không nghe được phần đọc mẫu.",
};

export interface SampleAudioProgress {
  onStatus(request: SampleAudioRequest, status: SampleAudioStatus): void;
  /**
   * Generation has stopped for the whole script. Called at most once per run,
   * and it is the only channel that produces a user-visible notice.
   */
  onHalt(reason: SampleAudioHaltReason, message: string): void;
}

/**
 * Syntheses currently in flight, keyed by content key.
 *
 * React StrictMode mounts an effect twice. The second mount runs
 * `pendingRequests` before the first mount's `put` has committed, so without
 * this the very first line is fetched — and *billed* — twice, concurrently.
 * Sharing the promise also keeps the "one request at a time" property that the
 * F0 tier needs and that the driver's own test asserts.
 *
 * Entries are removed as soon as the promise settles, so this never grows.
 */
const inFlight = new Map<string, Promise<Blob>>();

function sharedFetch(
  request: SampleAudioRequest,
  fetchAudio: (request: SampleAudioRequest) => Promise<Blob>
): Promise<Blob> {
  const existing = inFlight.get(request.key);
  if (existing) return existing;
  const promise = fetchAudio(request).finally(() => {
    inFlight.delete(request.key);
  });
  inFlight.set(request.key, promise);
  return promise;
}

/**
 * Fetch and store each request, **one at a time**.
 *
 * Sequential is a requirement, not an accident: the Azure free F0 tier is
 * rate-limited, and firing a dozen concurrent syntheses is the reliable way to
 * get every one of them throttled. It also keeps the UI honest — turns light
 * up in reading order.
 *
 * Three failure modes, deliberately asymmetric:
 *
 *  - a **per-line fetch** failure (a timeout, a 502) marks that one line
 *    failed and the loop continues, because one bad line must not cost the
 *    other eleven;
 *  - a **provider** failure (`SampleAudioProviderError`: no credential, a
 *    rejected key) stops the loop, because it is true of every remaining line;
 *  - a **write** failure stops the loop, because the disk will not have got
 *    emptier by the next line.
 *
 * Whenever the loop stops early, every request it never reached is marked
 * `failed` rather than left `idle`: `idle` means "still queued", and a control
 * stuck there forever tells the user something is coming that never will.
 *
 * None of this ever touches the script itself. Losing audio is not losing the
 * script.
 */
export async function generateSampleAudio(
  requests: SampleAudioRequest[],
  store: SampleAudioStore,
  fetchAudio: (request: SampleAudioRequest) => Promise<Blob>,
  progress: Partial<SampleAudioProgress> = {},
  shouldContinue: () => boolean = () => true
): Promise<void> {
  const halt = (from: number, reason: SampleAudioHaltReason, message: string) => {
    for (const abandoned of requests.slice(from)) {
      progress.onStatus?.(abandoned, "failed");
    }
    progress.onHalt?.(reason, message);
  };

  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    if (!shouldContinue()) return;

    progress.onStatus?.(request, "fetching");

    let blob: Blob;
    try {
      blob = await sharedFetch(request, fetchAudio);
    } catch (error) {
      if (error instanceof SampleAudioProviderError) {
        halt(index, "provider", error.notice);
        return;
      }
      progress.onStatus?.(request, "failed");
      continue;
    }

    // No cancellation check between the fetch and the write. The call has
    // already been paid for and the key is content-derived, so storing it is
    // idempotent and always worth doing.
    try {
      await store.put(request.key, blob);
    } catch (error) {
      const failure = classifyStorageError(error);
      halt(index, failure, STORAGE_FAILURE_MESSAGES[failure]);
      return;
    }

    progress.onStatus?.(request, "ready");
  }
}
