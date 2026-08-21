"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DialogueScript } from "@/lib/dialogue/types";
import { namespacedBlobStore } from "@/lib/blob-store";
import {
  SAMPLE_AUDIO_NAMESPACE,
  SampleAudioProviderError,
  generateSampleAudio,
  initialStatuses,
  pendingRequests,
  sampleAudioPayload,
  sampleAudioRequests,
  type SampleAudioRequest,
  type SampleAudioStatus,
} from "@/lib/sample-audio";

/**
 * Native sample audio for a script: generated once in the background, then
 * played from storage forever.
 *
 * The script must be readable the instant it arrives, so nothing here blocks
 * rendering — Gemini already costs 5–15s and a dozen sequential Azure calls on
 * top would push a generation past half a minute. Turns light up one by one.
 *
 * All the decisions live in `lib/sample-audio.ts`, which is testable in the
 * node environment. This hook is transport, React state and an `<audio>`
 * element: it fetches through `/api/tts` (never Azure directly — the key stays
 * server-side) and stores through `lib/blob-store.ts`.
 *
 * **Generation is driven only from here.** Nothing resumes it: navigating away
 * mid-run leaves the remaining lines unsynthesised until the script is shown
 * again.
 */

/**
 * Longer than the route's own 15s, on purpose: when Azure hangs we want the
 * server's specific 504 to arrive rather than the browser aborting first and
 * leaving the user with a generic failure.
 */
const CLIENT_TIMEOUT_MS = 20_000;

async function fetchSampleAudio(request: SampleAudioRequest): Promise<Blob> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sampleAudioPayload(request)),
    // Without this a hung connection stalls the sequential loop forever: this
    // turn spins and every later turn stays queued, with nothing to show for
    // it. A timeout is just another per-line failure.
    signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
  });

  if (!res.ok) {
    // 503 (no credential) and 401 (credential rejected) are true of the whole
    // script. Throwing them away as `TTS 503` costs twelve pointless round
    // trips and shows twelve identical warnings that never name the cause.
    const message = await res
      .json()
      .then((body: { error?: unknown }) =>
        typeof body?.error === "string" ? body.error : ""
      )
      .catch(() => "");
    if (res.status === 503 || res.status === 401) {
      throw new SampleAudioProviderError(
        message || "Không dùng được dịch vụ giọng đọc."
      );
    }
    throw new Error(message || `TTS ${res.status}`);
  }

  const blob = await res.blob();
  if (blob.size === 0) throw new Error("TTS trả về audio rỗng.");
  return blob;
}

export interface UseSampleAudio {
  /** Per-turn generation state, keyed by `DialogueTurn.index`. */
  statuses: Record<number, SampleAudioStatus>;
  /** The turn currently sounding, or `null`. */
  playingTurn: number | null;
  /** Play one turn's sample from storage — or stop it if it is the one
   *  currently sounding. No network call, ever. */
  play(turnIndex: number): void;
  /**
   * The one Vietnamese notice, or `null`. Set at most once per script: whether
   * the disk is full or Azure is unreachable, it will not have changed by the
   * next line.
   */
  notice: string | null;
}

/** Everything that belongs to one script, so a script change resets it all. */
interface ScriptState {
  script: DialogueScript | null;
  statuses: Record<number, SampleAudioStatus>;
  playingTurn: number | null;
  notice: string | null;
}

const FRESH = {
  statuses: {} as Record<number, SampleAudioStatus>,
  playingTurn: null,
  notice: null,
} as const;

export function useSampleAudio(script: DialogueScript | null): UseSampleAudio {
  const [state, setState] = useState<ScriptState>({ script: null, ...FRESH });

  /**
   * Derived, not reset in an effect.
   *
   * The generation effect only learns the new script after two `await`s. In
   * that window a stale `statuses` would show turn *n* of the new script with
   * the old script's state — and `play(n)` would fetch the old script's blob,
   * so the learner hears the wrong line. Deriving on script identity closes
   * the window at render time instead of one tick later, and does it without a
   * synchronous `setState` inside an effect body.
   */
  const active: ScriptState =
    state.script === script ? state : { script, ...FRESH };

  /**
   * Turn index → content key, tagged with the script it was computed from, so
   * `play` can tell "not ready yet" from "ready, here is the key" rather than
   * reaching into the previous script's map.
   */
  const keyMap = useRef<{
    script: DialogueScript | null;
    keys: Record<number, string>;
  }>({ script: null, keys: {} });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  /** Bumped on every play/stop. A resolution carrying a stale token has been
   *  superseded and must clean up after itself instead of taking over. */
  const playToken = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!script) return;

    let cancelled = false;
    const store = namespacedBlobStore(SAMPLE_AUDIO_NAMESPACE);

    /** Merge into this script's state, never into its successor's. */
    const update = (patch: Partial<Omit<ScriptState, "script">>) => {
      if (cancelled) return;
      setState((prev) => {
        const base = prev.script === script ? prev : { script, ...FRESH };
        return { ...base, ...patch };
      });
    };

    const markTurns = (request: SampleAudioRequest, status: SampleAudioStatus) => {
      if (cancelled) return;
      setState((prev) => {
        const base = prev.script === script ? prev : { script, ...FRESH };
        const statuses = { ...base.statuses };
        for (const index of request.turnIndexes) statuses[index] = status;
        return { ...base, statuses };
      });
    };

    // Deliberately not awaited in the effect body: the script renders now and
    // this fills in behind it.
    void (async () => {
      try {
        const requests = await sampleAudioRequests(script);
        if (cancelled) return;

        const keys: Record<number, string> = {};
        for (const request of requests) {
          for (const index of request.turnIndexes) keys[index] = request.key;
        }
        keyMap.current = { script, keys };

        const pending = await pendingRequests(requests, store);
        if (cancelled) return;

        // Everything already in storage is playable immediately, without a
        // single request — this is what makes reopening a script free.
        update({ statuses: initialStatuses(requests, pending) });

        await generateSampleAudio(
          pending,
          store,
          fetchSampleAudio,
          {
            onStatus: markTurns,
            onHalt: (_reason, message) => update({ notice: message }),
          },
          () => !cancelled
        );
      } catch (err) {
        // `sampleAudioRequests` rejects when `crypto.subtle` is missing — an
        // insecure origin, i.e. anything but localhost or https. Unguarded
        // that is an unhandled rejection and every turn sits at `idle` with no
        // explanation at all.
        if (cancelled) return;
        console.warn("Sample audio generation failed to start", err);
        update({
          notice:
            "Không tạo được giọng mẫu trong trình duyệt này. Kịch bản vẫn dùng bình thường, bạn chỉ không nghe được phần đọc mẫu.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [script]);

  /** Stop whatever is sounding and release its URL. */
  const stopAudio = useCallback(() => {
    playToken.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  // Release the last object URL when the component goes away.
  useEffect(() => stopAudio, [stopAudio]);

  const play = useCallback(
    (turnIndex: number) => {
      const map = keyMap.current;
      // The new script's keys are not computed yet — better nothing than the
      // previous script's audio.
      if (map.script !== script) return;
      const key = map.keys[turnIndex];
      if (!key) return;

      // Clicking the turn that is sounding stops it rather than restarting it.
      if (active.playingTurn === turnIndex) {
        stopAudio();
        setState((prev) =>
          prev.script === script ? { ...prev, playingTurn: null } : prev
        );
        return;
      }

      stopAudio();
      const token = playToken.current;

      void (async () => {
        const blob = await namespacedBlobStore(SAMPLE_AUDIO_NAMESPACE)
          .get(key)
          .catch(() => undefined);

        // Superseded by a later click, or the component is gone. Either way
        // this resolution must not start audio nothing will ever stop.
        if (token !== playToken.current || !mounted.current) return;

        if (!blob) {
          // A "ready" turn whose blob has vanished is a failed turn, not a
          // dead button.
          setState((prev) =>
            prev.script === script
              ? { ...prev, statuses: { ...prev.statuses, [turnIndex]: "failed" } }
              : prev
          );
          return;
        }

        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;

        const clear = () => {
          if (token !== playToken.current) return;
          setState((prev) =>
            prev.script === script ? { ...prev, playingTurn: null } : prev
          );
        };
        audio.onended = clear;
        audio.onerror = clear;

        setState((prev) => {
          const base = prev.script === script ? prev : { script, ...FRESH };
          return { ...base, playingTurn: turnIndex };
        });

        await audio.play().catch(clear);
      })();
    },
    [script, active.playingTurn, stopAudio]
  );

  return {
    statuses: active.statuses,
    playingTurn: active.playingTurn,
    play,
    notice: active.notice,
  };
}
