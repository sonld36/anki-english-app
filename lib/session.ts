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
// Nothing here is persisted. Story 2.3 brings the first metrics worth a storage
// layer and can pick the shape then; an in-memory session that survives
// "Kết thúc buổi" but not a reload is exactly what Story 2.1 promises.

import type {
  DialogueScript,
  DialogueTurn,
  Speaker,
} from "./dialogue/types";
import type { HistoryEntry } from "./history";
import type { SampleAudioStatus } from "./sample-audio";

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

/** One turn the learner actually got through, with how long it was on screen. */
export interface CompletedTurn {
  index: number;
  speaker: Speaker;
  elapsedMs: number;
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
}

export function createSession(): SessionState {
  return { status: "idle", cursor: 0, turnStartedAt: null, completed: [] };
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
  at: number
): SessionState {
  if (turnCount(script) === 0) {
    return { status: "finished", cursor: 0, turnStartedAt: null, completed: [] };
  }
  return { status: "running", cursor: 0, turnStartedAt: at, completed: [] };
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
    },
  ];

  const next = state.cursor + 1;
  const done = next >= turnCount(script);
  return {
    status: done ? "finished" : "running",
    cursor: next,
    turnStartedAt: done ? null : at,
    completed,
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
  return { ...state, status: "finished", turnStartedAt: null };
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
 * line, so handing it over is a partial reveal wearing a different name. The
 * single sanctioned reveal is Story 2.5's third-failure path, which will need
 * its own projection rather than a flag on this one.
 */
export interface TurnView {
  index: number;
  speaker: Speaker;
  /** The system's line, ready to render. Always `null` for a learner turn. */
  text: string | null;
  /** Target words to highlight in `text`. Always empty for a learner turn. */
  targetWords: string[];
}

export function turnView(turn: DialogueTurn): TurnView {
  const isSystem = turn.speaker === "system";
  return {
    index: turn.index,
    speaker: turn.speaker,
    text: isSystem ? turn.text : null,
    targetWords: isSystem ? [...turn.targetWords] : [],
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
  return script.turns.slice(0, end).map(turnView);
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
 */
export function advanceDelayMs(input: AdvanceDelayInput): number | null {
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
export function shouldStopPlayback(
  playingTurn: number | null,
  currentTurn: number | null,
  status: SessionStatus
): boolean {
  if (playingTurn === null) return false;
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
