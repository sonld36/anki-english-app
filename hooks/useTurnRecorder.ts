"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { namespacedBlobStore } from "@/lib/blob-store";
import {
  MISSING_TAKE_NOTICE,
  RECORDING_NAMESPACE,
  classifyCaptureError,
  clearRecordings,
  loadTake,
  recordingKey,
  storeTake,
  type CaptureFailure,
  type RecordingNotice,
} from "@/lib/recording";
import type { TurnTake } from "@/lib/session";
import {
  SAMPLE_RATE,
  durationMs,
  encodeWav,
  peakLevel,
  totalSamples,
  trimSilence,
} from "@/lib/wav";

/**
 * Capture one turn as PCM 16 kHz / 16-bit mono in a WAV container, keep it in
 * the `recordings` blob namespace, and play it back.
 *
 * Deliberately thin. Every decision worth a test lives in `lib/wav.ts` (the
 * audio maths), `lib/recording.ts` (keys, notices, storage) and
 * `lib/session.ts` (when the mic means what) — `vitest` runs in
 * `environment: "node"` with no `AudioContext`, no `getUserMedia` and no
 * IndexedDB, so anything decided in here is decided where no test can reach.
 * What is left is transport, React state, and teardown.
 *
 * **`MediaRecorder` is not an option** — it yields webm/opus, and the
 * pronunciation service Story 2.3 calls wants raw PCM. The path is
 * `getUserMedia` → `AudioContext({ sampleRate: 16000 })` → the shared
 * `public/audio-processor.worklet.js` → `Int16Array` chunks.
 *
 * Teardown is the part that has to be right, because the reference loop in
 * `app/lab/pronunciation/page.tsx` gets it wrong in four separate ways and
 * those leaks must not be reproduced here: partial capture state is torn down
 * when construction throws (a stream left live keeps the browser's recording
 * indicator on), the stream ref is nulled, the object URL is revoked — when
 * playback *ends*, not only when it is stopped — and unmounting stops
 * everything. Two more this file has to answer that the lab page never faces:
 * `getUserMedia` resolving after the component is gone (checked against
 * `mounted` at every await, since nothing would be left to stop it), and
 * `cancel()` for the capture nobody wants any more — "Kết thúc buổi" pressed
 * mid-recording, or while the permission prompt is still open.
 *
 * There is exactly **one** implementation of each teardown half
 * (`teardownCapture`, `releasePlayback`); the unmount path calls those rather
 * than repeating the sequence, because the one place correctness matters most
 * is not the place to keep a second copy.
 */

/** Where a stopped capture ended up. */
export type CaptureOutcome =
  | { kind: "take"; take: TurnTake }
  /** Samples arrived, but trimmed to nothing — the learner did not speak. */
  | { kind: "empty" }
  /**
   * *No samples arrived at all* — the worklet never posted one.
   *
   * A different thing from `empty`, and it must stay different: a suspended
   * `AudioContext` (iOS, Safari) produces exactly this, and answering it with
   * "nói to hơn một chút" is advice that cannot possibly work.
   */
  | { kind: "no-signal" }
  /** The take could not be stored. The turn is unaffected. */
  | { kind: "store-error"; notice: RecordingNotice };

export interface UseTurnRecorder {
  /**
   * Ask for the microphone and start capturing. Resolves to `null` on success
   * or to the failure that stopped it — the caller turns that into a notice
   * and into `blockMic`, because both are session decisions, not hook ones.
   */
  start(): Promise<CaptureFailure | null>;
  /** Stop capturing and turn the chunks into a stored take. */
  stop(turnIndex: number): Promise<CaptureOutcome>;
  /**
   * Throw the capture away without producing a take: tear the graph down, stop
   * the stream, drop the chunks.
   *
   * Three real cases, all of them "the session stopped wanting this capture":
   * "Kết thúc buổi" or "Luyện lại" pressed while recording — both set
   * `phase: "idle"`, so the stop button disappears and nothing else would ever
   * close the stream — and `start()` resolving onto a session that has already
   * moved on while the permission prompt was open.
   */
  cancel(): void;
  /** Play one take, or stop it if it is the one already sounding. */
  playTake(key: string): void;
  /**
   * Silence take **playback**. It does not touch the microphone — `cancel()`
   * does that. The old name (`stopTake`) read at every call site as "stop the
   * recording", which is how "Kết thúc buổi" came to leave a live capture
   * running.
   */
  stopTakePlayback(): void;
  /** The take currently sounding, by key, or `null`. */
  playingKey: string | null;
  /**
   * The one transient notice channel for everything about recording: a capture
   * failure, a silence-only take, a failed write, a vanished blob.
   *
   * It lives in the hook rather than in the screen because `playTake` is
   * fire-and-forget and cannot return one — and two notice channels for the
   * same strip of screen is how a message ends up rendered twice.
   */
  notice: RecordingNotice | null;
  /** `noticeKey` changes with every notice, so the same message shown twice
   *  still re-announces itself in the live region. */
  noticeKey: number;
  showNotice(notice: RecordingNotice): void;
  dismissNotice(): void;
  /** Drop every take of this session. Fire-and-forget. */
  clearTakes(): void;
}

export function useTurnRecorder(entryId: string): UseTurnRecorder {
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<RecordingNotice | null>(null);
  /** Bumped with every notice so an identical message shown twice still
   *  re-announces itself to a screen reader. */
  const [noticeKey, setNoticeKey] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const chunksRef = useRef<Int16Array[]>([]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  /** A resolution carrying a stale token has been superseded: it must clean up
   *  after itself rather than start audio nothing will ever stop. */
  const playToken = useRef(0);
  const mounted = useRef(true);
  /** An in-flight namespace sweep, awaited before the next write. */
  const clearing = useRef<Promise<void> | null>(null);

  /**
   * Tear the capture graph down. Safe to call at any point, including halfway
   * through construction — which is exactly when it matters, since a rejected
   * worklet load leaves a live microphone behind otherwise.
   */
  const teardownCapture = useCallback(() => {
    nodeRef.current?.port.close();
    nodeRef.current?.disconnect();
    nodeRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const ctx = ctxRef.current;
    ctxRef.current = null;
    // `close()` rejects if the context is already closed; nothing to do about
    // it and nothing to tell the user.
    void ctx?.close().catch(() => {});
  }, []);

  /**
   * Release the audio element and its object URL.
   *
   * Split from `stopTakePlayback` so it can run *without* a `setState` — the
   * unmount path must not touch React state, and playback that ends naturally
   * needs the URL revoked without pretending someone pressed stop.
   */
  const releasePlayback = useCallback(() => {
    playToken.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const stopTakePlayback = useCallback(() => {
    releasePlayback();
    setPlayingKey(null);
  }, [releasePlayback]);

  // Unmount: stop the microphone, stop playback, release the last URL. The lab
  // page has none of this, so navigating away mid-capture leaves the recording
  // indicator lit until the tab is closed.
  //
  // Both halves are the *same* functions the rest of the hook uses — the one
  // place correctness matters most is not the place to keep a second copy of
  // the teardown sequence. Both are `useCallback([])`, so this still runs once.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      releasePlayback();
      teardownCapture();
    };
  }, [releasePlayback, teardownCapture]);

  const start = useCallback(async (): Promise<CaptureFailure | null> => {
    // Whatever a previous attempt left behind goes first: two live streams
    // would both feed the same chunk array.
    teardownCapture();
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // `ideal`, not an exact value: an exact `channelCount: 1` makes the
          // browser raise `OverconstrainedError` on hardware that only offers
          // stereo, and the user would be told to go and find a microphone
          // because of a constraint *we* asked for.
          channelCount: { ideal: 1 },
          echoCancellation: true,
          noiseSuppression: true,
          // Deliberately **off**. AGC normalises the level, which is exactly
          // what `peakLevel`/`isPeakTooLow` measure — with it on, a take from
          // the wrong input is boosted to a healthy peak and the low-signal
          // diagnostic this story ships can never fire.
          autoGainControl: false,
        },
      });
      // Resolved after the component went away: nothing is left to tear this
      // down, so tear it down here rather than leave the recording indicator
      // lit until the tab closes.
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return null;
      }
      streamRef.current = stream;

      // 16 kHz is asked for here rather than resampled afterwards — there is
      // no resampling code in this app, the browser does it.
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      ctxRef.current = ctx;
      await ctx.audioWorklet.addModule("/audio-processor.worklet.js");
      // iOS and Safari hand back a *suspended* context. The worklet then never
      // runs, no chunk ever arrives, and every take looks like silence.
      if (ctx.state === "suspended") await ctx.resume();

      if (!mounted.current) {
        teardownCapture();
        return null;
      }

      const node = new AudioWorkletNode(ctx, "audio-capture-processor");
      nodeRef.current = node;
      node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (event.data?.byteLength) {
          chunksRef.current.push(new Int16Array(event.data));
        }
      };

      // Through a silent gain node so the graph is guaranteed to be pulled: a
      // worklet with no path to the destination is not required by spec to run.
      const silent = new GainNode(ctx, { gain: 0 });
      node.connect(silent);
      silent.connect(ctx.destination);
      ctx.createMediaStreamSource(stream).connect(node);

      return null;
    } catch (error) {
      // The leak the lab page has: one catch for getUserMedia, the
      // AudioContext and the worklet, with no teardown of whatever did
      // succeed. A rejected `addModule` leaves the microphone open.
      teardownCapture();
      chunksRef.current = [];
      return classifyCaptureError(error);
    }
  }, [teardownCapture]);

  const stop = useCallback(
    async (turnIndex: number): Promise<CaptureOutcome> => {
      const raw = chunksRef.current;
      chunksRef.current = [];
      teardownCapture();

      // Not one sample arrived — the graph never ran. A different fault from a
      // quiet learner, and it gets a different answer.
      if (totalSamples(raw) === 0) return { kind: "no-signal" };

      const trimmed = trimSilence(raw);
      // Nothing but silence. Not stored: an empty WAV is not a take, and the
      // caller says so in words rather than offering a dead play control.
      if (trimmed.length === 0) return { kind: "empty" };

      // A `deleteNamespace` cursor from the session start may still be running.
      // Storing into it is a race the learner loses silently: the blob is
      // written and then swept away, leaving a chip that plays nothing.
      await clearing.current;

      const key = recordingKey(entryId, turnIndex);
      const result = await storeTake(
        namespacedBlobStore(RECORDING_NAMESPACE),
        key,
        encodeWav(trimmed)
      );
      if (!result.ok) return { kind: "store-error", notice: result.notice };

      return {
        kind: "take",
        take: {
          key,
          durationMs: durationMs(trimmed),
          peak: peakLevel(trimmed),
        },
      };
    },
    [entryId, teardownCapture]
  );

  const cancel = useCallback(() => {
    chunksRef.current = [];
    teardownCapture();
  }, [teardownCapture]);

  const playTake = useCallback(
    (key: string) => {
      // Tapping the take that is sounding stops it rather than restarting it —
      // the same toggle `useSampleAudio.play` has, for the same reason.
      if (playingKey === key) {
        stopTakePlayback();
        return;
      }

      stopTakePlayback();
      const token = playToken.current;

      void (async () => {
        const blob = await loadTake(
          namespacedBlobStore(RECORDING_NAMESPACE),
          key
        );

        if (token !== playToken.current || !mounted.current) return;

        if (!blob) {
          // Cleared in another tab, or evicted. Say so; the turn is unaffected
          // and still advances.
          setNotice(MISSING_TAKE_NOTICE);
          setNoticeKey((n) => n + 1);
          return;
        }

        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;

        const clear = () => {
          if (token !== playToken.current) return;
          // Playback is over — release the element and revoke the URL here too,
          // not only when someone presses stop. Otherwise every take listened
          // to all the way through leaks its object URL until the next play.
          audio.pause();
          audioRef.current = null;
          if (objectUrlRef.current === url) {
            URL.revokeObjectURL(url);
            objectUrlRef.current = null;
          }
          setPlayingKey(null);
        };
        audio.onended = clear;
        audio.onerror = clear;

        setPlayingKey(key);
        await audio.play().catch(clear);
      })();
    },
    [playingKey, stopTakePlayback]
  );

  const clearTakes = useCallback(() => {
    stopTakePlayback();
    // Fire-and-forget *to the caller*, but tracked here: `stop()` awaits this
    // before writing, so a sweep still running cannot delete the new session's
    // first take. `clearRecordings` swallows its own rejection, so this promise
    // never rejects and needs no `.catch`.
    // `namespacedBlobStore(RECORDING_NAMESPACE)` is the only store handed over,
    // so `"tts"` is out of reach by construction.
    clearing.current = clearRecordings(
      namespacedBlobStore(RECORDING_NAMESPACE)
    );
  }, [stopTakePlayback]);

  const showNotice = useCallback((next: RecordingNotice) => {
    setNotice(next);
    setNoticeKey((n) => n + 1);
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    start,
    stop,
    cancel,
    playTake,
    stopTakePlayback,
    playingKey,
    notice,
    noticeKey,
    showNotice,
    dismissNotice,
    clearTakes,
  };
}
