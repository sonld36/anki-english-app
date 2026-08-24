// The turn-by-turn practice session: status, cursor, per-turn stats, and the
// decision of what advances a turn.
//
// Deliberately pure — no React, no DOM, no storage. `vitest.config.mts` runs in
// `environment: "node"` and there is no jsdom, so a `.test.tsx` is collected and
// then fails for want of a DOM. Story 1.4 answered the same wall with
// `lib/sample-audio.ts`: the decisions live in a module the node suite can
// reach, and the browser wrapper (`components/SessionView.tsx`) stays thin.
//
// The claim this module exists to pin is not the cursor arithmetic — it is that
// **no projection here ever carries a learner turn's text**. That is a rule a
// test can hold; eyeballing a screen is not.
//
// Story 2.2 narrows that rule rather than breaking it. The learner's line is
// still never *shown*, in any state; what changes is that once a take of it
// exists, the learner may *hear* the native reading of it beside their own —
// which is the whole point of recording. That unlock is a **second, distinct
// projection** (`sampleReplayUnlocked`), so `audioTurnToPlay` keeps returning
// `null` unconditionally for learner turns and the existing leak tests keep
// meaning exactly what they say.
//
// Story 2.3 narrows it once more, the same way. The score card has to name
// target words to be worth anything, so it is a **fourth, separate
// projection** (`scoreCard` in `lib/pronunciation.ts`) rather than a flag on
// `TurnView` — which keeps `text: null` and `targetWords: []` untouched, so the
// three leak invariants below (`TurnView`, `audioTurnToPlay`,
// `sampleReplayUnlocked`) keep meaning exactly what they say. What the card may
// name is bounded against the line by `MIN_LEAKED_CONTENT_WORDS`.
//
// Nothing here is persisted — not the takes, and **not the scores**. In-memory
// for one session, exactly as Stories 2.1 and 2.2 promise; a reload discards
// it. Takes go further: they live in the `recordings` blob namespace for the
// length of one session and are dropped when it ends or restarts. Scores are
// not, because there is no blob to collect and the finished screen still shows
// the turns they belong to.

import type {
  DialogueScript,
  DialogueTurn,
  Speaker,
} from "./dialogue/types";
import type { HistoryEntry } from "./history";
import type { SampleAudioStatus } from "./sample-audio";
import type {
  ScoringFailure,
  TurnAssessment,
  TurnScore,
} from "./pronunciation";

/**
 * Which entry `/session?id=…` is about, decided over a list rather than over
 * `localStorage` — `lib/history.ts` has no `getById`, and the node suite has no
 * `localStorage` either, so the lookup lives here where it can be tested.
 *
 * A missing `id` and an unknown `id` deliberately collapse to the same `null`:
 * both mean "there is no session to run", and the screen owes the user the same
 * explicit state either way rather than two near-identical dead ends.
 */
export function findEntry(
  entries: readonly HistoryEntry[],
  id: string | null | undefined
): HistoryEntry | null {
  if (!id) return null;
  return entries.find((entry) => entry.id === id) ?? null;
}

/** `idle` = waiting for the start gesture; `finished` = nothing left to say. */
export type SessionStatus = "idle" | "running" | "finished";

/**
 * Where the turn on screen is in the record-and-listen loop.
 *
 * This is what makes the mic stop meaning "next". In Story 2.1 one tap both
 * ended the turn and advanced it; a take has to be *listened to*, so the turn
 * has to survive the tap. `recorded` is the state that did not exist before:
 * the turn is still on screen, the take is playable, and only "Tiếp" moves on.
 *
 * It also leaves room for Story 2.3's score card and Story 2.5's retry to
 * attach without moving the control row.
 */
export type TurnPhase = "idle" | "recording" | "recorded";

/**
 * A take of one turn, as everything outside the recorder needs to know it.
 *
 * `key` addresses the blob in the `recordings` namespace — positional, never a
 * content hash (see `lib/recording.ts`). `peak` rides along so the low-signal
 * warning is derived where it is rendered instead of being remembered as one
 * more piece of transient state.
 */
export interface TurnTake {
  key: string;
  /** Length of the *trimmed* take. */
  durationMs: number;
  /** Peak amplitude 0..1 of the trimmed take. */
  peak: number;
}

/** One turn the learner actually got through, with how long it was on screen. */
export interface CompletedTurn {
  index: number;
  speaker: Speaker;
  elapsedMs: number;
  /** The take that ended this turn, or `null` — a system turn, or a learner
   *  turn the mic could not serve. */
  take: TurnTake | null;
  /**
   * How that take was scored, or `null` — a system turn, a turn with no take,
   * or a take that was never sent.
   *
   * Kept in step with `SessionState.scores` by `withScore` rather than being a
   * snapshot: an assessment routinely lands *after* "Tiếp", and a completed
   * turn stuck on `{ state: "pending" }` forever would be a lie the end-of-
   * session summary (Story 2.7) reads as fact.
   */
  score: TurnScore | null;
}

export interface SessionState {
  status: SessionStatus;
  /**
   * Position in `script.turns` of the turn currently on screen. Equal to
   * `turns.length` once the last turn is done; meaningless unless `running`.
   */
  cursor: number;
  /** When the current turn went on screen, ms epoch. `null` unless `running`. */
  turnStartedAt: number | null;
  completed: CompletedTurn[];
  /** The record-and-listen phase of the turn on screen. */
  phase: TurnPhase;
  /** When capture started, ms epoch. `null` unless `phase === "recording"`. */
  recordingStartedAt: number | null;
  /**
   * Takes by turn index. Kept for the whole session, not just the current
   * turn: an earlier turn scrolled back to must still be replayable.
   */
  takes: Record<number, TurnTake>;
  /**
   * Scores by turn index, for the whole session.
   *
   * Kept past the turn on purpose: assessment takes a second or two and "Tiếp"
   * is usable immediately, so the answer frequently arrives when the cursor
   * has already moved. It is also kept past `finished` — unlike `takes`, there
   * is no blob to delete and Story 2.7's summary reads exactly this.
   *
   * Still **nothing persisted**: in-memory for one session, like 2.1 and 2.2.
   * A reload discards it.
   */
  scores: Record<number, TurnScore>;
  /**
   * The microphone is unusable for the rest of this session — permission
   * denied, no device, or the capture graph failed to build.
   *
   * Sticky on purpose, and set **only** by a failure that trying again cannot
   * fix — a denial, or no device at all (`isPermanentCaptureFailure`).
   * EXPERIENCE.md forbids asking a second time after a denial. A busy
   * microphone or a one-off worklet hiccup must stay retryable: killing the mic
   * for the whole session over a transient fault is a permanent punishment for
   * a temporary problem.
   */
  micBlocked: boolean;
  /**
   * Something outside the learner's control has stopped this session producing
   * a take — the mic is blocked, the disk is full, the write failed, the
   * capture graph delivered no signal.
   *
   * It exists so the **exit** can open without the *mic* going inert. Without
   * it a full quota dead-ends the session completely: every retry fails
   * identically, no take ever appears, "Tiếp" never opens, and the only way out
   * is "Kết thúc buổi" — while the notice cheerfully promises "buổi luyện vẫn
   * đi tiếp bình thường".
   */
  takeBlocked: boolean;
}

export function createSession(): SessionState {
  return {
    status: "idle",
    cursor: 0,
    turnStartedAt: null,
    completed: [],
    phase: "idle",
    recordingStartedAt: null,
    takes: {},
    scores: {},
    micBlocked: false,
    takeBlocked: false,
  };
}

/**
 * Can this entry be practised turn by turn at all?
 *
 * A pre-Story-1.2 entry carries one markdown blob and no turns
 * (`HistoryEntry.script === null`), and an empty script has nothing to walk.
 * Both get an explicit state, never a crash and never a blank screen.
 */
export function isPracticable(
  script: DialogueScript | null | undefined
): script is DialogueScript {
  return !!script && script.turns.length > 0;
}

function turnCount(script: DialogueScript | null | undefined): number {
  return script?.turns.length ?? 0;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * The start gesture. It exists for a reason beyond ceremony: `useSampleAudio`
 * swallows a rejected `audio.play()`, so a session that auto-speaks on mount
 * would march through silent turns explaining nothing. A tap supplies the user
 * activation that lets the first line sound.
 */
export function startSession(
  script: DialogueScript | null | undefined,
  at: number,
  previous?: SessionState
): SessionState {
  // A restart is a new session in every respect but one: a microphone the
  // browser has already refused will refuse again, and asking a second time is
  // exactly what EXPERIENCE.md rules out. `takes` is *not* carried over —
  // the blobs are dropped at the same moment (see `hooks/useTurnRecorder.ts`),
  // and a take control pointing at a deleted blob promises audio that is gone.
  const base = {
    ...createSession(),
    micBlocked: previous?.micBlocked ?? false,
    // `takeBlocked` is deliberately *not* carried: a fresh session should not
    // open its exit before the learner has tried anything. A mic that is still
    // blocked re-opens it on the first turn anyway, via `canContinue`.
    takeBlocked: false,
  };
  if (turnCount(script) === 0) {
    return { ...base, status: "finished" };
  }
  return { ...base, status: "running", cursor: 0, turnStartedAt: at };
}

// ---------------------------------------------------------------------------
// Recording transitions
// ---------------------------------------------------------------------------

/**
 * Capture has begun on the turn on screen.
 *
 * The turn's existing take is dropped here rather than on the take that
 * replaces it: re-recording must not leave the previous take playable while
 * the new one is being spoken, and there is deliberately **no attempt counter**
 * — that is Story 2.5's, and inventing one here would prejudge it.
 */
export function startRecording(state: SessionState, at: number): SessionState {
  if (state.status !== "running") return state;
  const takes = { ...state.takes };
  delete takes[state.cursor];
  // The score goes with the take it was a score *of*. Leaving it behind would
  // hang last attempt's verdict under the attempt being spoken — the worst
  // possible moment to show a stale ✗ — and there is deliberately no attempt
  // counter to tell the two apart (Story 2.5 owns that).
  const scores = { ...state.scores };
  delete scores[state.cursor];
  return { ...state, phase: "recording", recordingStartedAt: at, takes, scores };
}

/**
 * Capture stopped and produced a take. The turn stays on screen: only "Tiếp"
 * moves the session on from here.
 */
export function finishRecording(
  state: SessionState,
  take: TurnTake
): SessionState {
  if (state.phase !== "recording") return state;
  return {
    ...state,
    phase: "recorded",
    recordingStartedAt: null,
    takes: { ...state.takes, [state.cursor]: take },
  };
}

/**
 * Capture stopped with nothing to keep — a silence-only take, or a write that
 * failed. Back to `idle`, which is to say: the mic is offered again and the
 * turn has not moved.
 */
export function cancelRecording(state: SessionState): SessionState {
  if (state.phase !== "recording") return state;
  return { ...state, phase: "idle", recordingStartedAt: null };
}

/**
 * The microphone is not going to work this session — a denial, or no device.
 * Said once, then the mic goes inert and "Tiếp" carries the session.
 *
 * A blocked mic implies a blocked take, so this opens the exit too.
 */
export function blockMic(state: SessionState): SessionState {
  return {
    ...state,
    micBlocked: true,
    takeBlocked: true,
    phase: state.phase === "recording" ? "idle" : state.phase,
    recordingStartedAt: null,
  };
}

/**
 * This turn could not produce a take, through no fault of the learner: a full
 * disk, a failed write, a capture graph that delivered no signal, or a
 * transient capture failure.
 *
 * Opens the exit **without** touching the mic — unlike `blockMic`, every one of
 * these is worth another try, so the button stays live and "Tiếp" simply stops
 * being unreachable.
 */
export function blockTake(state: SessionState): SessionState {
  return {
    ...state,
    takeBlocked: true,
    phase: state.phase === "recording" ? "idle" : state.phase,
    recordingStartedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Scoring transitions
// ---------------------------------------------------------------------------

/**
 * Write one turn's score, in the state **and** on the completed turn that
 * carries it.
 *
 * One writer, so the two can never drift. They would otherwise: the assessment
 * routinely lands after "Tiếp" has already folded the turn into `completed`,
 * and a snapshot taken at completion time would freeze at `pending` forever.
 *
 * Deliberately **not** gated on `status === "running"`. A response that arrives
 * after "Kết thúc buổi" still belongs to the turn it was asked about, and the
 * finished screen still shows those turns. Nothing here can advance, reveal or
 * unblock anything, so there is nothing to guard against.
 */
function withScore(
  state: SessionState,
  turnIndex: number,
  score: TurnScore
): SessionState {
  return {
    ...state,
    scores: { ...state.scores, [turnIndex]: score },
    completed: state.completed.map((turn) =>
      turn.index === turnIndex ? { ...turn, score } : turn
    ),
  };
}

/** The request is about to leave. The card mounts now, in a worded pending
 *  state — "Tiếp" is already usable and must never wait on this. */
export function beginScoring(state: SessionState, turnIndex: number): SessionState {
  return withScore(state, turnIndex, { state: "pending" });
}

/** A verdict came back. */
export function completeScoring(
  state: SessionState,
  turnIndex: number,
  assessment: TurnAssessment,
  latencyMs: number
): SessionState {
  return withScore(state, turnIndex, { state: "scored", assessment, latencyMs });
}

/** Scoring failed. No number is invented and nothing is blocked. */
export function failScoring(
  state: SessionState,
  turnIndex: number,
  failure: ScoringFailure
): SessionState {
  return withScore(state, turnIndex, { state: "failed", failure });
}

/** The take was longer than `MAX_CLIP_MS`, so nothing was sent. Not a failure
 *  — a decision, and the card says which. */
export function skipScoring(
  state: SessionState,
  turnIndex: number,
  durationMs: number
): SessionState {
  return withScore(state, turnIndex, { state: "too-long", durationMs });
}

/**
 * The turn on screen is done — record it and move the cursor on. Past the last
 * turn the session finishes on its own.
 */
export function completeCurrentTurn(
  script: DialogueScript | null | undefined,
  state: SessionState,
  at: number
): SessionState {
  if (state.status !== "running") return state;
  // Mid-capture the turn is not over — the mic no longer means "next", and a
  // stray advance here would silently throw away the take being spoken.
  if (state.phase === "recording") return state;

  const turn = script?.turns[state.cursor];
  // The cursor is somehow off the end of the script: finish rather than
  // record a turn that does not exist.
  if (!turn) return endSession(state);

  const completed: CompletedTurn[] = [
    ...state.completed,
    {
      index: turn.index,
      speaker: turn.speaker,
      elapsedMs: Math.max(0, at - (state.turnStartedAt ?? at)),
      take: state.takes[turn.index] ?? null,
      // Usually `{ state: "pending" }` at this moment; `withScore` updates it
      // in place when the answer lands, however long after this that is.
      score: state.scores[turn.index] ?? null,
    },
  ];

  const next = state.cursor + 1;
  const done = next >= turnCount(script);
  return {
    ...state,
    status: done ? "finished" : "running",
    cursor: next,
    turnStartedAt: done ? null : at,
    completed,
    // The next turn starts fresh; earlier takes stay replayable.
    phase: "idle",
    recordingStartedAt: null,
    // Finishing here drops the takes for the same reason `endSession` does.
    takes: done ? {} : state.takes,
  };
}

/**
 * "Kết thúc buổi", usable at any point in any state.
 *
 * The turn in progress is *not* counted — it was displayed, not completed —
 * but every turn already finished keeps its stats. That is the whole of
 * "kết thúc giữa chừng vẫn giữ số liệu" for this story.
 */
export function endSession(state: SessionState): SessionState {
  if (state.status === "finished") return state;
  return {
    ...state,
    status: "finished",
    turnStartedAt: null,
    phase: "idle",
    recordingStartedAt: null,
    // The blobs go with the session (`hooks/useTurnRecorder.ts` drops the
    // `recordings` namespace), so the projections must stop offering them.
    // `CompletedTurn.take` keeps the record of what happened; `takes` is what
    // is still *playable*, and after this nothing is.
    takes: {},
  };
}

// ---------------------------------------------------------------------------
// Projections — the only shape the screen is allowed to render
// ---------------------------------------------------------------------------

/**
 * One turn as the session screen may show it.
 *
 * `text` is `null` on a learner turn and stays `null` in every state, at every
 * point: their line is the thing they are supposed to produce. `targetWords`
 * is emptied for the same reason — a target word is a literal substring of the
 * line, so handing it over is a partial reveal wearing a different name.
 *
 * The score card names target words — and it does so from its **own**
 * projection (`scoreCard` in `lib/pronunciation.ts`), never from here. Story
 * 2.5's third-failure reveal will need a fifth one for the same reason: a flag
 * on this interface would quietly turn every existing leak test into a test of
 * the flag's default.
 */
export interface TurnView {
  index: number;
  speaker: Speaker;
  /** The system's line, ready to render. Always `null` for a learner turn. */
  text: string | null;
  /** Target words to highlight in `text`. Always empty for a learner turn. */
  targetWords: string[];
  /**
   * The learner's own take of this turn, if one exists and is still playable.
   *
   * A reference, never audio and never text: `TurnTake.key` addresses a blob
   * and carries no part of the line. This is what gives a completed turn its
   * replay control when it is scrolled back to.
   */
  take: TurnTake | null;
}

export function turnView(
  turn: DialogueTurn,
  take: TurnTake | null = null
): TurnView {
  const isSystem = turn.speaker === "system";
  return {
    index: turn.index,
    speaker: turn.speaker,
    text: isSystem ? turn.text : null,
    targetWords: isSystem ? [...turn.targetWords] : [],
    take,
  };
}

/**
 * The chat log so far: every turn already done, plus the one on screen while
 * the session is running.
 */
export function visibleTurnViews(
  script: DialogueScript | null | undefined,
  state: SessionState
): TurnView[] {
  if (!script || state.status === "idle") return [];
  const end =
    state.status === "running"
      ? Math.min(state.cursor + 1, script.turns.length)
      : Math.min(state.cursor, script.turns.length);
  return script.turns
    .slice(0, end)
    .map((turn) => turnView(turn, state.takes[turn.index] ?? null));
}

/** Index of the turn on screen, or `null` when nothing is. */
export function currentTurnIndex(
  script: DialogueScript | null | undefined,
  state: SessionState
): number | null {
  if (state.status !== "running") return null;
  if (state.cursor < 0 || state.cursor >= turnCount(script)) return null;
  return state.cursor;
}

/**
 * Is the mic live?
 *
 * DESIGN.md is explicit that the mic's disabled state **is** the "chưa tới lượt
 * bạn" signal — there is no separate turn badge — so this predicate is the
 * whole turn indicator and belongs somewhere testable.
 */
export function micEnabled(
  script: DialogueScript | null | undefined,
  state: SessionState
): boolean {
  const index = currentTurnIndex(script, state);
  if (index === null) return false;
  return script?.turns[index]?.speaker === "learner";
}

/**
 * What the mic button *means* right now.
 *
 * Decided here rather than in the screen because it is three different
 * controls wearing one circle: a glyph, an accessible name and a glow all hang
 * off it, and "tap to start, tap again to stop — never press-and-hold" is a
 * frozen constraint that a `mousedown` handler could quietly break.
 *
 * `disabled` still carries its Story 2.1 meaning: DESIGN.md makes it the only
 * "chưa tới lượt bạn" indicator, so it must stay reachable from one predicate.
 */
export type MicAction = "record" | "stop" | "disabled";

export function micAction(
  script: DialogueScript | null | undefined,
  state: SessionState
): MicAction {
  if (state.status !== "running") return "disabled";
  // Stopping wins over everything: whatever else changed, a live capture must
  // always have a way to end.
  if (state.phase === "recording") return "stop";
  if (!micEnabled(script, state)) return "disabled";
  if (state.micBlocked) return "disabled";
  // `recorded` lands here too — tapping again re-records, replacing the take.
  return "record";
}

/**
 * May the learner leave this turn?
 *
 * The turn no longer ends when the mic stops, so something has to say when
 * "Tiếp" appears. Two ways in, and the second is the one the matrix insists
 * on: a take exists, **or** nothing outside the learner's control will let one
 * exist. A denied permission, a full disk and a silent capture graph must all
 * stop short of stranding the session on a control that will never work.
 *
 * Never mid-capture: `completeCurrentTurn` refuses it anyway, and offering a
 * button that does nothing is worse than not offering it.
 */
export function canContinue(
  script: DialogueScript | null | undefined,
  state: SessionState
): boolean {
  if (state.status !== "running") return false;
  const index = currentTurnIndex(script, state);
  if (index === null) return false;
  if (script?.turns[index]?.speaker !== "learner") return false;
  if (state.phase === "recording") return false;
  return state.phase === "recorded" || state.micBlocked || state.takeBlocked;
}

/**
 * The native reading of a turn may be replayed on demand — but for a learner
 * turn, only once a take of it exists.
 *
 * **This is the narrowed reveal rule, and it is deliberately a second,
 * distinct projection from `audioTurnToPlay`.** Story 2.1's invariant was "the
 * learner's line never reaches the speaker"; this story's whole point is
 * hearing yourself against the model, so the rule becomes: never before a take
 * exists, always after. Keeping it separate means the autoplay path still
 * returns `null` for every learner turn unconditionally, and the leak tests
 * that guard it keep meaning exactly what they say.
 *
 * The line's *text* is still never rendered, in any state. Only the audio
 * unlocks.
 */
export function sampleReplayUnlocked(
  script: DialogueScript | null | undefined,
  state: SessionState,
  turnIndex: number,
  status: SampleAudioStatus
): boolean {
  const turn = script?.turns[turnIndex];
  if (!turn) return false;
  // Nothing to play: generation failed, or never reached this line.
  if (status !== "ready") return false;
  if (turn.speaker === "system") return true;
  return state.takes[turnIndex] !== undefined;
}

/**
 * May this turn's take be played back?
 *
 * **The take channel's half of "nothing may sound into a live microphone."**
 * `shouldStopPlayback` governs the native-sample channel; take playback runs on
 * its own `<audio>` element in `hooks/useTurnRecorder.ts` and would otherwise
 * consult nothing. Without the `recording` gate, an earlier turn's take played
 * for its full length straight into an open mic — the learner's own voice
 * recorded over their next attempt.
 *
 * Gating the *control* rather than the playback is deliberate: a button that
 * cannot be pressed during capture is simpler and more honest than one that
 * starts audio and has it cut off a tick later.
 */
export function takeReplayUnlocked(
  state: SessionState,
  turnIndex: number
): boolean {
  if (state.phase === "recording") return false;
  return state.takes[turnIndex] !== undefined;
}

/** What the count-up clock is measuring. */
export type ClockMode = "turn" | "recording";

export interface ClockBasis {
  mode: ClockMode;
  /** Epoch ms the clock counts from, or `null` when it is not running. */
  startedAt: number | null;
}

/**
 * The clock's basis.
 *
 * While capture is live it counts the *take*, not the turn: that is the number
 * the learner is actually watching, and it is the one Story 2.3 caps at 30s.
 * It stays a count-up either way — DESIGN.md is explicit that it is a measure,
 * not an ultimatum, so nothing happens at any mark.
 */
export function clockBasis(state: SessionState): ClockBasis {
  if (state.phase === "recording" && state.recordingStartedAt !== null) {
    return { mode: "recording", startedAt: state.recordingStartedAt };
  }
  return {
    mode: "turn",
    startedAt: state.status === "running" ? state.turnStartedAt : null,
  };
}

export interface SessionSummary {
  completedTurns: number;
  totalTurns: number;
  learnerTurnsCompleted: number;
  systemTurnsCompleted: number;
  totalElapsedMs: number;
}

export function sessionSummary(
  script: DialogueScript | null | undefined,
  state: SessionState
): SessionSummary {
  let learner = 0;
  let system = 0;
  let elapsed = 0;
  for (const turn of state.completed) {
    if (turn.speaker === "learner") learner += 1;
    else system += 1;
    elapsed += turn.elapsedMs;
  }
  return {
    completedTurns: state.completed.length,
    totalTurns: turnCount(script),
    learnerTurnsCompleted: learner,
    systemTurnsCompleted: system,
    totalElapsedMs: elapsed,
  };
}

// ---------------------------------------------------------------------------
// What advances a turn
// ---------------------------------------------------------------------------

/** Rough reading pace, and the floor/ceiling that keep it sane. */
export const READING_MS_PER_WORD = 360;
export const MIN_READING_MS = 1500;
export const MAX_READING_MS = 9000;
/**
 * How long after a line goes on screen we stop waiting for audio that never
 * started. Safari's user activation is stricter than Chrome's sticky one and
 * `play` reports nothing back either way, so a session that waited on playback
 * alone could sit on one turn forever.
 */
export const AUDIO_START_GRACE_MS = 2500;

/** Time to leave a line on screen for someone reading it. */
export function readingDelayMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const raw = words * READING_MS_PER_WORD;
  return Math.min(MAX_READING_MS, Math.max(MIN_READING_MS, raw));
}

/**
 * What moves this turn along, given whether its sample audio is playable.
 *
 * Audio *enriches* a turn; it never gates one. A `failed` or still-queued line
 * shows its text and advances on the clock exactly as a spoken one would —
 * silence must never strand the learner.
 */
export interface TurnPlan {
  /** Ask `useSampleAudio` to sound this turn now. */
  playAudio: boolean;
  /**
   * Advance once playback that actually started comes to an end. The caller
   * drops `fallbackMs` the moment it observes playback start: audio can run
   * longer than any estimate, and cutting a line off mid-word is worse than
   * waiting.
   */
  awaitPlayback: boolean;
  /** Never advance before the line has had this long on screen. */
  minDwellMs: number;
  /**
   * Advance no later than this if playback never started. `null` means only
   * the learner ends this turn — a learner turn has no time limit at all.
   */
  fallbackMs: number | null;
}

export function turnPlan(
  turn: DialogueTurn,
  status: SampleAudioStatus
): TurnPlan {
  if (turn.speaker === "learner") {
    // No timer, no ceiling, nothing automatic. The mic is the only exit.
    return {
      playAudio: false,
      awaitPlayback: false,
      minDwellMs: 0,
      fallbackMs: null,
    };
  }

  const reading = readingDelayMs(turn.text);

  if (status === "ready") {
    return {
      playAudio: true,
      awaitPlayback: true,
      minDwellMs: reading,
      fallbackMs: reading + AUDIO_START_GRACE_MS,
    };
  }

  // `idle` (still queued), `fetching` and `failed` alike: show the text and
  // move on at reading pace. Blocked autoplay lands here too, via the caller's
  // fallback timer.
  return {
    playAudio: false,
    awaitPlayback: false,
    minDwellMs: reading,
    fallbackMs: reading,
  };
}

// ---------------------------------------------------------------------------
// The three decisions the screen used to make for itself
// ---------------------------------------------------------------------------
//
// `turnPlan` was pure from the start, but the screen still decided *whether to
// call `play`*, *what delay to schedule*, and *when to stop playback*. All
// three are invariants of this story, and all three were unreachable from a
// node suite: deleting the `|| !wantsAudio` guard in `SessionView` made the app
// read the learner's own line aloud in `en-US-AvaNeural` with every test, `tsc`
// and lint still green — the leak sweep below only inspects serialised
// projections, never playback. So they live here now.

/**
 * Which turn's sample audio should be sounding, or `null` for none.
 *
 * **This is the audio half of "the learner's line is never revealed."** It
 * returns `null` for a learner turn whatever that turn's audio status is —
 * blobs for learner lines really do exist (Story 1.4 generates both roles, for
 * Story 2.2's playback-comparison), so a stray `play(index)` on a learner turn
 * is a full reveal, just through the speaker instead of the screen.
 *
 * It is also `null` when nothing is current (before the start gesture, after
 * the end) and whenever the line is not playable yet — `turnPlan` already
 * decides that, and this stays a thin composition of it rather than a second
 * opinion.
 */
export function audioTurnToPlay(
  script: DialogueScript | null | undefined,
  state: SessionState,
  status: SampleAudioStatus
): number | null {
  const index = currentTurnIndex(script, state);
  if (index === null) return null;
  const turn = script?.turns[index];
  if (!turn) return null;
  return turnPlan(turn, status).playAudio ? index : null;
}

/** Everything the advance timer is allowed to know. */
export interface AdvanceDelayInput {
  /** `TurnPlan.awaitPlayback` for the turn on screen. */
  awaitPlayback: boolean;
  /** That turn's audio is sounding *right now*. */
  isSounding: boolean;
  /** That turn's audio started sounding at some point, whether or not it still is. */
  playbackStarted: boolean;
  /** `TurnPlan.minDwellMs`. */
  minDwellMs: number;
  /** `TurnPlan.fallbackMs`; `null` on a learner turn. */
  fallbackMs: number | null;
  /** How long the turn has already been on screen. */
  elapsedMs: number;
  /** Capture is live on this turn. */
  isRecording?: boolean;
}

/**
 * How long until this turn advances by itself — or `null` for "schedule
 * nothing".
 *
 * `null` has two meanings and both are load-bearing:
 *
 * - **a learner turn** (`fallbackMs === null`) has no timer at all; only the
 *   mic ends it. Reading this as `0` — which `fallbackMs ?? 0` in the screen
 *   used to risk — makes the learner's turn flash past before they can speak,
 *   and `turnPlan`'s own tests would not notice, because `turnPlan` is fine.
 * - **a line that is sounding** is left alone: no estimate may cut a line off
 *   mid-word. The caller re-runs this the instant playback stops, and that is
 *   when the turn gets its delay.
 * - **capture is live.** Redundant today — only learner turns can be recorded
 *   and they already have `fallbackMs: null` — and stated anyway, because "no
 *   timer may cut a recording short" is a rule about recording, not a
 *   side effect of where recording happens to be allowed.
 */
export function advanceDelayMs(input: AdvanceDelayInput): number | null {
  if (input.isRecording) return null;
  if (input.fallbackMs === null) return null;
  if (input.isSounding) return null;

  const dwellLeft = input.minDwellMs - input.elapsedMs;
  const delay =
    input.awaitPlayback && input.playbackStarted
      ? // Playback ran and finished. Honour the reading floor and no more.
        dwellLeft
      : // It never started — blocked autoplay, a failed line, or audio that is
        // still being generated. The fallback is the ceiling.
        Math.max(dwellLeft, input.fallbackMs - input.elapsedMs);

  return Math.max(0, delay);
}

/**
 * Should whatever is sounding be silenced?
 *
 * True whenever audio belongs to a turn that is no longer the one on screen,
 * and whenever the session is not running at all. `useSampleAudio` has no
 * `stop()` — `play(playingTurn)` is the documented toggle-off — and it sets
 * `playingTurn` only *after* an async read from IndexedDB, so a line can start
 * sounding a beat after the turn it belongs to has already passed. Watching
 * `playingTurn` and silencing anything stale covers that, ending the session
 * mid-line, and advancing off a system turn onto the learner's.
 */
export interface PlaybackContext {
  /**
   * The turn whose sample the learner has *deliberately* asked to hear again.
   *
   * Without this the reaper below would silence every replay the instant it
   * started: a scrolled-back turn is by definition not the turn on screen,
   * which is precisely the condition the reaper exists to catch. A learner turn
   * is the only thing this can point at (system turns replay as part of their
   * own turn), and `audioTurnToPlay` never returns a learner turn, so a
   * deliberate replay can never be confused with a stale autoplay.
   *
   * The `status !== "running"` case below is defensive rather than live: takes
   * and their unlocked samples are cleared when a session ends, so no replay
   * control survives into the finished state today.
   */
  replayTurn?: number | null;
  /** The record-and-listen phase of the turn on screen. */
  phase?: TurnPhase;
}

export function shouldStopPlayback(
  playingTurn: number | null,
  currentTurn: number | null,
  status: SessionStatus,
  context: PlaybackContext = {}
): boolean {
  if (playingTurn === null) return false;
  // Nothing may be sounding into a live microphone — the take would carry the
  // native voice reading the very line the learner is being asked to produce.
  if (context.phase === "recording") return true;
  if (context.replayTurn != null && playingTurn === context.replayTurn) {
    return false;
  }
  if (status !== "running") return true;
  return playingTurn !== currentTurn;
}

// ---------------------------------------------------------------------------
// What the screen says about a line's audio
// ---------------------------------------------------------------------------

/** `info` reads as ordinary progress; `warning` means this line stays silent. */
export type AudioNoteTone = "info" | "warning";

/** A glyph *and* words — never colour alone, and reachable by a screen reader. */
export interface AudioNote {
  glyph: string;
  text: string;
  tone: AudioNoteTone;
}

/**
 * What to say about the sample audio of the line on screen.
 *
 * Generation is sequential (~1–2s per line) and is driven only from
 * `DialogueDisplay`, never resumed — so a script opened straight from history
 * routinely runs ahead of its own synthesis and the first turns are silent.
 * Before this, `idle` and `fetching` said nothing at all and the silence looked
 * like a broken feature.
 *
 * Saying so does **not** change the advance rule: the frozen matrix has these
 * turns advancing on the clock, and audio must never gate a turn.
 */
export function audioNote(
  status: SampleAudioStatus,
  sounding: boolean
): AudioNote | null {
  if (sounding) {
    return { glyph: "🔊", text: "Đang phát giọng mẫu", tone: "info" };
  }
  switch (status) {
    case "idle":
    case "fetching":
      return { glyph: "⏳", text: "Đang tạo giọng mẫu…", tone: "info" };
    case "failed":
      return { glyph: "⚠", text: "Câu này không có giọng mẫu", tone: "warning" };
    case "ready":
      // Ready and not sounding: it has already played, or it is about to.
      // Nothing worth a line of text.
      return null;
  }
}
