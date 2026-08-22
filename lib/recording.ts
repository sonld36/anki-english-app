// The learner's own takes: where they are keyed, what a capture failure means,
// and what the user is told about it.
//
// Same split as `lib/sample-audio.ts` and for the same reason — `vitest` runs
// in `environment: "node"`, which has neither IndexedDB nor `getUserMedia`, so
// the store arrives as a parameter (`RecordingStore`) and the browser wrapper
// (`hooks/useTurnRecorder.ts`) stays thin enough that nothing testable hides
// inside it.
//
// Two properties this module exists to pin:
//
//  - **the key is positional, never a content hash.** `lib/sample-audio.ts`
//    hashes voice + text because two identical lines *should* share one blob.
//    Two takes are never identical and must never be shared, so a take is keyed
//    by entry id + turn index. That also makes per-entry cleanup safe here,
//    unlike the `"tts"` namespace where a shared blob makes it unsafe.
//  - **cleanup targets `recordings` and nothing else.** Dropping a namespace is
//    a cursor over `by_namespace` (`lib/blob-store.ts`), so the native sample
//    audio the user has already paid Azure for survives every session boundary.

import { classifyStorageError, type StorageFailure } from "./sample-audio";
import { isPeakTooLow } from "./wav";

/**
 * The namespace Epic 2 owns in the blob store. Story 1.4 owns `"tts"`; the two
 * never overlap, and clearing one must never touch the other.
 */
export const RECORDING_NAMESPACE = "recordings";

/**
 * Where one take lives.
 *
 * Positional, not a content hash: see the module header. Re-recording a turn
 * therefore *overwrites* the previous take rather than accumulating one blob
 * per attempt — which is also why no attempt counter is kept here (that is
 * Story 2.5's, and it is deliberately absent).
 */
export function recordingKey(entryId: string, turnIndex: number): string {
  return `${entryId}:${turnIndex}`;
}

/**
 * The store as this module needs it — a key/value view of one namespace,
 * mirroring `SampleAudioStore`. `lib/blob-store.ts` supplies the real one;
 * tests supply a Map.
 */
export interface RecordingStore {
  get(key: string): Promise<Blob | undefined>;
  put(key: string, blob: Blob): Promise<void>;
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

/** `warning` is the dashed-border, `!`-glyph tier from DESIGN.md's colour table. */
export type RecordingNoticeTone = "info" | "warning" | "danger";

/**
 * A glyph **and** words. Never colour alone — roughly one man in twelve cannot
 * separate red from green, and this product lives on right/wrong feedback.
 */
export interface RecordingNotice {
  glyph: string;
  text: string;
  tone: RecordingNoticeTone;
}

/**
 * Why capture never started.
 *
 * Four, not one: the user can *act* on three of them and the wording differs
 * completely, so collapsing them into "không mở được micro" would tell someone
 * with a blocked permission to go buy a microphone, and someone whose mic is
 * held by a video call to blame their browser.
 */
export type CaptureFailure =
  | "permission-denied"
  | "no-device"
  | "device-busy"
  | "unavailable";

/**
 * `getUserMedia` rejects with a `DOMException`, which is **not** an `Error`, so
 * `name` and `message` are read by duck-typing exactly as
 * `classifyStorageError` does. A worklet that fails to load throws something
 * else entirely and lands in `unavailable`.
 */
export function classifyCaptureError(error: unknown): CaptureFailure {
  const fields = (error ?? {}) as { name?: unknown; message?: unknown };
  const name = typeof fields.name === "string" ? fields.name : "";
  const message =
    typeof fields.message === "string" ? fields.message : String(error);

  // `SecurityError` is what a non-secure origin gets; from the user's side it
  // is the same conversation as a denied permission.
  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    name === "SecurityError"
  ) {
    return "permission-denied";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "no-device";
  }
  // The everyday one: the microphone exists and is allowed, but another
  // application (a video call, another tab) is holding it. `AbortError` is the
  // same conversation — the device could not be started for a hardware reason.
  if (
    name === "NotReadableError" ||
    name === "TrackStartError" ||
    name === "AbortError"
  ) {
    return "device-busy";
  }
  // `OverconstrainedError` is *our* bug, not the user's hardware: it means the
  // constraints we asked for cannot be met. Telling them to buy a microphone
  // would be a lie. (`hooks/useTurnRecorder.ts` asks with `ideal`, so this
  // should be unreachable — it is classified honestly in case it is not.)
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return "unavailable";
  }
  // Firefox has historically reported a denial through the message alone.
  if (/permission denied|not allowed/i.test(message)) return "permission-denied";
  return "unavailable";
}

/**
 * Is this failure worth locking the microphone away for the rest of the
 * session?
 *
 * Only when trying again cannot possibly help. A denial will not change until
 * the user changes a browser setting, and an absent device will not appear on
 * its own — EXPERIENCE.md's "không xin lại lần nữa" is about exactly those two.
 * A busy device is freed the moment the other application lets go, and a
 * worklet fetch can fail once on a flaky connection; killing the mic for the
 * whole session over either would be a permanent punishment for a transient
 * fault. Those stay retryable — the exit opens (see `blockTake` in
 * `lib/session.ts`) without the mic going inert.
 */
export function isPermanentCaptureFailure(failure: CaptureFailure): boolean {
  return failure === "permission-denied" || failure === "no-device";
}

/**
 * What the user is told, once per failure.
 *
 * The permission message follows EXPERIENCE.md's rule literally: say **why**
 * the microphone is needed and **how** to turn it back on — and then stop. The
 * screen never asks a second time; the mic simply stays inert and "Tiếp" keeps
 * the session moving.
 */
export const CAPTURE_FAILURE_NOTICES: Record<CaptureFailure, RecordingNotice> = {
  "permission-denied": {
    glyph: "🎤",
    tone: "warning",
    text:
      "Trình duyệt đang chặn micro, nên không ghi được câu bạn nói để nghe lại. " +
      "Mở lại quyền micro cho trang này trong phần cài đặt quyền của trình duyệt " +
      "(trên điện thoại: nút bên trái thanh địa chỉ → Quyền → Micro). " +
      "Buổi luyện này vẫn đi tiếp được bằng nút Tiếp — mở lại quyền rồi thì bắt đầu buổi mới.",
  },
  "no-device": {
    glyph: "🎧",
    tone: "warning",
    text:
      "Không tìm thấy micro nào trên máy. Cắm tai nghe có micro hoặc bật micro " +
      "trong cài đặt hệ thống. Buổi luyện này vẫn đi tiếp được bằng nút Tiếp — " +
      "có micro rồi thì bắt đầu buổi mới.",
  },
  "device-busy": {
    glyph: "🔒",
    tone: "warning",
    text:
      "Micro đang được ứng dụng khác dùng (cuộc gọi video, một tab khác). " +
      "Đóng ứng dụng đó rồi bấm mic thử lại. Buổi luyện vẫn đi tiếp được bằng nút Tiếp.",
  },
  unavailable: {
    glyph: "⚠",
    tone: "warning",
    text:
      "Không mở được đường ghi âm lần này. Bấm mic thử lại một lần nữa xem sao. " +
      "Buổi luyện vẫn đi tiếp được bằng nút Tiếp, bạn chỉ không nghe lại được câu vừa nói.",
  },
};

/**
 * The trimmed take had no samples left.
 *
 * Worded as an observation, not an accusation, and it does **not** blame the
 * microphone — the peak warning below is the only place hardware is mentioned,
 * and even there it is a signal diagnostic rather than an excuse.
 */
export const EMPTY_TAKE_NOTICE: RecordingNotice = {
  glyph: "🔇",
  tone: "warning",
  text: "Không thu được tiếng nào. Bấm mic và nói to hơn một chút.",
};

/**
 * The graph ran but the worklet posted nothing at all — no samples reached us,
 * not even silent ones.
 *
 * Deliberately **not** `EMPTY_TAKE_NOTICE`. A suspended `AudioContext` (iOS
 * and Safari start one that way) or a stalled graph produces exactly this, and
 * telling the learner to "nói to hơn" about a microphone that was never
 * running is advice that can never work — and it edges towards blaming them
 * for a fault of ours.
 */
export const NO_SIGNAL_NOTICE: RecordingNotice = {
  glyph: "⚠",
  tone: "warning",
  text:
    "Đường ghi âm không nhận được tín hiệu nào từ micro. Bấm mic thử lại; nếu " +
    "vẫn vậy thì tải lại trang trước khi bắt đầu buổi mới. Buổi luyện vẫn đi tiếp được bằng nút Tiếp.",
};

/** The blob is gone (cleared in another tab, evicted). The turn is unaffected. */
export const MISSING_TAKE_NOTICE: RecordingNotice = {
  glyph: "⚠",
  tone: "warning",
  text: "Bản ghi này không còn trong bộ nhớ trình duyệt nữa.",
};

/**
 * Storage failed. Both messages end the same way on purpose: the session is
 * untouched, only the listening-back is lost.
 */
export const STORE_FAILURE_NOTICES: Record<StorageFailure, RecordingNotice> = {
  quota: {
    glyph: "⚠",
    tone: "warning",
    text:
      "Bộ nhớ trình duyệt đã đầy nên không giữ được bản ghi. Buổi luyện vẫn đi " +
      "tiếp bình thường, bạn chỉ không nghe lại được câu vừa nói.",
  },
  "write-error": {
    glyph: "⚠",
    tone: "warning",
    text:
      "Không lưu được bản ghi vào bộ nhớ trình duyệt. Buổi luyện vẫn đi tiếp " +
      "bình thường, bạn chỉ không nghe lại được câu vừa nói.",
  },
};

/**
 * The take is quiet enough that the wrong input is probably selected.
 *
 * The take is **kept and playable** either way — this is a diagnostic hung
 * beside it, never a reason offered for a poor score. `null` means nothing
 * worth saying.
 */
export function peakWarning(peak: number): RecordingNotice | null {
  if (!isPeakTooLow(peak)) return null;
  return {
    glyph: "!",
    tone: "warning",
    text: "Tiếng thu được rất nhỏ — có thể trình duyệt đang dùng nhầm micro.",
  };
}

// ---------------------------------------------------------------------------
// Store decisions
// ---------------------------------------------------------------------------

export type StoreTakeResult =
  | { ok: true; key: string }
  | { ok: false; failure: StorageFailure; notice: RecordingNotice };

/**
 * Write one take, replacing whatever sat under the same key.
 *
 * `putBlob` is already an overwrite, so re-recording needs no delete first —
 * and must not do one, because a delete followed by a failed write would lose
 * the take the learner already had.
 */
export async function storeTake(
  store: RecordingStore,
  key: string,
  blob: Blob
): Promise<StoreTakeResult> {
  try {
    await store.put(key, blob);
    return { ok: true, key };
  } catch (error) {
    const failure = classifyStorageError(error);
    return { ok: false, failure, notice: STORE_FAILURE_NOTICES[failure] };
  }
}

/**
 * Drop every take of this session.
 *
 * Fire-and-forget by contract: a session that cannot empty its own scratch
 * space must still end, and this runs from `environment: "node"` tests where
 * there is no IndexedDB at all. It clears **only** the store it is handed —
 * `hooks/useTurnRecorder.ts` hands it the `recordings` namespace, so `"tts"`
 * is out of reach by construction rather than by care.
 */
export async function clearRecordings(store: RecordingStore): Promise<void> {
  try {
    await store.clear();
  } catch {
    /* losing the cleanup must never cost the user the session */
  }
}

/** Read one take back. A missing or unreadable blob is `undefined`, not a throw. */
export async function loadTake(
  store: RecordingStore,
  key: string
): Promise<Blob | undefined> {
  try {
    return await store.get(key);
  } catch {
    return undefined;
  }
}
