"use client";

import { useCallback, useEffect, useRef } from "react";
import { namespacedBlobStore } from "@/lib/blob-store";
import { RECORDING_NAMESPACE, loadTake, type RecordingNotice } from "@/lib/recording";
import {
  assessTurn,
  claimDisclosure as claimDisclosureRule,
  classifyScoringOutcome,
  parseAssessment,
  scoringPlan,
  type ScoringFailure,
  type ScoringPlan,
  type TurnAssessment,
} from "@/lib/pronunciation";

/**
 * Deliberately looser than the route's own 15s (`PROVIDER_TIMEOUT_MS`), the
 * same 20s `useSampleAudio` uses against `/api/tts` and for the same reason:
 * the server's message is specific ("Dịch vụ chấm không phản hồi trong 15s")
 * and the client's is generic, so the server has to win the race.
 */
const CLIENT_TIMEOUT_MS = 20_000;

export type ScoreOutcome =
  | { kind: "scored"; assessment: TurnAssessment; latencyMs: number }
  | { kind: "failed"; failure: ScoringFailure }
  /** Azure heard no speech. Not a failure of the service, and not a verdict. */
  | { kind: "no-speech" }
  /** The route's own byte cap fired where the millisecond cap did not. Nothing
   *  is wrong; the clip was too big to send, which is what `too-long` says. */
  | { kind: "too-long" }
  /** Superseded by a re-record, a session end, or an unmount. The caller must
   *  write nothing: the turn it belonged to may no longer exist. */
  | { kind: "aborted" };

export interface UseTurnScorer {
  /**
   * What happens to this take *before* anything is sent — the clip-length
   * guard and, on the send branch, the once-per-session disclosure that comes
   * with it.
   *
   * The ordering lives in `scoringPlan` (`lib/pronunciation.ts`) where it is
   * testable. This wrapper only supplies the flag; it deliberately does **not**
   * commit it — see `score()`, which claims the disclosure once the take is
   * known to exist. So `plan()` may be called freely, and its `notice` on the
   * `send` branch is a preview the caller must not show: `score()` emits the
   * real one through `onDisclose`.
   */
  plan(durationMs: number): ScoringPlan;
  /**
   * Score one take. Aborts whatever was already in flight — there is only ever
   * one turn being scored, and a stale answer landing on a fresh take would
   * hang last attempt's verdict under this one.
   *
   * `onDisclose` is called synchronously, at most once per session, in the
   * instant before the audio leaves the device. It is a callback rather than
   * part of the resolved value because the resolved value arrives seconds
   * later — and telling someone their voice *was* uploaded is not a
   * disclosure.
   */
  score(
    takeKey: string,
    referenceText: string,
    targetWords: readonly string[],
    onDisclose: (notice: RecordingNotice) => void
  ): Promise<ScoreOutcome>;
  /** Abandon any request in flight. Safe to call at any time. */
  cancel(): void;
  /** A new session has started; the next request discloses again. */
  resetDisclosure(): void;
}

export function useTurnScorer(): UseTurnScorer {
  const controller = useRef<AbortController | null>(null);
  const disclosed = useRef(false);
  const mounted = useRef(true);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      controller.current = null;
    };
  }, []);

  const plan = useCallback(
    (durationMs: number): ScoringPlan => scoringPlan(durationMs, disclosed.current),
    []
  );

  const resetDisclosure = useCallback(() => {
    disclosed.current = false;
  }, []);

  const score = useCallback(
    async (
      takeKey: string,
      referenceText: string,
      targetWords: readonly string[],
      onDisclose: (notice: RecordingNotice) => void
    ): Promise<ScoreOutcome> => {
      cancel();
      const abort = new AbortController();
      controller.current = abort;
      const superseded = () => controller.current !== abort || !mounted.current;
      // Started before the blob read on purpose: a stalled IndexedDB is one
      // more way for this never to answer, and the timer is the only thing
      // that ends that. Everything below it is inside the `try`, so no path
      // out of here can leave `controller.current` pointing at a request that
      // has already finished — the early `no-audio` return used to.
      const timer = setTimeout(() => abort.abort(), CLIENT_TIMEOUT_MS);

      try {
        // The recorder's `stop()` returns only `{ key, durationMs, peak }` and
        // discards the trimmed samples, so the WAV is re-read from the same
        // namespace it was written to. Already silence-trimmed: assessment is
        // billed per second, and trimming is what `lib/wav.ts` did before the
        // blob was ever stored.
        const blob = await loadTake(
          namespacedBlobStore(RECORDING_NAMESPACE),
          takeKey
        );
        if (superseded()) return { kind: "aborted" };
        if (!blob) return { kind: "failed", failure: "no-audio" };

        // Only now, with a blob in hand and the request one statement away.
        // Claiming it earlier spends the session's one privacy notice on a
        // take that never uploads — the learner reads the disclosure, nothing
        // leaves, and the *real* first upload goes out silently.
        // The rule itself is pure and tested (`claimDisclosure`); the hook
        // only holds the flag between calls.
        const claim = claimDisclosureRule(disclosed.current);
        disclosed.current = claim.disclosed;
        if (claim.notice) onDisclose(claim.notice);

        const form = new FormData();
        form.append("audio", blob, "take.wav");
        form.append("referenceText", referenceText);
        form.append("provider", "azure");

        const startedAt = Date.now();
        const res = await fetch("/api/pronunciation", {
          method: "POST",
          body: form,
          signal: abort.signal,
        });
        if (superseded()) return { kind: "aborted" };

        if (!res.ok) {
          const outcome = classifyScoringOutcome(res.status);
          return outcome.kind === "too-long"
            ? { kind: "too-long" }
            : { kind: "failed", failure: outcome.failure };
        }

        let data: { latencyMs?: number; raw?: unknown };
        try {
          data = (await res.json()) as { latencyMs?: number; raw?: unknown };
        } catch (error) {
          // A 200 whose body never finished arriving, or is not JSON at all.
          // The connection was fine — it answered — so "có vẻ mất mạng" would
          // send the learner to check their wifi over our own broken payload.
          if (superseded()) return { kind: "aborted" };
          // Unless it is *our* abort: a re-record cancels, and the client
          // timeout firing mid-body is a timeout. Both are the outer handler's
          // to classify — swallowing them here as "unreadable" would blame the
          // response for a request we ended ourselves.
          if (abort.signal.aborted) throw error;
          return { kind: "failed", failure: "unreadable" };
        }
        if (superseded()) return { kind: "aborted" };

        // 200 with nothing recognised. Azure worked; there was no speech in
        // the take to score. Reported as itself, never as a service fault.
        const status = recognitionStatus(data?.raw);
        if (
          status === "NoMatch" ||
          status === "InitialSilenceTimeout" ||
          status === "BabbleTimeout"
        ) {
          return { kind: "no-speech" };
        }

        const words = parseAssessment(data?.raw);
        // A 200 that carries no per-phoneme scores is not a verdict. Azure
        // silently degrades to `Basic` without `Dimension: "Comprehensive"`,
        // and Basic answers 200 with the phoneme block gone — so this is a
        // real response shape, not a defensive branch.
        if (words.length === 0) {
          return { kind: "failed", failure: "unreadable" };
        }

        return {
          kind: "scored",
          assessment: assessTurn(words, targetWords),
          // The card prints this as a measured time, so it has to be one. A
          // response that carries no usable `latencyMs` falls back to the
          // round trip measured here — wider than the server's number by the
          // network, but true — instead of the `0` that used to render as a
          // confident "0.0s".
          latencyMs:
            typeof data?.latencyMs === "number" && Number.isFinite(data.latencyMs)
              ? data.latencyMs
              : Math.max(0, Date.now() - startedAt),
        };
      } catch (error) {
        // An abort we caused is not a failure to report — the turn it belonged
        // to has been re-recorded or has gone away.
        if (superseded()) return { kind: "aborted" };
        const outcome = classifyScoringOutcome(null, error);
        return outcome.kind === "too-long"
          ? { kind: "too-long" }
          : { kind: "failed", failure: outcome.failure };
      } finally {
        clearTimeout(timer);
        // Only the *current* request may clear the pointer. A superseded one
        // finishing late would otherwise drop the handle on the take that
        // replaced it, and `cancel()` would have nothing left to abort.
        if (controller.current === abort) controller.current = null;
      }
    },
    [cancel]
  );

  return { plan, score, cancel, resetDisclosure };
}

/** `RecognitionStatus` of a raw Azure response, or `""` when it is not there. */
function recognitionStatus(raw: unknown): string {
  const value = (raw as { RecognitionStatus?: unknown } | null | undefined)
    ?.RecognitionStatus;
  return typeof value === "string" ? value : "";
}
