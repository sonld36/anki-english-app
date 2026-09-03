"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { HistoryEntry } from "@/lib/history";
import { SPEAKER_LABELS, turnHasHints } from "@/lib/dialogue/types";
import { renderHighlightedHtml } from "@/lib/dialogue/words";
import { useSampleAudio } from "@/hooks/useSampleAudio";
import { useTurnRecorder } from "@/hooks/useTurnRecorder";
import {
  CAPTURE_FAILURE_NOTICES,
  EMPTY_TAKE_NOTICE,
  NO_SIGNAL_NOTICE,
  isPermanentCaptureFailure,
  peakWarning,
} from "@/lib/recording";
import {
  advanceDelayMs,
  audioNote,
  audioTurnToPlay,
  beginScoring,
  blockMic,
  blockTake,
  canContinue,
  cancelRecording,
  clockBasis,
  completeCurrentTurn,
  completeScoring,
  createSession,
  currentTurnIndex,
  endSession,
  failScoring,
  finishRecording,
  hintAvailable,
  hintDepth,
  isPracticable,
  micAction,
  micEnabled,
  openHint,
  sampleReplayUnlocked,
  skipScoring,
  takeReplayUnlocked,
  sessionSummary,
  shouldStopPlayback,
  startRecording,
  startSession,
  turnPlan,
  visibleTurnViews,
  type MicAction,
  type SessionState,
} from "@/lib/session";
import { useTurnScorer } from "@/hooks/useTurnScorer";
import {
  SCORING_DISCLOSURE,
  scoreCard,
  type ChipLevel,
  type ScoreCard,
  type ScoreChip,
} from "@/lib/pronunciation";
import type { TurnTake } from "@/lib/session";

/**
 * The turn-by-turn practice screen — the surface Stories 2.2–2.7 bolt onto.
 *
 * A thin renderer over `lib/session.ts`. Everything that is an *invariant* of
 * this story lives there, because `vitest` has no DOM and this file can only be
 * verified by hand: which turn's audio may sound (`audioTurnToPlay`), how long
 * until a turn advances (`advanceDelayMs`), when playback must be silenced
 * (`shouldStopPlayback`), and what may be rendered (`TurnView`). What is left
 * here is React plumbing.
 *
 * Story 2.2 adds the recording loop, and with it the rule that the mic no
 * longer means "next": `micAction` decides what the button is, "Tiếp" lives in
 * the turn bubble, and the take + the native sample get a play control each
 * once a take exists. The control row still holds exactly three slots.
 *
 * Story 2.3 adds the score card: the take goes to `/api/pronunciation` the
 * moment it is stored, the card mounts under that turn in a pending state, and
 * it fills in when the verdict lands. It is a **fourth projection**
 * (`scoreCard` in `lib/pronunciation.ts`), so `TurnView` is untouched and the
 * learner's line is still never rendered as text — the card names the turn's
 * own target words and the specific words that scored badly, bounded so they
 * can never add up to the line. Nothing about scoring gates the session:
 * "Tiếp" is open before the request leaves and stays open however it ends.
 *
 * What it does **not** do is as load-bearing as what it does. No hint content,
 * no attempt limit, no latency metric, no end-of-session summary — those are
 * 2.4–2.7.
 */

/** One column of the control row, so nothing shifts between states. */
const CONTROL_SLOT = 96;
const MIC_SIZE = 52;

/**
 * Three states, three glyphs. `disabled` must not borrow `record`'s: the
 * disabled state IS the turn indicator (DESIGN.md rules out a separate badge),
 * so it needs a cue that survives greyscale — the dashed border and the dimmed
 * fill are cues, but the glyph should not quietly claim to be one while being
 * identical. `⋯` is the same "waiting" idiom the learner bubble uses.
 */
const MIC_GLYPH: Record<MicAction, string> = {
  record: "🎤",
  stop: "⏹",
  disabled: "⋯",
};

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * What a chip says out loud.
 *
 * The glyph is `aria-hidden` (it is a decorative duplicate of the colour and
 * the border), so without this a screen reader reads `cold /d/ 10` — three
 * facts and no verdict, which is the state-by-colour-alone failure DESIGN.md
 * and AGENTS.md both forbid. The number gets a name here too: a bare `10` next
 * to a word is not a score to anyone who cannot see the chip it sits in.
 */
const CHIP_LEVEL_TEXT: Record<ChipLevel, string> = {
  ok: "đạt",
  warn: "cần chú ý",
  bad: "chưa đạt",
};

function chipSpeech(chip: ScoreChip): string {
  const parts = [CHIP_LEVEL_TEXT[chip.level]];
  if (chip.phoneme) parts.push(`âm ${chip.phoneme}`);
  parts.push(
    chip.score === null ? "chưa nghe ra" : `điểm ${chip.score} trên 100`
  );
  return `: ${parts.join(", ")}.`;
}

/**
 * The one line the card announces.
 *
 * The card is **not** its own live region: it sits inside the transcript's
 * `role="log" aria-live="polite"`, and a nested one meant the whole card —
 * verdict, every chip, both finding lists — was read out again on
 * `pending → scored`, and once more each time the `<details>` opened. The card
 * subtree is muted with `aria-live="off"` and this short summary is the only
 * thing that speaks; everything else is still there to be read at leisure.
 */
function cardSpeech(card: ScoreCard): string {
  if (card.state === "pending") return "Đang chấm phát âm.";
  const needsWork = card.chips.filter((chip) => chip.level !== "ok").length;
  const tail = needsWork > 0 ? ` ${needsWork} từ mục tiêu cần sửa, xem chi tiết bên dưới.` : "";
  return `Kết quả chấm phát âm: ${card.label}.${tail}`;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function SessionView({ entry }: { entry: HistoryEntry }) {
  const router = useRouter();

  /**
   * Referentially stable, and it has to be: `useSampleAudio` keys statuses,
   * the content-key map and `play` on script *object identity*. A fresh object
   * per render would reset every status and make `play` a permanent no-op —
   * silently, since nothing throws.
   */
  const script = useMemo(
    () => (isPracticable(entry.script) ? entry.script : null),
    [entry.script]
  );

  const sampleAudio = useSampleAudio(script);
  const recorder = useTurnRecorder(entry.id);
  const scorer = useTurnScorer();
  /**
   * Pulled out because they are stable `useCallback`s while the object around
   * them is rebuilt every render: depending on `recorder` itself would rebuild
   * `advance` and re-run the cleanup effect on every clock tick.
   */
  const { stopTakePlayback, clearTakes, cancel: cancelCapture } = recorder;
  /** Same reason as the recorder's: stable `useCallback`s on a rebuilt object. */
  const { cancel: cancelScoring, resetDisclosure } = scorer;
  /** Stable, and a real stop rather than `play`'s toggle — see `stopPlayback`. */
  const stopSample = sampleAudio.stop;
  const [session, setSession] = useState<SessionState>(createSession);
  const [nowMs, setNowMs] = useState(() => Date.now());
  /**
   * The turn whose native sample the learner deliberately asked to hear again.
   *
   * Without it the playback reaper silences every replay the instant it
   * starts: a scrolled-back turn is not the turn on screen, which is exactly
   * the condition `shouldStopPlayback` exists to catch.
   */
  const [replayTurn, setReplayTurn] = useState<number | null>(null);
  /** A `getUserMedia` request is in flight. Not state: nothing renders from it. */
  const micBusy = useRef(false);

  const cursor = currentTurnIndex(script, session);
  const currentTurn = cursor === null ? null : script?.turns[cursor] ?? null;
  const audioStatus =
    cursor === null ? "idle" : sampleAudio.statuses[cursor] ?? "idle";
  const plan = currentTurn ? turnPlan(currentTurn, audioStatus) : null;

  // Primitives, not the plan object: an object identity changes every render
  // and would restart the advance timer on each tick of the clock.
  const awaitPlayback = plan?.awaitPlayback ?? false;
  const minDwellMs = plan?.minDwellMs ?? 0;
  const fallbackMs = plan?.fallbackMs ?? null;

  const playingTurn = sampleAudio.playingTurn;
  const turnStartedAt = session.turnStartedAt;
  const isSounding = playingTurn !== null && playingTurn === cursor;

  const views = visibleTurnViews(script, session);
  const summary = sessionSummary(script, session);
  /** Three controls in one circle — record, stop, inert. Decided in the tested
   *  module so "tap to start, tap again to stop" cannot drift. */
  const mic = micAction(script, session);
  const isRecording = session.phase === "recording";
  /**
   * The mic's accessible name — and, when it is disabled, the *only* thing that
   * says why.
   *
   * "Chưa tới lượt bạn" is a lie when it *is* the learner's turn and the mic is
   * inert because the browser refused it. The disabled state is the only turn
   * indicator this screen has (DESIGN.md rules out a separate badge), so it
   * must not report the wrong reason.
   */
  const micLabel =
    mic === "stop"
      ? "Đang ghi: bấm để dừng"
      : mic === "record"
        ? "Micro đang mở: bấm để ghi câu của bạn"
        : micEnabled(script, session)
          ? "Micro không dùng được: bấm Tiếp để sang lượt sau"
          : "Micro đang tắt: chưa tới lượt bạn";

  /**
   * The decision of *which* turn may sound — made in the tested module, not
   * here. It is `null` on every learner turn, so no edit to this file can hand
   * `play` a learner index: their line has a blob too (Story 1.4 synthesises
   * both roles), and playing it would reveal the whole sentence aloud.
   */
  const audioTurn = audioTurnToPlay(script, session, audioStatus);

  /**
   * The hint slot — decided in the tested module, same implicit-cursor style
   * as `micAction`: it only ever acts on `session.cursor`, never a turn index
   * the screen picks itself.
   */
  const canOpenHint = hintAvailable(script, session);
  const currentHintDepth = cursor === null ? "none" : hintDepth(session, cursor);
  const currentTurnHasLadder = currentTurn ? turnHasHints(currentTurn) : false;
  /**
   * The only thing that says why the slot is inert — a system turn, no
   * ladder for this turn (a v2 script, or a learner turn Gemini generated
   * without hints), or a ladder already opened all the way. Mirrors
   * `micLabel`: a disabled control must say why, not just refuse.
   */
  const hintLabel = !currentTurn
    ? "Thang gợi ý: chưa có lượt nào để gợi ý"
    : currentTurn.speaker === "system"
      ? "Thang gợi ý: chỉ dùng được ở lượt của bạn"
      : !currentTurnHasLadder
        ? "Lượt này không có gợi ý"
        : currentHintDepth === "keywords"
          ? "Đã mở hết gợi ý cho lượt này"
          : currentHintDepth === "situation"
            ? "Xem từ khoá gợi ý"
            : "Xem gợi ý tình huống";

  /**
   * The latest committed values, so callbacks can read them without becoming
   * effect dependencies. `useSampleAudio`'s `play` is rebuilt whenever
   * `playingTurn` changes; depending on it directly would re-trigger playback
   * on every change. (`stop` is stable and is used directly.)
   */
  const live = useRef({
    play: sampleAudio.play,
    playingTurn,
    cursor,
    status: session.status,
    phase: session.phase,
    replayTurn,
  });

  /**
   * Silence whatever is sounding.
   *
   * `useSampleAudio` exposes no `stop()`; `play(playingTurn)` on the turn that
   * is *already* sounding is the documented toggle-off. Reading `playingTurn`
   * from the ref matters — calling `play` on anything else would **start** that
   * line instead of stopping this one.
   */
  const stopPlayback = useCallback(() => {
    // `useSampleAudio.stop()`, not `play(playingTurn)`. The toggle only works
    // when `playingTurn` has already been set — and it is set *after* an async
    // IndexedDB read, so a line tapped a beat before the mic tap is still
    // `null` here and the toggle no-ops, letting the native reading of the
    // learner's own line bleed into the start of their take. `stop()` bumps the
    // play token, so a read still in flight is superseded and never sounds.
    stopSample();
    setReplayTurn(null);
  }, [stopSample]);

  const advance = useCallback(() => {
    // Nothing from the turn being left behind may still be audible over the
    // next one — least of all a system line playing across the learner's turn.
    stopPlayback();
    stopTakePlayback();
    setSession((prev) => completeCurrentTurn(script, prev, Date.now()));
  }, [script, stopPlayback, stopTakePlayback]);

  const advanceRef = useRef(advance);

  useEffect(() => {
    advanceRef.current = advance;
    live.current = {
      play: sampleAudio.play,
      playingTurn,
      cursor,
      status: session.status,
      phase: session.phase,
      replayTurn,
    };
  });

  // Sound a system line when its turn comes up — or the moment its audio
  // finishes generating, if the turn is already on screen.
  useEffect(() => {
    if (audioTurn === null) return;
    live.current.play(audioTurn);
  }, [audioTurn]);

  /**
   * Silence anything that outlived its turn.
   *
   * Three real cases, one rule: "Kết thúc buổi" pressed mid-line; the mic
   * advancing off a system turn that is still speaking; and — the subtle one —
   * `play` setting `playingTurn` only *after* an async read from IndexedDB, so
   * a line can start sounding a beat after the fallback timer already moved the
   * session on, and then talk over the learner.
   */
  useEffect(() => {
    const context = { replayTurn, phase: session.phase };
    if (!shouldStopPlayback(playingTurn, cursor, session.status, context)) return;
    // Deferred by a tick on purpose: `play()` calls `setState`, and calling it
    // straight from an effect body is the `react-hooks/set-state-in-effect`
    // error this story must not add a fourth of.
    const id = setTimeout(() => {
      const s = live.current;
      const now = { replayTurn: s.replayTurn, phase: s.phase };
      if (!shouldStopPlayback(s.playingTurn, s.cursor, s.status, now)) return;
      stopPlayback();
    }, 0);
    return () => clearTimeout(id);
  }, [playingTurn, cursor, session.status, session.phase, replayTurn, stopPlayback]);

  /**
   * Did playback for the turn on screen ever start? A rejected `audio.play()`
   * is swallowed by the hook, so "we asked it to play" proves nothing.
   */
  const playback = useRef<{ turn: number | null; started: boolean }>({
    turn: null,
    started: false,
  });

  useEffect(() => {
    if (cursor === null || turnStartedAt === null) return;

    if (playback.current.turn !== cursor) {
      playback.current = { turn: cursor, started: false };
    }
    if (isSounding) playback.current.started = true;

    const delay = advanceDelayMs({
      awaitPlayback,
      isSounding,
      playbackStarted: playback.current.started,
      minDwellMs,
      fallbackMs,
      elapsedMs: Date.now() - turnStartedAt,
      isRecording,
    });
    // `null` means schedule nothing: a learner turn (only "Tiếp" ends it), a
    // line still sounding (this effect re-runs when it stops), or a live
    // capture that no timer may cut short.
    if (delay === null) return;

    // Deliberately a timer and not a synchronous advance — same lint rule.
    const id = setTimeout(() => advanceRef.current(), delay);
    return () => clearTimeout(id);
  }, [
    cursor,
    turnStartedAt,
    isSounding,
    awaitPlayback,
    minDwellMs,
    fallbackMs,
    isRecording,
  ]);

  // The clock. Counts up; no limit, no countdown, nothing happens at any mark.
  // While capture is live it measures the take rather than the turn — that is
  // the number the learner is watching.
  useEffect(() => {
    if (session.status !== "running") return;
    const id = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(id);
  }, [session.status]);

  const clock = clockBasis(session);
  const elapsedMs =
    clock.startedAt === null ? 0 : Math.max(0, nowMs - clock.startedAt);

  /**
   * The takes live exactly as long as the session does.
   *
   * Watching `finished` rather than clearing inside "Kết thúc buổi" catches
   * the other way a session ends — walking off the last turn — which no
   * gesture of the user's marks. Deferred by a tick for the usual reason:
   * `clearTakes` calls `setState`, and an effect body may not.
   *
   * It is a stable `useCallback`, so this runs once per transition rather than
   * once per render.
   *
   */
  const sessionFinished = session.status === "finished";
  useEffect(() => {
    if (!sessionFinished) return;
    const id = setTimeout(() => clearTakes(), 0);
    return () => clearTimeout(id);
  }, [sessionFinished, clearTakes]);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.cursor, session.status]);

  // Both gestures silence audio first. Without it "Luyện lại" calls `play(0)`
  // while turn 0 is still the sounding turn — and `play` *toggles*, so the
  // restart would stop turn 0 instead of starting it, and the session would
  // open in silence.
  // Starting also drops every take: the `recordings` namespace is scratch space
  // for exactly one session, and a reload mid-session orphans blobs that
  // nothing else would ever collect. `"tts"` is untouched — the store handed
  // over is the recordings namespace and nothing else, so the sample audio the
  // user has already paid Azure for survives every session boundary.
  // Ending is handled by the `sessionFinished` effect above, which also catches
  // a session that simply runs out of turns.
  /**
   * Both gestures end a capture that is still running.
   *
   * `endSession`/`startSession` set `phase: "idle"`, so the stop button
   * disappears — and without `cancel()` the MediaStream and AudioContext stay
   * live behind it, with the browser's recording indicator lit and nothing left
   * that can turn it off. `stopTakePlayback` only silences *playback*.
   */
  const endCapture = useCallback(() => {
    if (session.phase === "recording") cancelCapture();
  }, [session.phase, cancelCapture]);

  const handleStart = () => {
    stopPlayback();
    endCapture();
    clearTakes();
    // A request in flight belongs to a take that is about to be deleted, and
    // the new session must disclose again before its first upload.
    cancelScoring();
    resetDisclosure();
    setSession((prev) => startSession(script, Date.now(), prev));
  };
  const handleEnd = () => {
    stopPlayback();
    endCapture();
    stopTakePlayback();
    // Nothing is left to score: the blobs go with the session.
    cancelScoring();
    setSession((prev) => endSession(prev));
  };

  /**
   * Send the take just stored for scoring.
   *
   * Everything it decides is decided elsewhere: `scoringPlan` is the cost guard
   * *and* NFR-10's once-per-session ordering (the clip length is checked before
   * the disclosure is claimed, so a take that never leaves the device cannot
   * spend it), and the verdict is `lib/pronunciation.ts`'s. `beginScoring`
   * lands **before** the request leaves, so the card mounts in its worded
   * pending state the instant the mic stops; "Tiếp" is already open by then and
   * never waits on any of this.
   */
  const startScoringTurn = async (index: number, take: TurnTake) => {
    const turn = script?.turns[index];
    if (!turn) return;

    const plan = scorer.plan(take.durationMs);
    if (plan.kind === "skip") {
      // The cost guard the epic assigns to this story. Nothing is sent and
      // nothing is truncated — a verdict on the first 30s of a 90s take would
      // be a verdict on a different recording.
      //
      // `plan.notice` is deliberately **not** shown: `scoreCard`'s `too-long`
      // detail is the same sentence, so showing both put one message on two
      // surfaces in the same instant. The card carries it, because it is
      // anchored to the turn it is about and does not vanish with the next
      // notice.
      setSession((prev) => skipScoring(prev, index, take.durationMs));
      return;
    }

    setSession((prev) => beginScoring(prev, index));

    const outcome = await scorer.score(
      take.key,
      turn.text,
      turn.targetWords,
      // Before the audio leaves the device, never after — and only once the
      // blob is known to exist. Telling someone their voice has been uploaded
      // is not a disclosure, and spending the notice on an upload that never
      // happened leaves the real first one silent.
      (notice) => recorder.showNotice(notice)
    );
    // Superseded by a re-record, a restart or an unmount: the turn this
    // belonged to may not be the turn that is there now.
    if (outcome.kind === "aborted") return;
    if (outcome.kind === "too-long") {
      // The route's byte cap fired where the millisecond cap did not. Same
      // state, same single surface as the plan's own skip.
      setSession((prev) => skipScoring(prev, index, take.durationMs));
      return;
    }
    if (outcome.kind === "no-speech") {
      // Azure worked and heard nothing to score. `ScoringFailure` carries its
      // own member for exactly this, so the card says what happened rather
      // than "chấm hỏng" — one surface, the card, like every other outcome.
      setSession((prev) => failScoring(prev, index, "no-speech"));
      return;
    }
    if (outcome.kind === "failed") {
      setSession((prev) => failScoring(prev, index, outcome.failure));
      return;
    }
    setSession((prev) =>
      completeScoring(prev, index, outcome.assessment, outcome.latencyMs)
    );
  };

  /**
   * The mic, all three of it.
   *
   * `record` → stop everything audible first (a native sample playing into a
   * live microphone would land in the take), ask for the device, and only stamp
   * the session once capture is actually running. A failure is said once; only
   * a denial or a genuinely absent device makes the mic inert for good, and
   * either way the exit opens so the session is never stranded.
   *
   * `stop` → trim, store, and stay on the turn. Only "Tiếp" leaves it.
   */
  const handleMic = async () => {
    if (mic === "disabled") return;
    // Both branches await, and both are re-entrant without this. On `record`
    // the permission prompt can stay open for seconds while the button still
    // reads "record"; on `stop` the IndexedDB write is a window in which a
    // second tap finds `chunksRef` already drained, reports "empty", and
    // orphans a take that in fact succeeded.
    if (micBusy.current) return;

    if (mic === "record") {
      const index = cursor;
      if (index === null) return;
      micBusy.current = true;
      stopPlayback();
      stopTakePlayback();
      // `startRecording` drops this turn's score along with its take; this
      // drops the request that would have written a new one onto the take
      // being replaced.
      cancelScoring();
      // Everything except NFR-10's disclosure. It is said once per session and
      // the flag is already spent, so dismissing it because the learner tapped
      // the mic again a second later would mean this session never shows it —
      // the one notice that is not allowed to be missed.
      if (recorder.notice !== SCORING_DISCLOSURE) recorder.dismissNotice();
      let failure;
      try {
        failure = await recorder.start();
      } finally {
        micBusy.current = false;
      }
      if (failure) {
        recorder.showNotice(CAPTURE_FAILURE_NOTICES[failure]);
        // A denial or an absent device is permanent — the mic goes inert and
        // stays that way. A busy device or a one-off worklet fetch is worth
        // another tap, so only the exit opens.
        setSession((prev) =>
          isPermanentCaptureFailure(failure) ? blockMic(prev) : blockTake(prev)
        );
        return;
      }
      // The session moved on while the prompt was open — "Kết thúc buổi", or a
      // navigation. Throw the capture away rather than leaving a live
      // microphone with nothing left to stop it.
      const now = live.current;
      if (now.status !== "running" || now.cursor !== index) {
        recorder.cancel();
        return;
      }
      setSession((prev) => startRecording(prev, Date.now()));
      return;
    }

    // `stop`. The index is read before the await: nothing can advance the turn
    // mid-capture, but reading it afterwards would still be a latent bug.
    const index = cursor;
    if (index === null) return;
    micBusy.current = true;
    let outcome;
    try {
      outcome = await recorder.stop(index);
    } finally {
      micBusy.current = false;
    }
    // The trim and the IndexedDB write are awaited, and "Kết thúc buổi" is one
    // tap away throughout. `finishRecording` no-ops off `phase: "recording"`,
    // but scoring would not: it would upload a take of a session that is over
    // and mount a pending card under a finished transcript.
    const after = live.current;
    const stillThisTurn = after.status === "running" && after.cursor === index;
    if (outcome.kind === "take") {
      setSession((prev) => finishRecording(prev, outcome.take));
      if (stillThisTurn) void startScoringTurn(index, outcome.take);
      return;
    }
    if (!stillThisTurn) return;
    if (outcome.kind === "empty") {
      // Samples arrived and none of them was speech. Nothing is wrong with the
      // machinery, so the turn simply resets and the mic is offered again.
      setSession((prev) => cancelRecording(prev));
      recorder.showNotice(EMPTY_TAKE_NOTICE);
      return;
    }
    // `no-signal` (the graph delivered nothing) or `store-error` (the disk).
    // Neither is the learner's doing and neither may be fixed by trying harder,
    // so the exit opens — otherwise a full quota dead-ends the session while
    // the notice promises it will not.
    setSession((prev) => blockTake(prev));
    recorder.showNotice(
      outcome.kind === "no-signal" ? NO_SIGNAL_NOTICE : outcome.notice
    );
  };

  /**
   * Open the next rung of the current turn's hint ladder. No network call —
   * the content is already on `script.turns[i].hints` — and no-op past
   * `hintAvailable`, so a stray extra tap on an already-open ladder is safe.
   */
  const handleHint = () => {
    setSession((prev) => openHint(script, prev));
  };

  /** Replay the learner's own take. Local, unlimited, zero network. */
  const handlePlayTake = (key: string) => {
    stopPlayback();
    recorder.playTake(key);
  };

  /**
   * Replay the native reading of a turn.
   *
   * `setReplayTurn` first: it is what tells the playback reaper this is a
   * deliberate replay of a turn that is no longer current, rather than a stale
   * autoplay to be silenced.
   */
  const handlePlaySample = (index: number) => {
    stopTakePlayback();
    if (playingTurn === index) {
      setReplayTurn(null);
      sampleAudio.play(index);
      return;
    }
    setReplayTurn(index);
    sampleAudio.play(index);
  };

  // ------------------------------------------------------------------
  // A pre-Story-1.2 entry has no turns to walk. Say so, and hand the user
  // the screen that can still open it — not a crash and not a blank page.
  // ------------------------------------------------------------------
  if (!script) {
    return (
      <main className="session-screen" style={shell}>
        <div style={emptyState}>
          <div style={{ fontSize: "2.5rem" }} aria-hidden="true">
            📄
          </div>
          <h2 style={{ fontWeight: 700, color: "var(--ink-primary)" }}>
            Kịch bản cũ, chưa diễn được theo lượt
          </h2>
          <p style={{ fontSize: "14px", color: "var(--ink-secondary)", maxWidth: "32ch" }}>
            Bản ghi này được lưu trước khi kịch bản có cấu trúc từng lượt, nên
            buổi luyện theo lượt không mở được. Bạn vẫn xem lại được bằng màn
            hình luyện tập cũ.
          </p>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", justifyContent: "center" }}>
            <button
              onClick={() => router.push(`/practice?id=${entry.id}`)}
              style={primaryButton}
            >
              Mở bằng màn hình cũ
            </button>
            <button onClick={() => router.push("/")} style={ghostButton}>
              ← Về trang chủ
            </button>
          </div>
        </div>
      </main>
    );
  }

  const statusLabel =
    session.status === "idle"
      ? "Chưa bắt đầu"
      : session.status === "running"
        ? "Đang diễn"
        : "Đã kết thúc";

  return (
    <main className="session-screen" style={shell}>
      {/* Status strip */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "var(--space-3) var(--space-4)",
          borderBottom: "1px solid var(--border-hairline)",
          background: "var(--surface-raised)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => router.push("/")}
          style={ghostButton}
          aria-label="Về trang chủ"
        >
          ←
        </button>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: "14px",
              fontWeight: 600,
              color: "var(--ink-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {entry.deckName}
          </div>
          <div style={{ fontSize: "12px", color: "var(--ink-muted)" }}>
            {statusLabel} · {summary.completedTurns}/{summary.totalTurns} lượt
          </div>
        </div>

        <button onClick={handleEnd} style={ghostButton}>
          Kết thúc buổi
        </button>
      </header>

      {sampleAudio.notice && (
        <p
          role="status"
          style={{
            margin: 0,
            padding: "var(--space-2) var(--space-4)",
            fontSize: "12px",
            color: "var(--warning)",
            background: "var(--surface-sunken)",
            borderBottom: "1px solid var(--border-hairline)",
            flexShrink: 0,
          }}
        >
          ⚠ {sampleAudio.notice}
        </p>
      )}

      {/* Everything about recording says its piece here, once: a denied
          permission, a missing device, a silence-only take, a failed write, a
          vanished blob. `key` changes with every notice so the same message
          twice still re-announces itself. */}
      {/* The live region is the wrapper and is **always** in the DOM: several
          screen readers only announce mutations inside a region that already
          existed, so a container mounted together with its first message is
          silent. The inner node keeps `key={noticeKey}`, so replacing one
          notice with an identical one is still a mutation inside a region that
          was already there. */}
      <div role="status" aria-live="polite" style={{ flexShrink: 0 }}>
        {recorder.notice && (
          <p
            key={recorder.noticeKey}
            className={`session-notice-bar session-notice-bar--${recorder.notice.tone}`}
          >
            <span aria-hidden="true">{recorder.notice.glyph}</span>
            <span style={{ flex: 1 }}>{recorder.notice.text}</span>
            <button
              type="button"
              className="session-notice-dismiss"
              onClick={recorder.dismissNotice}
              aria-label="Đóng thông báo"
            >
              ✕
            </button>
          </p>
        )}
      </div>

      {/* Chat flow */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "var(--space-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        {session.status === "idle" && (
          <div style={card}>
            <div style={{ fontSize: "1.75rem" }} aria-hidden="true">
              🎧
            </div>
            <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--ink-primary)" }}>
              Sẵn sàng luyện
            </h2>
            <p style={{ fontSize: "14px", color: "var(--ink-secondary)", lineHeight: 1.6 }}>
              {SPEAKER_LABELS.system} đọc lượt của mình, bạn nghe và đọc theo dõi.
              Đến lượt bạn, nút mic mở ra — bấm để ghi, bấm lần nữa để dừng, rồi
              nghe lại bản ghi của bạn cạnh giọng mẫu. Xong thì bấm Tiếp.
            </p>
            <p style={{ fontSize: "13px", color: "var(--ink-muted)", lineHeight: 1.6 }}>
              Câu của bạn không hiện trên màn hình. Đó là phần bạn phải tự bật ra.
              Bản ghi nằm trên máy bạn và bị xoá khi buổi luyện kết thúc; để chấm
              phát âm, nó được gửi tới dịch vụ Microsoft Azure.
            </p>
            <button onClick={handleStart} style={primaryButton}>
              ▶ Bắt đầu buổi
            </button>
          </div>
        )}

        {/* A live region, so a screen reader hears the session move: each new
            line, and the learner's own turn arriving, are announced as they are
            added. `additions` only — the clock and the audio note change too
            often to be worth reading out. */}
        <div
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="Lượt hội thoại"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          {views.map((view) => {
            const isSystem = view.speaker === "system";
            const isCurrent = cursor === view.index;
            const turnStatus = sampleAudio.statuses[view.index] ?? "idle";
            const sounding = playingTurn === view.index;
            const note = isSystem ? audioNote(turnStatus, sounding) : null;
            // The tested predicate, not `view.take`: it is also what closes the
            // control while capture is live, so an earlier take cannot play
            // into an open microphone. Reading `view.take` here left those
            // tests guarding nothing that shipped.
            const takeUnlocked = takeReplayUnlocked(session, view.index);
            const take = takeUnlocked ? view.take : null;
            // The narrowed reveal rule, from the tested module: the native
            // reading of the learner's own line unlocks only once a take of it
            // exists. Their line is still never rendered as text.
            const sampleUnlocked =
              !isSystem &&
              sampleReplayUnlocked(script, session, view.index, turnStatus);
            const takeSounding = take !== null && recorder.playingKey === take.key;
            const lowSignal = take ? peakWarning(take.peak) : null;
            // The **fourth projection**. It is handed the learner's line so it
            // can bound what it names against it, and returns words only — the
            // turn's own target words plus the specific words that scored
            // badly, never a run of the line. `TurnView.text` stays `null`
            // throughout: nothing below renders `turn.text`.
            const turn = script.turns[view.index];
            const card: ScoreCard | null = isSystem
              ? null
              : scoreCard(
                  session.scores[view.index],
                  turn?.targetWords ?? [],
                  turn?.text ?? ""
                );
            // Depth is UI/session state, not content — it lives on
            // `session.hints`, not on `TurnView`. `turn.hints` is only read
            // once a rung is actually open, and it exists whenever that is
            // true: `openHint` only ever advances past `"none"` when
            // `hintAvailable` already found a usable ladder.
            const openDepth = isSystem ? "none" : hintDepth(session, view.index);
            const hints = openDepth !== "none" ? turn?.hints : undefined;
            // `turnHasHints` only requires one non-blank keyword, not that
            // every entry is — and the hint validator's own keyword check is
            // non-fatal, so a blank or repeated entry can ship. Filtered and
            // deduped here rather than trusted from the model, the same way
            // `namedWords`/`createNamer` never trust raw model text as-is.
            const keywordChips =
              openDepth === "keywords" && hints
                ? Array.from(
                    new Set(hints.keywords.map((k) => k.trim()).filter(Boolean))
                  )
                : [];

            return (
              <div
                key={view.index}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: isSystem ? "flex-start" : "flex-end",
                  gap: "var(--space-1)",
                }}
              >
                <span
                  style={{
                    fontSize: "12px",
                    color: "var(--ink-muted)",
                    padding: "0 var(--space-1)",
                  }}
                >
                  {isSystem ? SPEAKER_LABELS.system : "Bạn"}
                </span>

                <div
                  // The one class this screen uses: `renderHighlightedHtml`
                  // emits a fixed `.word-highlight`, so tinting target words
                  // with `--chrome` needs a scoped rule in globals.css.
                  className="session-bubble"
                  style={{
                    maxWidth: "min(88%, 46ch)",
                    padding: "var(--space-3) var(--space-4)",
                    fontSize: "16px",
                    lineHeight: 1.6,
                    background: isSystem
                      ? "var(--surface-raised)"
                      : "var(--surface-sunken)",
                    color: isSystem ? "var(--ink-primary)" : "var(--ink-secondary)",
                    border: "1px solid var(--border-hairline)",
                    // The speaker's own corner is tightened — the familiar cue
                    // that tells the two roles apart without another label.
                    borderRadius: isSystem
                      ? "var(--space-1) var(--radius-md) var(--radius-md) var(--radius-md)"
                      : "var(--radius-md) var(--space-1) var(--radius-md) var(--radius-md)",
                  }}
                >
                  {isSystem && view.text !== null ? (
                    <span
                      // The document is `lang="vi"`. Without this a screen
                      // reader reads the English line with a Vietnamese voice —
                      // in an app whose whole point is pronunciation.
                      lang="en"
                      // `TurnView.text` is `null` on a learner turn, so this
                      // branch is unreachable for their line by construction.
                      dangerouslySetInnerHTML={{
                        __html: renderHighlightedHtml(view.text, view.targetWords),
                      }}
                    />
                  ) : (
                    <span style={{ fontStyle: "italic" }}>
                      {isCurrent && isRecording
                        ? "··· đang ghi lượt của bạn"
                        : isCurrent
                          ? "··· lượt của bạn — nói ra thành tiếng"
                          : "··· lượt của bạn"}
                    </span>
                  )}
                </div>

                {/* The hint ladder, per this turn's own recorded depth — not
                    just the current one, so scrolling back to a turn whose
                    hints were opened still shows both rungs. Fixed order,
                    situation then keywords, and never the line itself: these
                    render exactly what `turn.hints` already carries,
                    unmodified. Read-only chips (`.session-hint-chip`), unlike
                    the interactive `.session-chip` controls below.

                    The glyph+text caption is the same convention as every
                    other label in this screen (the speaker tag above the
                    bubble, the mic's accessible name): without it, a bare
                    chip reading e.g. "Khi bạn chào lại" says nothing about
                    what it is, for a sighted or screen-reader user alike. */}
                {hints && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-1)",
                      padding: "0 var(--space-1)",
                    }}
                  >
                    <span style={{ fontSize: "12px", color: "var(--ink-muted)" }}>
                      <span aria-hidden="true">💡</span> Gợi ý
                    </span>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "var(--space-2)",
                      }}
                    >
                      <span className="session-hint-chip" lang="vi">
                        {hints.situation}
                      </span>
                      {keywordChips.map((keyword) => (
                        <span key={keyword} className="session-hint-chip" lang="en">
                          {keyword}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* The take, and the model beside it. Both are local reads —
                    replay costs nothing, calls nothing and is unlimited, which
                    is the whole point of keeping the WAV on the device.
                    The sample control only exists once a take does. */}
                {!isSystem && (take || sampleUnlocked) && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "var(--space-2)",
                      padding: "0 var(--space-1)",
                    }}
                  >
                    {take && (
                      <button
                        type="button"
                        className="session-chip"
                        onClick={() => handlePlayTake(take.key)}
                        aria-label={
                          takeSounding
                            ? "Dừng phát bản ghi của bạn"
                            : `Nghe lại bản ghi của bạn, dài ${formatSeconds(take.durationMs)}`
                        }
                      >
                        <span aria-hidden="true">{takeSounding ? "⏹" : "▶"}</span>{" "}
                        Bản ghi của bạn{" "}
                        <span style={{ color: "var(--ink-muted)", fontVariantNumeric: "tabular-nums" }}>
                          {formatSeconds(take.durationMs)}
                        </span>
                      </button>
                    )}
                    {sampleUnlocked && (
                      <button
                        type="button"
                        className="session-chip"
                        onClick={() => handlePlaySample(view.index)}
                        aria-label={
                          sounding
                            ? "Dừng phát giọng mẫu"
                            : "Nghe giọng mẫu bản ngữ của câu này"
                        }
                      >
                        <span aria-hidden="true">{sounding ? "⏹" : "▶"}</span>{" "}
                        Giọng mẫu
                      </button>
                    )}
                  </div>
                )}

                {/* A signal diagnostic, never an excuse for a result: the take
                    is kept and playable either way. Glyph + words + a dashed
                    border, per DESIGN.md's warning tier. */}
                {lowSignal && (
                  <span
                    className={`session-note session-note--${lowSignal.tone}`}
                    role="status"
                  >
                    <span aria-hidden="true">{lowSignal.glyph}</span> {lowSignal.text}
                  </span>
                )}

                {/* The score card, stuck under the turn just spoken — never a
                    separate screen. The verdict is a word (`Đạt` / `Chưa đạt`)
                    as well as a glyph and a colour: no state by colour alone.

                    `aria-live="off"` mutes the subtree from the transcript's
                    `role="log" aria-live="polite"` above. Without it the whole
                    card is re-announced on `pending → scored` and again every
                    time the `<details>` opens; the one-line summary below is
                    what speaks instead, and the rest stays readable at
                    leisure. */}
                {card && (
                  <div
                    className={`session-score session-score--${card.tone}`}
                    aria-live="off"
                  >
                    <p className="session-score__sr" role="status" aria-live="polite">
                      {cardSpeech(card)}
                    </p>
                    <div className="session-score__verdict">
                      <span aria-hidden="true" className="session-score__glyph">
                        {card.glyph}
                      </span>
                      <span className="session-score__label">{card.label}</span>
                      {/* Two different quantities, and only ever one of them:
                          how long *scoring* took, and how long the *take* was.
                          The second is labelled, because an unlabelled `41.2s`
                          in the slot every other card fills with its latency
                          reads as a latency. */}
                      {card.latencySeconds && (
                        <span className="session-score__time">
                          <span aria-hidden="true">{card.latencySeconds}</span>
                          <span className="session-score__sr">
                            Chấm xong sau {card.latencySeconds}.
                          </span>
                        </span>
                      )}
                      {card.clipSeconds && (
                        <span className="session-score__time">
                          Bản ghi {card.clipSeconds}
                        </span>
                      )}
                    </div>

                    {card.detail && (
                      <p className="session-score__detail">{card.detail}</p>
                    )}

                    {card.chips.length > 0 && (
                      <ul className="session-score__chips">
                        {card.chips.map((chip) => (
                          <li
                            key={chip.word}
                            className={`session-score__chip session-score__chip--${chip.level}`}
                          >
                            {/* The glyph, the IPA and the number are the
                                *visual* form of the chip's state. A screen
                                reader gets the same three facts as words in
                                `chipSpeech` — `cold /d/ 10` on its own says
                                nothing about pass or fail, which is the
                                colour-alone failure AGENTS.md forbids. */}
                            <span aria-hidden="true">{chip.glyph}</span>{" "}
                            <span lang="en">{chip.word}</span>
                            {chip.phoneme && (
                              <span className="session-score__ipa" aria-hidden="true">
                                /{chip.phoneme}/
                              </span>
                            )}
                            {chip.score !== null && (
                              <span className="session-score__num" aria-hidden="true">
                                {chip.score}
                              </span>
                            )}
                            <span className="session-score__sr">
                              {chipSpeech(chip)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {card.tier2.length > 0 && (
                      <ul className="session-score__findings">
                        {card.tier2.map((finding, i) => (
                          <li
                            key={`${finding.word}-${finding.phoneme}-${i}`}
                            className="session-score__finding"
                          >
                            <span aria-hidden="true">{finding.glyph}</span>{" "}
                            {finding.text}
                          </li>
                        ))}
                      </ul>
                    )}

                    {card.tier3.length > 0 && (
                      <details className="session-score__more">
                        <summary>Chi tiết ({card.tier3.length})</summary>
                        <ul className="session-score__findings">
                          {card.tier3.map((finding, i) => (
                            <li
                              key={`${finding.word}-${finding.phoneme}-${i}`}
                              className="session-score__finding"
                            >
                              <span aria-hidden="true">{finding.glyph}</span>{" "}
                              {finding.text}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}

                {/* "Tiếp" belongs to the bubble, not to the control row — the
                    row keeps its three fixed slots in every state. It is what
                    ends a learner turn now that the mic does not. */}
                {isCurrent && canContinue(script, session) && (
                  <button
                    type="button"
                    onClick={advance}
                    style={continueButton}
                    aria-label="Tiếp: sang lượt kế tiếp"
                  >
                    Tiếp <span aria-hidden="true">→</span>
                  </button>
                )}

                {/* Why this line is (or is not) speaking. `idle`/`fetching`
                    used to render nothing at all, so a script opened from
                    history — which routinely outruns its own sequential
                    synthesis — was silent with no explanation. Saying so does
                    not gate the turn: it still advances on the clock. */}
                {isCurrent && note && (
                  <span
                    style={{
                      fontSize: "12px",
                      color:
                        note.tone === "warning"
                          ? "var(--warning)"
                          : "var(--ink-muted)",
                      padding: "0 var(--space-1)",
                    }}
                  >
                    <span aria-hidden="true">{note.glyph}</span> {note.text}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {session.status === "finished" && (
          <div style={card}>
            <div style={{ fontSize: "1.5rem" }} aria-hidden="true">
              ✓
            </div>
            <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--ink-primary)" }}>
              Buổi luyện đã kết thúc
            </h2>
            <p style={{ fontSize: "14px", color: "var(--ink-secondary)", lineHeight: 1.6 }}>
              Bạn đi qua {summary.completedTurns}/{summary.totalTurns} lượt, trong
              đó {summary.learnerTurnsCompleted} lượt là của bạn.
            </p>
            <p
              style={{
                fontSize: "13px",
                color: "var(--ink-muted)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              Tổng thời gian {formatClock(summary.totalElapsedMs)}
            </p>
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", justifyContent: "center" }}>
              <button onClick={handleStart} style={primaryButton}>
                Luyện lại
              </button>
              <button onClick={() => router.push("/")} style={ghostButton}>
                ← Về trang chủ
              </button>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Control row — the three slots hold their positions in every state, and
          the screen owns the viewport (see `body:has(.session-screen)` in
          globals.css) so this never scrolls away. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
          padding: "var(--space-3) var(--space-4)",
          // Works because `app/layout.tsx` exports `viewportFit: "cover"`;
          // without it the inset resolves to 0 and this is inert.
          paddingBottom: "max(var(--space-3), env(safe-area-inset-bottom))",
          borderTop: "1px solid var(--border-hairline)",
          background: "var(--surface-raised)",
          flexShrink: 0,
        }}
      >
        {/* Hint slot. Fixed order, no skipping: one tap reveals `situation`,
            the next reveals `keywords`, and a third tap on an already-open
            ladder does nothing — `canOpenHint` already says `false` by then,
            same as `hintAvailable`. No network call: the content is already
            on `script.turns[i].hints`.

            `aria-disabled` rather than `disabled`, same reasoning as the mic
            button below: this is the control the learner has just pressed,
            and a real `disabled` on the focused element drops focus to
            `<body>`. */}
        <div style={{ width: CONTROL_SLOT, display: "flex", justifyContent: "flex-start" }}>
          <button
            type="button"
            onClick={handleHint}
            aria-disabled={!canOpenHint}
            title={hintLabel}
            aria-label={hintLabel}
            style={{
              ...ghostButton,
              borderStyle: canOpenHint ? "solid" : "dashed",
              color: canOpenHint ? "var(--ink-secondary)" : "var(--ink-muted)",
              cursor: canOpenHint ? "pointer" : "not-allowed",
              opacity: canOpenHint ? 1 : 0.6,
            }}
          >
            💡 Gợi ý
          </button>
        </div>

        <div
          style={{
            flex: 1,
            textAlign: "center",
            fontSize: "20px",
            fontWeight: 600,
            color: "var(--chrome)",
            fontVariantNumeric: "tabular-nums",
          }}
          role="timer"
          aria-label={
            clock.mode === "recording"
              ? `Đang ghi: ${formatClock(elapsedMs)}`
              : `Thời gian lượt này: ${formatClock(elapsedMs)}`
          }
        >
          {formatClock(elapsedMs)}
        </div>

        <div style={{ width: CONTROL_SLOT, display: "flex", justifyContent: "flex-end" }}>
          {/* The disabled state IS the "chưa tới lượt bạn" signal — DESIGN.md
              rules out a separate turn badge. So it must not be carried by
              colour alone: the shape changes (solid fill vs dashed outline),
              the glyph changes with `micAction`, the accessible name says it in
              words, and `aria-disabled` says it semantically.

              `aria-disabled` rather than `disabled`: this is the button the
              learner has just pressed, and a real `disabled` on the focused
              element drops focus to `<body>`, so a keyboard user re-tabs from
              the top of the page every single turn. It stays focusable and
              inert.

              Tap to start, tap again to stop — one `onClick`, never a
              `mousedown`/`mouseup` pair. Press-and-hold is ruled out. */}
          <button
            type="button"
            className={
              mic === "stop" ? "session-mic session-mic--recording" : "session-mic"
            }
            onClick={() => {
              void handleMic();
            }}
            aria-disabled={mic === "disabled"}
            // Omitted while disabled: `aria-pressed={false}` announces "toggle
            // button, not pressed", where the whole message of this state is
            // "chưa tới lượt bạn".
            aria-pressed={mic === "disabled" ? undefined : mic === "stop"}
            aria-label={micLabel}
            title={micLabel}
            style={{
              width: MIC_SIZE,
              height: MIC_SIZE,
              borderRadius: "var(--radius-full)",
              fontSize: "22px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: mic === "disabled" ? "transparent" : "var(--chrome)",
              color:
                mic === "disabled" ? "var(--ink-muted)" : "var(--surface-base)",
              border:
                mic === "disabled"
                  ? "2px dashed var(--border-hairline)"
                  : "2px solid var(--chrome)",
              cursor: mic === "disabled" ? "not-allowed" : "pointer",
              opacity: mic === "disabled" ? 0.55 : 1,
              transition: "background 0.15s ease, opacity 0.15s ease",
            }}
          >
            <span aria-hidden="true">{MIC_GLYPH[mic]}</span>
          </button>
        </div>
      </div>
    </main>
  );
}

// --- styles -------------------------------------------------------------
// Inline objects and CSS variables, per the house convention: `tailwindcss` is
// installed but unused in components, and every colour here goes through the
// new token layer rather than the legacy `--bg-*/--accent-*` variables.

const shell: React.CSSProperties = {
  height: "100dvh",
  display: "flex",
  flexDirection: "column",
  background: "var(--surface-base)",
  color: "var(--ink-primary)",
  fontFamily: "var(--font-sans)",
};

const emptyState: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  gap: "var(--space-4)",
  padding: "var(--space-6) var(--space-5)",
};

const card: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  gap: "var(--space-3)",
  padding: "var(--space-5)",
  background: "var(--surface-raised)",
  border: "1px solid var(--border-hairline)",
  borderRadius: "var(--radius-lg)",
};

const primaryButton: React.CSSProperties = {
  padding: "var(--space-3) var(--space-5)",
  fontSize: "14px",
  fontWeight: 600,
  fontFamily: "inherit",
  color: "var(--surface-base)",
  background: "var(--chrome)",
  border: "1px solid var(--chrome)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};

/** The exit from a learner turn, now that the mic no longer is one. */
const continueButton: React.CSSProperties = {
  alignSelf: "flex-end",
  padding: "var(--space-2) var(--space-4)",
  fontSize: "13px",
  fontWeight: 600,
  fontFamily: "inherit",
  color: "var(--surface-base)",
  background: "var(--chrome)",
  border: "1px solid var(--chrome)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};

const ghostButton: React.CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  fontSize: "13px",
  fontFamily: "inherit",
  color: "var(--ink-secondary)",
  background: "transparent",
  border: "1px solid var(--border-hairline)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
