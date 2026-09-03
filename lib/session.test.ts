import { describe, expect, it } from "vitest";
import type { DialogueScript, DialogueTurn } from "./dialogue/types";
import type { HistoryEntry } from "./history";
import { recordingKey } from "./recording";
import { MIN_LEAKED_CONTENT_WORDS } from "./dialogue/types";
import { containsSequence, contentWords, tokenize } from "./dialogue/stopwords";
import {
  assessTurn,
  namedWords,
  scoreCard,
  type AssessedWord,
} from "./pronunciation";
import {
  AUDIO_START_GRACE_MS,
  advanceDelayMs,
  audioNote,
  audioTurnToPlay,
  blockMic,
  blockTake,
  canContinue,
  cancelRecording,
  clockBasis,
  finishRecording,
  hintAvailable,
  hintDepth,
  micAction,
  openHint,
  sampleReplayUnlocked,
  startRecording,
  takeReplayUnlocked,
  type TurnTake,
  MAX_READING_MS,
  MIN_READING_MS,
  completeCurrentTurn,
  createSession,
  currentTurnIndex,
  endSession,
  findEntry,
  isPracticable,
  micEnabled,
  readingDelayMs,
  sessionSummary,
  beginScoring,
  completeScoring,
  failScoring,
  skipScoring,
  shouldStopPlayback,
  startSession,
  turnPlan,
  turnView,
  visibleTurnViews,
  type SessionState,
} from "./session";

/**
 * The learner's lines carry a marker nothing else in the fixture contains, so
 * "did this leak?" is a substring search rather than a judgement call.
 */
const LEARNER_LINE_1 = "Zebrafish quibble marmalade at dawn.";
const LEARNER_LINE_2 = "Quixotic vellum thrums beneath.";

const SCRIPT: DialogueScript = {
  version: 3,
  turns: [
    {
      index: 0,
      speaker: "system",
      text: "It is cold today.",
      targetWords: ["cold"],
    },
    {
      index: 1,
      speaker: "learner",
      text: LEARNER_LINE_1,
      targetWords: ["Zebrafish", "marmalade"],
      hints: { situation: "Khi bạn chào lại", keywords: ["Zebrafish"] },
    },
    {
      index: 2,
      speaker: "system",
      text: "Bring a coat.",
      targetWords: [],
    },
    {
      index: 3,
      speaker: "learner",
      text: LEARNER_LINE_2,
      targetWords: ["vellum"],
    },
  ],
};

const SYSTEM_TURN = SCRIPT.turns[0];
const LEARNER_TURN = SCRIPT.turns[1];

/** Walk the session from `idle` to `finished`, one advance per turn. */
function runToEnd(script: DialogueScript, startAt = 1_000): SessionState {
  let state = startSession(script, startAt);
  let at = startAt;
  for (let i = 0; i < script.turns.length; i += 1) {
    at += 1_000;
    state = completeCurrentTurn(script, state, at);
  }
  return state;
}

describe("createSession", () => {
  it("starts idle with nothing completed", () => {
    expect(createSession()).toEqual({
      status: "idle",
      cursor: 0,
      turnStartedAt: null,
      completed: [],
      phase: "idle",
      recordingStartedAt: null,
      takes: {},
      // Story 2.3's slot. Empty, and deliberately part of this full-object
      // assertion so adding a field is a decision rather than an accident.
      scores: {},
      micBlocked: false,
      takeBlocked: false,
      // Story 2.4's slot. Empty, same reasoning as `scores` above.
      hints: {},
    });
  });
});

describe("findEntry", () => {
  const entryWith = (id: string): HistoryEntry => ({
    id,
    deckName: "deck",
    cards: [],
    context: "daily" as HistoryEntry["context"],
    level: "b1" as HistoryEntry["level"],
    script: SCRIPT,
    createdAt: "2026-08-22T00:00:00.000Z",
  });

  const ENTRIES = [entryWith("a"), entryWith("b")];

  it("finds the entry whose id matches", () => {
    expect(findEntry(ENTRIES, "b")).toBe(ENTRIES[1]);
  });

  it("returns null for an id no entry carries", () => {
    expect(findEntry(ENTRIES, "nope")).toBeNull();
  });

  it("returns null when there is no id at all", () => {
    // `?id=` absent, blank, or dropped — the screen owes the same state to all.
    expect(findEntry(ENTRIES, null)).toBeNull();
    expect(findEntry(ENTRIES, undefined)).toBeNull();
    expect(findEntry(ENTRIES, "")).toBeNull();
  });

  it("returns null when history is empty", () => {
    expect(findEntry([], "a")).toBeNull();
  });

  it("does not match on a prefix — ids are compared whole", () => {
    expect(findEntry(ENTRIES, "a1")).toBeNull();
  });
});

describe("isPracticable", () => {
  it("rejects a legacy entry with no structured script", () => {
    expect(isPracticable(null)).toBe(false);
  });

  it("rejects a script with no turns rather than opening an empty session", () => {
    expect(isPracticable({ version: 3, turns: [] })).toBe(false);
  });

  it("accepts a v2 script — this story reads no hints", () => {
    expect(isPracticable({ version: 2, turns: [SYSTEM_TURN] })).toBe(true);
  });
});

describe("startSession", () => {
  it("puts the cursor on the first turn and stamps its start", () => {
    const state = startSession(SCRIPT, 5_000);
    expect(state.status).toBe("running");
    expect(state.cursor).toBe(0);
    expect(state.turnStartedAt).toBe(5_000);
    expect(state.completed).toEqual([]);
  });

  it("finishes immediately when there is nothing to walk", () => {
    expect(startSession({ version: 3, turns: [] }, 5_000).status).toBe("finished");
    expect(startSession(null, 5_000).status).toBe("finished");
  });
});

describe("completeCurrentTurn", () => {
  it("records the turn with how long it was on screen and moves on", () => {
    const started = startSession(SCRIPT, 1_000);
    const next = completeCurrentTurn(SCRIPT, started, 3_400);

    expect(next.status).toBe("running");
    expect(next.cursor).toBe(1);
    expect(next.turnStartedAt).toBe(3_400);
    expect(next.completed).toEqual([
      // A system turn has neither a take nor a score.
      { index: 0, speaker: "system", elapsedMs: 2_400, take: null, score: null },
    ]);
  });

  it("finishes when the cursor moves past the last turn", () => {
    const state = runToEnd(SCRIPT);
    expect(state.status).toBe("finished");
    expect(state.cursor).toBe(SCRIPT.turns.length);
    expect(state.turnStartedAt).toBeNull();
    expect(state.completed).toHaveLength(SCRIPT.turns.length);
  });

  it("is inert once the session is finished", () => {
    const finished = runToEnd(SCRIPT);
    expect(completeCurrentTurn(SCRIPT, finished, 99_000)).toBe(finished);
  });

  it("is inert before the session starts", () => {
    const idle = createSession();
    expect(completeCurrentTurn(SCRIPT, idle, 99_000)).toBe(idle);
  });

  it("never reports a negative duration when the clock jumps backwards", () => {
    const started = startSession(SCRIPT, 5_000);
    const next = completeCurrentTurn(SCRIPT, started, 1_000);
    expect(next.completed[0].elapsedMs).toBe(0);
  });

  it("finishes rather than inventing a turn when the cursor is off the end", () => {
    const stray: SessionState = {
      ...createSession(),
      status: "running",
      cursor: 99,
      turnStartedAt: 1_000,
    };
    const next = completeCurrentTurn(SCRIPT, stray, 2_000);
    expect(next.status).toBe("finished");
    expect(next.completed).toEqual([]);
  });
});

describe("endSession", () => {
  it("keeps the stats of every turn already completed", () => {
    let state = startSession(SCRIPT, 1_000);
    state = completeCurrentTurn(SCRIPT, state, 2_000); // turn 0 took 1s
    state = completeCurrentTurn(SCRIPT, state, 6_000); // turn 1 took 4s

    const ended = endSession(state);

    expect(ended.status).toBe("finished");
    expect(ended.turnStartedAt).toBeNull();
    expect(ended.completed).toEqual([
      { index: 0, speaker: "system", elapsedMs: 1_000, take: null, score: null },
      { index: 1, speaker: "learner", elapsedMs: 4_000, take: null, score: null },
    ]);
    expect(sessionSummary(SCRIPT, ended)).toEqual({
      completedTurns: 2,
      totalTurns: 4,
      learnerTurnsCompleted: 1,
      systemTurnsCompleted: 1,
      totalElapsedMs: 5_000,
    });
  });

  it("does not count the turn that was still on screen", () => {
    let state = startSession(SCRIPT, 1_000);
    state = completeCurrentTurn(SCRIPT, state, 2_000);
    expect(endSession(state).completed).toHaveLength(1);
  });

  it("works from idle, so the control responds in every state", () => {
    const ended = endSession(createSession());
    expect(ended.status).toBe("finished");
    expect(sessionSummary(SCRIPT, ended).completedTurns).toBe(0);
  });

  it("is idempotent", () => {
    const once = endSession(startSession(SCRIPT, 1_000));
    expect(endSession(once)).toBe(once);
  });
});

describe("currentTurnIndex / micEnabled", () => {
  it("has no current turn before the start gesture or after the end", () => {
    expect(currentTurnIndex(SCRIPT, createSession())).toBeNull();
    expect(currentTurnIndex(SCRIPT, runToEnd(SCRIPT))).toBeNull();
  });

  it("leaves the mic disabled on a system turn", () => {
    const state = startSession(SCRIPT, 1_000);
    expect(currentTurnIndex(SCRIPT, state)).toBe(0);
    expect(micEnabled(SCRIPT, state)).toBe(false);
  });

  it("enables the mic exactly on a learner turn", () => {
    const state = completeCurrentTurn(SCRIPT, startSession(SCRIPT, 1_000), 2_000);
    expect(currentTurnIndex(SCRIPT, state)).toBe(1);
    expect(micEnabled(SCRIPT, state)).toBe(true);
  });

  it("leaves the mic disabled once the session is finished", () => {
    expect(micEnabled(SCRIPT, runToEnd(SCRIPT))).toBe(false);
    expect(micEnabled(SCRIPT, endSession(createSession()))).toBe(false);
  });
});

describe("turnPlan", () => {
  it("gives a learner turn no timer at all — only the mic ends it", () => {
    const plan = turnPlan(LEARNER_TURN, "ready");
    expect(plan.fallbackMs).toBeNull();
    expect(plan.playAudio).toBe(false);
    expect(plan.awaitPlayback).toBe(false);
  });

  it("plays a system turn whose audio is ready and waits for playback", () => {
    const plan = turnPlan(SYSTEM_TURN, "ready");
    expect(plan.playAudio).toBe(true);
    expect(plan.awaitPlayback).toBe(true);
    expect(plan.fallbackMs).toBe(plan.minDwellMs + AUDIO_START_GRACE_MS);
  });

  it("still advances a system turn whose audio failed", () => {
    const plan = turnPlan(SYSTEM_TURN, "failed");
    expect(plan.playAudio).toBe(false);
    expect(plan.fallbackMs).toBe(readingDelayMs(SYSTEM_TURN.text));
    expect(plan.fallbackMs).toBeGreaterThan(0);
  });

  it("still advances a system turn whose audio is queued or in flight", () => {
    for (const status of ["idle", "fetching"] as const) {
      const plan = turnPlan(SYSTEM_TURN, status);
      expect(plan.playAudio).toBe(false);
      expect(plan.fallbackMs).toBe(readingDelayMs(SYSTEM_TURN.text));
    }
  });

  it("never leaves a system turn without a way out, whatever the audio did", () => {
    for (const status of ["idle", "fetching", "ready", "failed"] as const) {
      expect(turnPlan(SYSTEM_TURN, status).fallbackMs).not.toBeNull();
    }
  });
});

describe("readingDelayMs", () => {
  it("clamps a one-word line up and a very long line down", () => {
    expect(readingDelayMs("Hi")).toBe(MIN_READING_MS);
    expect(readingDelayMs("word ".repeat(200))).toBe(MAX_READING_MS);
  });

  it("gives an empty line the floor rather than zero", () => {
    expect(readingDelayMs("   ")).toBe(MIN_READING_MS);
  });
});

describe("visibleTurnViews", () => {
  it("shows nothing before the start gesture", () => {
    expect(visibleTurnViews(SCRIPT, createSession())).toEqual([]);
  });

  it("shows the turns done plus the one on screen", () => {
    const state = completeCurrentTurn(SCRIPT, startSession(SCRIPT, 1_000), 2_000);
    expect(visibleTurnViews(SCRIPT, state).map((t) => t.index)).toEqual([0, 1]);
  });

  it("shows exactly the completed turns once the session ends early", () => {
    let state = startSession(SCRIPT, 1_000);
    state = completeCurrentTurn(SCRIPT, state, 2_000);
    state = endSession(state);
    expect(visibleTurnViews(SCRIPT, state).map((t) => t.index)).toEqual([0]);
  });

  it("shows every turn once the session runs to the end", () => {
    expect(visibleTurnViews(SCRIPT, runToEnd(SCRIPT))).toHaveLength(4);
  });

  it("has nothing to show for a legacy entry", () => {
    expect(visibleTurnViews(null, startSession(SCRIPT, 1_000))).toEqual([]);
  });
});

describe("the learner's line is never projected", () => {
  it("blanks text and target words on a learner turn", () => {
    const view = turnView(LEARNER_TURN);
    expect(view.speaker).toBe("learner");
    expect(view.text).toBeNull();
    expect(view.targetWords).toEqual([]);
  });

  it("keeps the system's line and its highlights", () => {
    const view = turnView(SYSTEM_TURN);
    expect(view.text).toBe("It is cold today.");
    expect(view.targetWords).toEqual(["cold"]);
  });

  it("does not hand back the source array, so a caller cannot mutate the script", () => {
    const view = turnView(SYSTEM_TURN);
    expect(view.targetWords).not.toBe(SYSTEM_TURN.targetWords);
  });

  it("leaks no learner text or target word from any projection, in any state", () => {
    const secrets = [
      LEARNER_LINE_1,
      LEARNER_LINE_2,
      "Zebrafish",
      "marmalade",
      "vellum",
      // The hint ladder belongs to Story 2.4 and must not ride along here.
      "Khi bạn chào lại",
    ];

    // Every state the session can be in, walked turn by turn.
    const states: SessionState[] = [createSession()];
    let state = startSession(SCRIPT, 1_000);
    let at = 1_000;
    for (let i = 0; i <= SCRIPT.turns.length; i += 1) {
      states.push(state, endSession(state));
      at += 1_000;
      state = completeCurrentTurn(SCRIPT, state, at);
    }

    const projections = states.flatMap((s) => [
      visibleTurnViews(SCRIPT, s),
      sessionSummary(SCRIPT, s),
      s,
    ]);

    const serialised = JSON.stringify(projections);
    for (const secret of secrets) {
      expect(serialised).not.toContain(secret);
    }
  });

  it("pins the fixture — the secrets really are in the script it walked", () => {
    const raw = JSON.stringify(SCRIPT);
    for (const secret of [LEARNER_LINE_1, LEARNER_LINE_2, "vellum"]) {
      expect(raw).toContain(secret);
    }
  });
});

describe("turnView on a hand-built turn", () => {
  it("treats any non-system speaker as the learner", () => {
    const turn: DialogueTurn = {
      index: 7,
      speaker: "learner",
      text: "secret",
      targetWords: ["secret"],
    };
    expect(turnView(turn)).toEqual({
      index: 7,
      speaker: "learner",
      text: null,
      targetWords: [],
      take: null,
    });
  });
});


// ---------------------------------------------------------------------------
// The decisions the screen used to make for itself
// ---------------------------------------------------------------------------

describe("audioTurnToPlay", () => {
  const onTurn = (i: number): SessionState => ({
    ...createSession(),
    status: "running",
    cursor: i,
    turnStartedAt: 1_000,
  });

  it("plays a system turn whose audio is ready", () => {
    expect(audioTurnToPlay(SCRIPT, onTurn(0), "ready")).toBe(0);
    expect(audioTurnToPlay(SCRIPT, onTurn(2), "ready")).toBe(2);
  });

  it("never plays a learner turn, whatever its audio status", () => {
    for (const status of ["idle", "fetching", "ready", "failed"] as const) {
      expect(audioTurnToPlay(SCRIPT, onTurn(1), status)).toBeNull();
      expect(audioTurnToPlay(SCRIPT, onTurn(3), status)).toBeNull();
    }
  });

  it("plays nothing while the audio is still being generated or has failed", () => {
    for (const status of ["idle", "fetching", "failed"] as const) {
      expect(audioTurnToPlay(SCRIPT, onTurn(0), status)).toBeNull();
    }
  });

  it("plays nothing before the start gesture or after the end", () => {
    expect(audioTurnToPlay(SCRIPT, createSession(), "ready")).toBeNull();
    expect(audioTurnToPlay(SCRIPT, runToEnd(SCRIPT), "ready")).toBeNull();
    expect(audioTurnToPlay(SCRIPT, endSession(startSession(SCRIPT, 1_000)), "ready")).toBeNull();
  });

  it("plays nothing for a legacy entry or an off-the-end cursor", () => {
    expect(audioTurnToPlay(null, onTurn(0), "ready")).toBeNull();
    expect(audioTurnToPlay(SCRIPT, onTurn(99), "ready")).toBeNull();
  });

  it("never returns a learner turn from any reachable state — the audio half of the leak rule", () => {
    let state = startSession(SCRIPT, 1_000);
    let at = 1_000;
    for (let i = 0; i <= SCRIPT.turns.length; i += 1) {
      for (const status of ["idle", "fetching", "ready", "failed"] as const) {
        const index = audioTurnToPlay(SCRIPT, state, status);
        if (index !== null) {
          expect(SCRIPT.turns[index].speaker).toBe("system");
        }
      }
      at += 1_000;
      state = completeCurrentTurn(SCRIPT, state, at);
    }
  });
});

describe("advanceDelayMs", () => {
  const base = {
    awaitPlayback: false,
    isSounding: false,
    playbackStarted: false,
    minDwellMs: 2_000,
    fallbackMs: 2_000 as number | null,
    elapsedMs: 0,
  };

  it("schedules nothing on a learner turn — only the mic ends it", () => {
    expect(advanceDelayMs({ ...base, fallbackMs: null })).toBeNull();
    // Even with time long past and playback finished, still nothing.
    expect(
      advanceDelayMs({
        ...base,
        fallbackMs: null,
        minDwellMs: 0,
        elapsedMs: 60_000,
        awaitPlayback: true,
        playbackStarted: true,
      })
    ).toBeNull();
  });

  it("schedules nothing while a line is sounding, so nothing cuts it off", () => {
    expect(
      advanceDelayMs({ ...base, awaitPlayback: true, isSounding: true, elapsedMs: 30_000 })
    ).toBeNull();
  });

  it("waits out the reading floor once playback has finished", () => {
    expect(
      advanceDelayMs({
        ...base,
        awaitPlayback: true,
        playbackStarted: true,
        minDwellMs: 3_000,
        fallbackMs: 5_500,
        elapsedMs: 1_200,
      })
    ).toBe(1_800);
  });

  it("advances immediately when playback finished after the reading floor", () => {
    expect(
      advanceDelayMs({
        ...base,
        awaitPlayback: true,
        playbackStarted: true,
        minDwellMs: 3_000,
        fallbackMs: 5_500,
        elapsedMs: 8_000,
      })
    ).toBe(0);
  });

  it("falls back on the ceiling when playback never started", () => {
    expect(
      advanceDelayMs({
        ...base,
        awaitPlayback: true,
        playbackStarted: false,
        minDwellMs: 3_000,
        fallbackMs: 5_500,
        elapsedMs: 1_000,
      })
    ).toBe(4_500);
  });

  it("gives a blocked autoplay the reading floor, not an instant skip", () => {
    // Autoplay refused: `playingTurn` flickered to this turn and straight back,
    // so playback "started" 50ms in. The line must still be readable.
    const delay = advanceDelayMs({
      ...base,
      awaitPlayback: true,
      playbackStarted: true,
      minDwellMs: 3_000,
      fallbackMs: 5_500,
      elapsedMs: 50,
    });
    expect(delay).toBe(2_950);
  });

  it("uses the plain reading delay for a failed or still-queued line", () => {
    expect(
      advanceDelayMs({ ...base, minDwellMs: 2_000, fallbackMs: 2_000, elapsedMs: 500 })
    ).toBe(1_500);
  });

  it("never returns a negative delay", () => {
    expect(advanceDelayMs({ ...base, elapsedMs: 999_999 })).toBe(0);
    expect(
      advanceDelayMs({
        ...base,
        awaitPlayback: true,
        playbackStarted: true,
        elapsedMs: 999_999,
      })
    ).toBe(0);
  });
});

describe("shouldStopPlayback", () => {
  it("has nothing to stop when nothing is sounding", () => {
    expect(shouldStopPlayback(null, 2, "running")).toBe(false);
    expect(shouldStopPlayback(null, null, "finished")).toBe(false);
  });

  it("leaves the current turn's own line alone", () => {
    expect(shouldStopPlayback(2, 2, "running")).toBe(false);
  });

  it("silences a line belonging to a turn that has passed", () => {
    // The mic advanced off turn 2 while its audio was still sounding, or
    // `play`'s async blob read resolved after the turn had already moved on.
    expect(shouldStopPlayback(2, 3, "running")).toBe(true);
    expect(shouldStopPlayback(0, 1, "running")).toBe(true);
  });

  it("silences everything when the session is not running", () => {
    // "Kết thúc buổi" mid-line, and the moment before a restart.
    expect(shouldStopPlayback(2, null, "finished")).toBe(true);
    expect(shouldStopPlayback(2, 2, "finished")).toBe(true);
    expect(shouldStopPlayback(0, null, "idle")).toBe(true);
  });
});

describe("audioNote", () => {
  it("says a line is sounding, whatever the stored status says", () => {
    expect(audioNote("ready", true)).toEqual({
      glyph: "🔊",
      text: "Đang phát giọng mẫu",
      tone: "info",
    });
  });

  it("explains the silence while audio is still being generated", () => {
    for (const status of ["idle", "fetching"] as const) {
      const note = audioNote(status, false);
      expect(note?.tone).toBe("info");
      expect(note?.text).toBe("Đang tạo giọng mẫu…");
      expect(note?.glyph).toBeTruthy();
    }
  });

  it("marks a line that will never have audio", () => {
    const note = audioNote("failed", false);
    expect(note?.tone).toBe("warning");
    expect(note?.text).toBe("Câu này không có giọng mẫu");
  });

  it("says nothing about a ready line that is not sounding", () => {
    expect(audioNote("ready", false)).toBeNull();
  });

  it("always carries words, never a glyph alone", () => {
    for (const status of ["idle", "fetching", "ready", "failed"] as const) {
      for (const sounding of [true, false]) {
        const note = audioNote(status, sounding);
        if (note) expect(note.text.trim().length).toBeGreaterThan(0);
      }
    }
  });
});


// ---------------------------------------------------------------------------
// Story 2.2 — recording, replay, and the narrowed reveal rule
// ---------------------------------------------------------------------------

const TAKE: TurnTake = { key: "entry-1:1", durationMs: 1_800, peak: 0.42 };
const QUIET_TAKE: TurnTake = { key: "entry-1:3", durationMs: 900, peak: 0.01 };

/** Start, walk to the first learner turn (index 1), and stop there. */
function onLearnerTurn(at = 1_000): SessionState {
  return completeCurrentTurn(SCRIPT, startSession(SCRIPT, at), at + 1_000);
}

describe("micAction", () => {
  it("is disabled before the start gesture and after the end", () => {
    expect(micAction(SCRIPT, createSession())).toBe("disabled");
    expect(micAction(SCRIPT, runToEnd(SCRIPT))).toBe("disabled");
  });

  it("is disabled on a system turn — the only 'chưa tới lượt bạn' signal", () => {
    expect(micAction(SCRIPT, startSession(SCRIPT, 1_000))).toBe("disabled");
  });

  it("offers to record on a learner turn", () => {
    expect(micAction(SCRIPT, onLearnerTurn())).toBe("record");
  });

  it("offers to stop while capture is live — tap to start, tap again to stop", () => {
    const recording = startRecording(onLearnerTurn(), 5_000);
    expect(micAction(SCRIPT, recording)).toBe("stop");
  });

  it("offers to record again once a take exists, replacing it", () => {
    const recorded = finishRecording(startRecording(onLearnerTurn(), 5_000), TAKE);
    expect(micAction(SCRIPT, recorded)).toBe("record");
  });

  it("goes inert for the rest of the session once the mic is blocked", () => {
    const blocked = blockMic(onLearnerTurn());
    expect(micAction(SCRIPT, blocked)).toBe("disabled");
  });

  it("always leaves a live capture a way to stop, even if the mic gets blocked", () => {
    // `blockMic` cancels the capture rather than stranding it, so the button
    // can never be left saying "stop" with nothing running.
    const blocked = blockMic(startRecording(onLearnerTurn(), 5_000));
    expect(blocked.phase).toBe("idle");
    expect(micAction(SCRIPT, blocked)).toBe("disabled");
  });
});

describe("the recording transitions", () => {
  it("stamps the start and drops any previous take of that turn", () => {
    const recorded = finishRecording(startRecording(onLearnerTurn(), 5_000), TAKE);
    expect(recorded.takes[1]).toEqual(TAKE);

    const again = startRecording(recorded, 9_000);
    expect(again.phase).toBe("recording");
    expect(again.recordingStartedAt).toBe(9_000);
    // No stale control while the replacement is being spoken.
    expect(again.takes[1]).toBeUndefined();
    // And no attempt counter anywhere — that is Story 2.5's, and adding one
    // here would prejudge it. The old spelling of this check was a regex over
    // the serialised state, which passed for *any* shape and pinned nothing;
    // an exhaustive key list actually fails when a field is added.
    expect(Object.keys(again).sort()).toEqual([
      "completed",
      "cursor",
      // Story 2.4's slot, alphabetically before `micBlocked` — proves hint
      // depth survives `startRecording`'s reset, unlike `takes`/`scores`.
      "hints",
      "micBlocked",
      "phase",
      "recordingStartedAt",
      // Story 2.3 added exactly one field, and this list is how that stays a
      // decision. Still no attempt counter — that is Story 2.5's.
      "scores",
      "status",
      "takeBlocked",
      "takes",
      "turnStartedAt",
    ]);
  });

  it("keeps the turn on screen after a take — only Tiếp advances it", () => {
    const recorded = finishRecording(startRecording(onLearnerTurn(), 5_000), TAKE);
    expect(recorded.status).toBe("running");
    expect(recorded.cursor).toBe(1);
    expect(recorded.phase).toBe("recorded");
    expect(recorded.recordingStartedAt).toBeNull();
  });

  it("returns to idle on an empty take, leaving the turn untouched", () => {
    const cancelled = cancelRecording(startRecording(onLearnerTurn(), 5_000));
    expect(cancelled.phase).toBe("idle");
    expect(cancelled.cursor).toBe(1);
    expect(cancelled.takes).toEqual({});
    expect(micAction(SCRIPT, cancelled)).toBe("record");
  });

  it("ignores a finish or cancel that no capture is behind", () => {
    const idle = onLearnerTurn();
    expect(finishRecording(idle, TAKE)).toBe(idle);
    expect(cancelRecording(idle)).toBe(idle);
  });

  it("does not start capture unless the session is running", () => {
    const idle = createSession();
    expect(startRecording(idle, 1_000)).toBe(idle);
    expect(startRecording(runToEnd(SCRIPT), 1_000).phase).toBe("idle");
  });
});

describe("the mic no longer advances the session on its own", () => {
  it("refuses to complete a turn mid-capture", () => {
    const recording = startRecording(onLearnerTurn(), 5_000);
    expect(completeCurrentTurn(SCRIPT, recording, 9_000)).toBe(recording);
  });

  it("carries the take onto the completed turn when Tiếp is used", () => {
    const recorded = finishRecording(startRecording(onLearnerTurn(), 5_000), TAKE);
    const next = completeCurrentTurn(SCRIPT, recorded, 12_000);

    expect(next.cursor).toBe(2);
    expect(next.completed[1]).toEqual({
      index: 1,
      speaker: "learner",
      elapsedMs: 10_000,
      take: TAKE,
      // Nothing asked for a score on this turn, so there is none to carry.
      score: null,
    });
    // The next turn starts clean, and turn 1 stays replayable.
    expect(next.phase).toBe("idle");
    expect(next.takes[1]).toEqual(TAKE);
  });

  it("records a null take when the mic never served the turn", () => {
    const blocked = blockMic(onLearnerTurn());
    const next = completeCurrentTurn(SCRIPT, blocked, 5_000);
    expect(next.completed[1].take).toBeNull();
  });
});

describe("canContinue", () => {
  it("is closed on a system turn — nothing for the learner to leave", () => {
    expect(canContinue(SCRIPT, startSession(SCRIPT, 1_000))).toBe(false);
  });

  it("is closed on a learner turn with nothing recorded yet", () => {
    expect(canContinue(SCRIPT, onLearnerTurn())).toBe(false);
  });

  it("is closed mid-capture", () => {
    expect(canContinue(SCRIPT, startRecording(onLearnerTurn(), 5_000))).toBe(false);
  });

  it("opens once a take exists", () => {
    const recorded = finishRecording(startRecording(onLearnerTurn(), 5_000), TAKE);
    expect(canContinue(SCRIPT, recorded)).toBe(true);
  });

  it("opens when the mic is unusable, so a denial cannot strand the session", () => {
    const blocked = blockMic(onLearnerTurn());
    expect(blocked.takes).toEqual({});
    expect(canContinue(SCRIPT, blocked)).toBe(true);
  });

  it("is closed before the session starts and after it ends", () => {
    expect(canContinue(SCRIPT, createSession())).toBe(false);
    expect(canContinue(SCRIPT, runToEnd(SCRIPT))).toBe(false);
  });
});

describe("no timer can fire mid-recording", () => {
  it("schedules nothing while capture is live", () => {
    expect(
      advanceDelayMs({
        awaitPlayback: false,
        isSounding: false,
        playbackStarted: false,
        minDwellMs: 0,
        // Even given a system turn's finite ceiling, long past.
        fallbackMs: 2_000,
        elapsedMs: 60_000,
        isRecording: true,
      })
    ).toBeNull();
  });

  it("silences any playback the moment capture starts", () => {
    // Nothing may sound into a live mic: the take would carry the native voice
    // reading the very line the learner is being asked to produce.
    expect(shouldStopPlayback(1, 1, "running", { phase: "recording" })).toBe(true);
    expect(
      shouldStopPlayback(1, 1, "running", { phase: "recording", replayTurn: 1 })
    ).toBe(true);
  });
});

describe("replay survives the reaper", () => {
  it("leaves a deliberately replayed earlier turn alone", () => {
    // Turn 1's sample, replayed while the cursor sits on turn 3. Without the
    // replay context this is indistinguishable from a stale autoplay and gets
    // silenced the instant it starts.
    expect(shouldStopPlayback(1, 3, "running", { replayTurn: 1 })).toBe(false);
    // And after the session ends, when nothing is "current" at all.
    expect(shouldStopPlayback(1, null, "finished", { replayTurn: 1 })).toBe(false);
  });

  it("still silences a stale line that nobody asked for", () => {
    expect(shouldStopPlayback(1, 3, "running", { replayTurn: 2 })).toBe(true);
    expect(shouldStopPlayback(1, 3, "running", { replayTurn: null })).toBe(true);
    expect(shouldStopPlayback(1, 3, "running", {})).toBe(true);
  });

  it("behaves exactly as before when no context is supplied", () => {
    expect(shouldStopPlayback(2, 2, "running")).toBe(false);
    expect(shouldStopPlayback(2, 3, "running")).toBe(true);
    expect(shouldStopPlayback(2, null, "finished")).toBe(true);
  });
});

describe("the native sample unlocks only after a take exists", () => {
  it("is locked on a learner turn with nothing recorded", () => {
    const state = onLearnerTurn();
    expect(sampleReplayUnlocked(SCRIPT, state, 1, "ready")).toBe(false);
  });

  it("unlocks that same turn once a take exists", () => {
    const recorded = finishRecording(startRecording(onLearnerTurn(), 5_000), TAKE);
    expect(sampleReplayUnlocked(SCRIPT, recorded, 1, "ready")).toBe(true);
  });

  it("stays locked when that line has no sample audio at all", () => {
    const recorded = finishRecording(startRecording(onLearnerTurn(), 5_000), TAKE);
    for (const status of ["idle", "fetching", "failed"] as const) {
      expect(sampleReplayUnlocked(SCRIPT, recorded, 1, status)).toBe(false);
    }
  });

  it("does not unlock a different learner turn", () => {
    const recorded = finishRecording(startRecording(onLearnerTurn(), 5_000), TAKE);
    expect(sampleReplayUnlocked(SCRIPT, recorded, 3, "ready")).toBe(false);
  });

  it("leaves the autoplay projection untouched — it still refuses every learner turn", () => {
    // The point of two projections: unlocking replay must not loosen autoplay.
    const recorded = finishRecording(startRecording(onLearnerTurn(), 5_000), TAKE);
    for (const status of ["idle", "fetching", "ready", "failed"] as const) {
      expect(audioTurnToPlay(SCRIPT, recorded, status)).toBeNull();
    }
  });

  it("has nothing to say about a turn that does not exist", () => {
    expect(sampleReplayUnlocked(SCRIPT, onLearnerTurn(), 99, "ready")).toBe(false);
    expect(sampleReplayUnlocked(null, onLearnerTurn(), 0, "ready")).toBe(false);
  });
});

describe("takes stay replayable across the session", () => {
  it("keeps an earlier turn's take once the session has moved on", () => {
    let state = finishRecording(startRecording(onLearnerTurn(), 5_000), TAKE);
    state = completeCurrentTurn(SCRIPT, state, 6_000); // → turn 2 (system)
    state = completeCurrentTurn(SCRIPT, state, 7_000); // → turn 3 (learner)

    expect(takeReplayUnlocked(state, 1)).toBe(true);
    expect(takeReplayUnlocked(state, 3)).toBe(false);
    expect(visibleTurnViews(SCRIPT, state).find((v) => v.index === 1)?.take)
      .toEqual(TAKE);
  });

  it("stops offering takes once the session ends — the blobs go with it", () => {
    let state = finishRecording(startRecording(onLearnerTurn(), 5_000), TAKE);
    state = endSession(state);

    expect(state.takes).toEqual({});
    expect(takeReplayUnlocked(state, 1)).toBe(false);
    for (const view of visibleTurnViews(SCRIPT, state)) {
      expect(view.take).toBeNull();
    }
  });

  it("stops offering takes once the last turn is done", () => {
    expect(runToEnd(SCRIPT).takes).toEqual({});
  });

  it("starts a fresh session with no takes, but does not re-ask a denied mic", () => {
    const blocked = blockMic(onLearnerTurn());
    const restarted = startSession(SCRIPT, 50_000, blocked);

    expect(restarted.status).toBe("running");
    expect(restarted.takes).toEqual({});
    expect(restarted.completed).toEqual([]);
    expect(restarted.micBlocked).toBe(true);
    // And without a previous state it is a clean slate.
    expect(startSession(SCRIPT, 50_000).micBlocked).toBe(false);
  });
});

describe("clockBasis", () => {
  it("counts the turn while nothing is being recorded", () => {
    const state = onLearnerTurn(1_000);
    expect(clockBasis(state)).toEqual({ mode: "turn", startedAt: 2_000 });
  });

  it("counts the take while capture is live", () => {
    const state = startRecording(onLearnerTurn(1_000), 5_500);
    expect(clockBasis(state)).toEqual({ mode: "recording", startedAt: 5_500 });
  });

  it("goes back to the turn once capture stops", () => {
    const state = finishRecording(startRecording(onLearnerTurn(1_000), 5_500), TAKE);
    expect(clockBasis(state)).toEqual({ mode: "turn", startedAt: 2_000 });
  });

  it("is not running before the start gesture or after the end", () => {
    expect(clockBasis(createSession()).startedAt).toBeNull();
    expect(clockBasis(runToEnd(SCRIPT)).startedAt).toBeNull();
  });
});

/**
 * The secrets, split — because Story 2.3 added a projection that has to name
 * one of the two groups.
 *
 * `LINE_SECRETS` is the rule that never bends: the learner's line, the words
 * of it they were not being taught, and the hint ladder. Nothing this module
 * produces may contain any of it, the score card included.
 *
 * `TARGET_WORDS` is the exemption, and it is exactly one projection wide. The
 * score card exists to tell the learner which target word they got wrong, so
 * it must name them; `SessionState.scores` carries the assessment it is built
 * from. Everything else — `TurnView`, `visibleTurnViews`, `sessionSummary`,
 * `micAction`, `canContinue`, `clockBasis`, `takeReplayUnlocked`,
 * `sampleReplayUnlocked` — still may not, and that is asserted below.
 *
 * The exemption is not a hole, because `MAX_TARGET_WORDS_PER_TURN` is 2 and
 * `MIN_LEAKED_CONTENT_WORDS` is 4: the target words of one turn can never be
 * a reconstructable run of its line. The card's *other* words are bounded by
 * the same rule, pinned in the test after this one and in
 * `lib/pronunciation.test.ts`.
 */
const LINE_SECRETS = [
  LEARNER_LINE_1,
  LEARNER_LINE_2,
  // Content words of the learner's lines that are NOT target words. The card
  // may name a badly-scored word, so this holds because the assessments the
  // sweep builds only ever cover the target words themselves.
  "quibble",
  "dawn",
  "Quixotic",
  "thrums",
  "beneath",
  "Khi bạn chào lại",
];

const TARGET_WORDS = ["Zebrafish", "marmalade", "vellum"];

/** An assessment of turn 1's target words, one clean and one badly wrong. */
function assessmentForTurn1() {
  const words: AssessedWord[] = [
    {
      word: "zebrafish",
      phonemes: [
        { phoneme: "z", score: 88 },
        { phoneme: "ɪ", score: 85 },
        { phoneme: "ʃ", score: 82 },
      ],
    },
    {
      word: "marmalade",
      phonemes: [
        { phoneme: "m", score: 90 },
        { phoneme: "l", score: 9 },
        { phoneme: "d", score: 12 },
      ],
    },
  ];
  return assessTurn(words, SCRIPT.turns[1].targetWords);
}

describe("the leak sweep still finds nothing, now with takes and scores in play", () => {
  it("leaks no learner line from any projection, in any state", () => {
    // Same sweep as before, but every learner turn is now recorded, scored,
    // failed and re-recorded on the way through — the states this story adds.
    const states: SessionState[] = [createSession()];
    let state = startSession(SCRIPT, 1_000);
    let at = 1_000;
    for (let i = 0; i <= SCRIPT.turns.length; i += 1) {
      states.push(state, endSession(state), blockMic(state));
      if (micAction(SCRIPT, state) === "record") {
        const index = state.cursor;
        const recording = startRecording(state, at);
        const recorded = finishRecording(recording, {
          key: `entry-1:${index}`,
          durationMs: 1_500,
          peak: 0.3,
        });
        const pending = beginScoring(recorded, index);
        const scored = completeScoring(pending, index, assessmentForTurn1(), 1_900);
        const failed = failScoring(recorded, index, "credential");
        const skipped = skipScoring(recorded, index, 41_000);
        states.push(
          recording,
          recorded,
          cancelRecording(recording),
          pending,
          scored,
          failed,
          skipped,
          // Re-recording on top of a scored turn: the score must be gone.
          startRecording(scored, at + 500)
        );
        state = scored;
      }
      at += 1_000;
      state = completeCurrentTurn(SCRIPT, state, at);
    }

    /**
     * One state with the score slot lifted out — built by listing what stays
     * rather than by destructuring what goes, so a new field on `SessionState`
     * has to be added here deliberately rather than sliding into the sweep
     * unexamined.
     *
     * That is only true because of the assertion below, which compares these
     * keys against the real ones. Said without it, it was a comment describing
     * a guarantee nothing provided: the exhaustive key list it pointed at is in
     * a different `describe` block and never touches this object.
     */
    const stateWithoutScores = (s: SessionState) => ({
      status: s.status,
      cursor: s.cursor,
      turnStartedAt: s.turnStartedAt,
      phase: s.phase,
      recordingStartedAt: s.recordingStartedAt,
      takes: s.takes,
      micBlocked: s.micBlocked,
      takeBlocked: s.takeBlocked,
      // Not a secret — hint depth names no content, so it stays in the
      // lifted object rather than joining `OMITTED` below.
      hints: s.hints,
      completed: s.completed.map((t) => ({
        index: t.index,
        speaker: t.speaker,
        elapsedMs: t.elapsedMs,
        take: t.take,
      })),
    });

    /** The only field the sweep is allowed to omit — the score slot itself. */
    const OMITTED = ["scores"];
    for (const s of states) {
      const lifted = stateWithoutScores(s);
      expect([...Object.keys(lifted), ...OMITTED].sort()).toEqual(
        Object.keys(s).sort()
      );
      // And the same for the completed turns it flattens: `score` is the one
      // field lifted out there, and a new one must not ride along unlooked-at.
      s.completed.forEach((turn, i) => {
        expect([...Object.keys(lifted.completed[i]), "score"].sort()).toEqual(
          Object.keys(turn).sort()
        );
      });
    }

    /** Everything but the fourth projection and the slot it is built from. */
    const withoutScoring = states.flatMap((s) => {
      return [
        visibleTurnViews(SCRIPT, s),
        sessionSummary(SCRIPT, s),
        stateWithoutScores(s),
        SCRIPT.turns.map((t) => ({
          mic: micAction(SCRIPT, s),
          cont: canContinue(SCRIPT, s),
          clock: clockBasis(s),
          take: takeReplayUnlocked(s, t.index),
          sample: sampleReplayUnlocked(SCRIPT, s, t.index, "ready"),
        })),
      ];
    });

    /** The fourth projection, over every learner turn of every state. */
    const cards = states.flatMap((s) =>
      SCRIPT.turns
        .filter((t) => t.speaker === "learner")
        .map((t) => scoreCard(s.scores[t.index], t.targetWords, t.text))
    );

    // (1) The line itself — nowhere, in anything, ever. This includes the
    //     score card and the raw `scores` slot.
    const everything = JSON.stringify([...withoutScoring, cards, states]);
    for (const secret of LINE_SECRETS) {
      expect(everything).not.toContain(secret);
    }

    // (2) Target words — still forbidden everywhere except the card and the
    //     score slot. If a future edit lets one back into `TurnView` or a
    //     summary, this fails exactly as it did before Story 2.3.
    const serialised = JSON.stringify(withoutScoring);
    for (const secret of TARGET_WORDS) {
      expect(serialised).not.toContain(secret);
    }

    // (3) And the exemption really is exercised — otherwise (2) would be
    //     passing because the card is empty rather than because it is bounded.
    expect(JSON.stringify(cards)).toContain("marmalade");
  });

  it("bounds what the card may name, even when every word scores zero", () => {
    // The worst case for disclosure: nothing the learner said was recognised
    // well, so an unbounded card would read the line back to them.
    const line = SCRIPT.turns[1].text;
    const targets = SCRIPT.turns[1].targetWords;
    const everyWord: AssessedWord[] = line
      .replace(/[.]/g, "")
      .split(/\s+/)
      .map((word) => ({ word, phonemes: [{ phoneme: "t", score: 0 }] }));

    const state = completeScoring(
      beginScoring(onLearnerTurn(), 1),
      1,
      assessTurn(everyWord, targets),
      2_000
    );
    const card = scoreCard(state.scores[1], targets, line);
    const named = new Set(namedWords(card).flatMap((w) => tokenize(w)));
    const always = new Set(targets.flatMap((t) => tokenize(t)));
    const lineContent = contentWords(line, always);

    // The same rule the hint validator enforces: four consecutive content
    // words is where naming stops describing and starts quoting.
    for (let i = 0; i + MIN_LEAKED_CONTENT_WORDS <= lineContent.length; i += 1) {
      const window = lineContent.slice(i, i + MIN_LEAKED_CONTENT_WORDS);
      expect(containsSequence(window.filter((t) => named.has(t)), window)).toBe(
        false
      );
    }
    expect(JSON.stringify(card)).not.toContain(line);
  });

  it("the take reference carries a key, never any part of the line", () => {
    const recorded = finishRecording(startRecording(onLearnerTurn(), 5_000), QUIET_TAKE);
    const view = visibleTurnViews(SCRIPT, recorded).find((v) => v.index === 1);
    expect(view?.text).toBeNull();
    expect(view?.targetWords).toEqual([]);
    expect(view?.take).toEqual(QUIET_TAKE);
    expect(JSON.stringify(view)).not.toContain("Zebrafish");
  });
});


// ---------------------------------------------------------------------------
// Review round 1 — the transitions this story actually risks
// ---------------------------------------------------------------------------

describe("ending or restarting from mid-capture", () => {
  it("takes the session out of `recording` when it ends", () => {
    // The screen must know the capture is over so it can tear the graph down.
    // Nothing drove either transition from mid-capture before, which is how a
    // live MediaStream came to outlive "Kết thúc buổi" with the recording
    // indicator lit and no control left that could stop it.
    const recording = startRecording(onLearnerTurn(), 5_000);
    expect(recording.phase).toBe("recording");

    const ended = endSession(recording);
    expect(ended.status).toBe("finished");
    expect(ended.phase).toBe("idle");
    expect(ended.recordingStartedAt).toBeNull();
    expect(micAction(SCRIPT, ended)).toBe("disabled");
    expect(clockBasis(ended).startedAt).toBeNull();
  });

  it("takes the session out of `recording` when it restarts", () => {
    const recording = startRecording(onLearnerTurn(), 5_000);
    const restarted = startSession(SCRIPT, 50_000, recording);

    expect(restarted.phase).toBe("idle");
    expect(restarted.recordingStartedAt).toBeNull();
    expect(restarted.cursor).toBe(0);
    expect(micAction(SCRIPT, restarted)).toBe("disabled");
  });

  it("keeps the completed stats of a session ended mid-capture", () => {
    const recording = startRecording(onLearnerTurn(1_000), 5_000);
    const ended = endSession(recording);
    // Turn 0 finished; the turn being recorded was displayed, not completed.
    expect(ended.completed).toHaveLength(1);
    expect(ended.completed[0].index).toBe(0);
  });
});

describe("blockMic and blockTake", () => {
  it("blockMic also opens the exit — an inert mic can never produce a take", () => {
    const blocked = blockMic(onLearnerTurn());
    expect(blocked.micBlocked).toBe(true);
    expect(blocked.takeBlocked).toBe(true);
    expect(canContinue(SCRIPT, blocked)).toBe(true);
  });

  it("blockTake opens the exit and leaves the mic alone", () => {
    // A full disk, a failed write, a silent graph, a busy device: all worth
    // another tap, none of them the learner's doing.
    const blocked = blockTake(onLearnerTurn());
    expect(blocked.takeBlocked).toBe(true);
    expect(blocked.micBlocked).toBe(false);
    expect(micAction(SCRIPT, blocked)).toBe("record");
    expect(canContinue(SCRIPT, blocked)).toBe(true);
  });

  it("both end a capture rather than stranding one", () => {
    const recording = startRecording(onLearnerTurn(), 5_000);
    for (const blocked of [blockMic(recording), blockTake(recording)]) {
      expect(blocked.phase).toBe("idle");
      expect(blocked.recordingStartedAt).toBeNull();
    }
  });

  it("is inert about the session on a state that is not running", () => {
    // Called from an async handler that may resolve after "Kết thúc buổi": it
    // must not resurrect a finished session or open an exit on it.
    for (const state of [createSession(), runToEnd(SCRIPT)]) {
      for (const blocked of [blockMic(state), blockTake(state)]) {
        expect(blocked.status).toBe(state.status);
        expect(canContinue(SCRIPT, blocked)).toBe(false);
        expect(micAction(SCRIPT, blocked)).toBe("disabled");
      }
    }
  });

  it("a quota failure cannot dead-end the session", () => {
    // Every retry fails identically, so without `blockTake` no take ever
    // appears, "Tiếp" never opens, and the only way out is "Kết thúc buổi" —
    // while the notice promises "buổi luyện vẫn đi tiếp bình thường".
    let state = onLearnerTurn();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      state = blockTake(startRecording(state, 5_000 + attempt));
    }
    expect(state.takes).toEqual({});
    expect(canContinue(SCRIPT, state)).toBe(true);
  });
});

describe("nothing may sound into a live microphone — the take channel", () => {
  it("closes an earlier turn's take control while capture is live", () => {
    // Take playback runs on its own <audio> element and consults nothing else;
    // without this, tapping turn 1's take during turn 3's capture played the
    // learner's own voice straight back into the open mic.
    let state = finishRecording(startRecording(onLearnerTurn(), 5_000), TAKE);
    state = completeCurrentTurn(SCRIPT, state, 6_000); // → turn 2 (system)
    state = completeCurrentTurn(SCRIPT, state, 7_000); // → turn 3 (learner)
    expect(takeReplayUnlocked(state, 1)).toBe(true);

    const recording = startRecording(state, 8_000);
    expect(recording.takes[1]).toEqual(TAKE); // the take is still there…
    expect(takeReplayUnlocked(recording, 1)).toBe(false); // …but sealed.
  });

  it("re-opens it the moment capture stops", () => {
    let state = finishRecording(startRecording(onLearnerTurn(), 5_000), TAKE);
    state = completeCurrentTurn(SCRIPT, state, 6_000);
    state = completeCurrentTurn(SCRIPT, state, 7_000);
    const recording = startRecording(state, 8_000);

    expect(takeReplayUnlocked(cancelRecording(recording), 1)).toBe(true);
    expect(
      takeReplayUnlocked(finishRecording(recording, QUIET_TAKE), 1)
    ).toBe(true);
  });

  it("no take of any turn is replayable while capture is live", () => {
    let state = finishRecording(startRecording(onLearnerTurn(), 5_000), TAKE);
    state = completeCurrentTurn(SCRIPT, state, 6_000);
    state = completeCurrentTurn(SCRIPT, state, 7_000);
    const recording = startRecording(state, 8_000);
    for (const turn of SCRIPT.turns) {
      expect(takeReplayUnlocked(recording, turn.index)).toBe(false);
    }
  });
});

describe("a take's key and its slot in `takes` name the same turn", () => {
  it("stores under the cursor, and the key carries that same index", () => {
    // Two declarations, one test. `state.takes` is keyed by `state.cursor`
    // while the blob is keyed by the index handed to `recorder.stop()`. They
    // are computed in different modules and nothing else makes them agree: a
    // divergence would store the blob for turn 3 and offer it on turn 1, with
    // every type still checking.
    const entryId = "entry-1";
    let state = startSession(SCRIPT, 1_000);
    let at = 1_000;

    for (let i = 0; i < SCRIPT.turns.length; i += 1) {
      if (micAction(SCRIPT, state) === "record") {
        const index = state.cursor;
        state = finishRecording(startRecording(state, at), {
          key: recordingKey(entryId, index),
          durationMs: 1_200,
          peak: 0.4,
        });
        expect(state.takes[index]?.key).toBe(recordingKey(entryId, index));
      }
      at += 1_000;
      state = completeCurrentTurn(SCRIPT, state, at);
    }

    for (const completed of state.completed) {
      if (completed.take) {
        expect(completed.take.key).toBe(recordingKey(entryId, completed.index));
      }
    }
  });
});


// ---------------------------------------------------------------------------
// Story 2.3 — the score slot, and what it is forbidden to touch
// ---------------------------------------------------------------------------

/** Turn 1, recorded and waiting on a verdict. */
function scoringTurn1(): SessionState {
  return beginScoring(finishRecording(startRecording(onLearnerTurn(), 5_000), TAKE), 1);
}

describe("the scoring lifecycle", () => {
  it("walks pending → scored, keyed by turn index", () => {
    const pending = scoringTurn1();
    expect(pending.scores[1]).toEqual({ state: "pending" });

    const assessment = assessTurn(
      [{ word: "zebrafish", phonemes: [{ phoneme: "z", score: 90 }] }],
      ["Zebrafish"]
    );
    const scored = completeScoring(pending, 1, assessment, 1_900);
    expect(scored.scores[1]).toEqual({ state: "scored", assessment, latencyMs: 1_900 });
    // Only that turn.
    expect(scored.scores[0]).toBeUndefined();
    expect(scored.scores[3]).toBeUndefined();
  });

  it("walks pending → failed without inventing anything", () => {
    const failed = failScoring(scoringTurn1(), 1, "network");
    expect(failed.scores[1]).toEqual({ state: "failed", failure: "network" });
  });

  it("records a take that was never sent as a decision, not a failure", () => {
    const skipped = skipScoring(scoringTurn1(), 1, 41_000);
    expect(skipped.scores[1]).toEqual({ state: "too-long", durationMs: 41_000 });
  });

  it("keeps `scores` and `completed` in step when the verdict lands late", () => {
    // The usual case, not an edge one: assessment takes a second or two and
    // "Tiếp" is open immediately, so the answer routinely arrives after the
    // cursor has moved. A snapshot taken at completion time would freeze the
    // completed turn on `pending` for ever — and Story 2.7 reads exactly that.
    const advanced = completeCurrentTurn(SCRIPT, scoringTurn1(), 12_000);
    expect(advanced.cursor).toBe(2);
    expect(advanced.completed[1].score).toEqual({ state: "pending" });

    const assessment = assessTurn(
      [{ word: "zebrafish", phonemes: [{ phoneme: "z", score: 5 }] }],
      ["Zebrafish"]
    );
    const late = completeScoring(advanced, 1, assessment, 2_100);
    expect(late.completed[1].score).toEqual({
      state: "scored",
      assessment,
      latencyMs: 2_100,
    });
    expect(late.scores[1]).toEqual(late.completed[1].score);
  });

  it("survives the end of the session — there is no blob to collect", () => {
    // Unlike `takes`, which are dropped because their blobs are.
    const scored = completeScoring(scoringTurn1(), 1, assessTurn([], []), 1_000);
    const ended = endSession(scored);
    expect(ended.takes).toEqual({});
    expect(ended.scores[1]).toBeDefined();
  });

  it("starts a new session with nothing scored", () => {
    const scored = completeScoring(scoringTurn1(), 1, assessTurn([], []), 1_000);
    expect(startSession(SCRIPT, 50_000, scored).scores).toEqual({});
  });
});

describe("re-recording drops the score with the take", () => {
  it("returns the card to empty rather than hanging a stale verdict on a new take", () => {
    const assessment = assessTurn(
      [{ word: "marmalade", phonemes: [{ phoneme: "d", score: 2 }] }],
      ["marmalade"]
    );
    const scored = completeScoring(scoringTurn1(), 1, assessment, 1_500);
    expect(scored.takes[1]).toEqual(TAKE);
    expect(scored.scores[1]).toBeDefined();

    const again = startRecording(scored, 20_000);
    expect(again.takes[1]).toBeUndefined();
    expect(again.scores[1]).toBeUndefined();
    // And nothing renders from the empty slot.
    expect(scoreCard(again.scores[1], ["marmalade"], LEARNER_LINE_1)).toBeNull();
  });

  it("leaves an earlier turn's score alone", () => {
    const scored = completeScoring(scoringTurn1(), 1, assessTurn([], []), 1_000);
    const onTurn3 = completeCurrentTurn(
      SCRIPT,
      completeCurrentTurn(SCRIPT, scored, 12_000),
      13_000
    );
    expect(onTurn3.cursor).toBe(3);
    const recordingTurn3 = startRecording(onTurn3, 14_000);
    expect(recordingTurn3.scores[1]).toBeDefined();
  });
});

describe("scoring never gates the session", () => {
  it("opens `Tiếp` on the take alone, before any verdict exists", () => {
    const recorded = finishRecording(startRecording(onLearnerTurn(), 5_000), TAKE);
    expect(recorded.scores[1]).toBeUndefined();
    expect(canContinue(SCRIPT, recorded)).toBe(true);
  });

  it("keeps `Tiếp` open while scoring is in flight and after it fails", () => {
    const pending = scoringTurn1();
    expect(canContinue(SCRIPT, pending)).toBe(true);

    for (const failure of ["network", "timeout", "credential", "service", "unreadable"] as const) {
      expect(canContinue(SCRIPT, failScoring(pending, 1, failure))).toBe(true);
    }
    expect(canContinue(SCRIPT, skipScoring(pending, 1, 41_000))).toBe(true);
  });

  it("advances exactly as it would have with no scoring at all", () => {
    const withScore = completeCurrentTurn(SCRIPT, scoringTurn1(), 12_000);
    const without = completeCurrentTurn(
      SCRIPT,
      finishRecording(startRecording(onLearnerTurn(), 5_000), TAKE),
      12_000
    );
    expect(withScore.cursor).toBe(without.cursor);
    expect(withScore.status).toBe(without.status);
    expect(withScore.phase).toBe(without.phase);
  });

  it("does not change what the mic means", () => {
    const pending = scoringTurn1();
    expect(micAction(SCRIPT, pending)).toBe("record");
    expect(micAction(SCRIPT, failScoring(pending, 1, "service"))).toBe("record");
  });
});

describe("scoring cannot open the audio leak", () => {
  it("keeps `audioTurnToPlay` null on a learner turn in every scoring state", () => {
    // A learner line has a blob — Story 1.4 synthesises both roles — so a
    // stray `play(index)` would read the sentence they are supposed to
    // produce out loud. Scoring must not become a new way in.
    const assessment = assessTurn([], []);
    const states = [
      scoringTurn1(),
      completeScoring(scoringTurn1(), 1, assessment, 1_000),
      failScoring(scoringTurn1(), 1, "credential"),
      skipScoring(scoringTurn1(), 1, 41_000),
    ];
    for (const state of states) {
      expect(currentTurnIndex(SCRIPT, state)).toBe(1);
      for (const status of ["idle", "fetching", "ready", "failed"] as const) {
        expect(audioTurnToPlay(SCRIPT, state, status)).toBeNull();
      }
    }
  });

  it("does not unlock the native sample on its own — only a take does", () => {
    // `sampleReplayUnlocked` is Story 2.2's rule and scoring is not a way
    // around it: a scored turn with no take must stay sealed.
    const noTake: SessionState = { ...onLearnerTurn(), scores: { 1: { state: "pending" } } };
    expect(sampleReplayUnlocked(SCRIPT, noTake, 1, "ready")).toBe(false);
  });

  it("leaves `TurnView` exactly as it was", () => {
    const scored = completeScoring(scoringTurn1(), 1, assessTurn([], []), 1_000);
    const view = visibleTurnViews(SCRIPT, scored).find((v) => v.index === 1);
    expect(view?.text).toBeNull();
    expect(view?.targetWords).toEqual([]);
    expect(Object.keys(view ?? {}).sort()).toEqual([
      "index",
      "speaker",
      "take",
      "targetWords",
      "text",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Story 2.4 — the two-rung hint ladder
// ---------------------------------------------------------------------------

/** Walk to turn 3 — a learner turn (`LEARNER_LINE_2`) with no `hints` at
 *  all, the "no ladder" case the I/O matrix calls out. */
function onNoLadderTurn(at = 1_000): SessionState {
  let state = startSession(SCRIPT, at);
  let t = at;
  for (let i = 0; i < 3; i += 1) {
    t += 1_000;
    state = completeCurrentTurn(SCRIPT, state, t);
  }
  return state;
}

describe("hintDepth / hintAvailable / openHint", () => {
  it("defaults every turn to 'none'", () => {
    expect(hintDepth(createSession(), 1)).toBe("none");
    expect(hintDepth(onLearnerTurn(), 1)).toBe("none");
  });

  it("is unavailable before the start gesture and after the end", () => {
    expect(hintAvailable(SCRIPT, createSession())).toBe(false);
    expect(hintAvailable(SCRIPT, runToEnd(SCRIPT))).toBe(false);
  });

  it("is unavailable on a system turn", () => {
    expect(hintAvailable(SCRIPT, startSession(SCRIPT, 1_000))).toBe(false);
    expect(openHint(SCRIPT, startSession(SCRIPT, 1_000))).toEqual(
      startSession(SCRIPT, 1_000)
    );
  });

  it("is unavailable on a learner turn with no usable ladder", () => {
    const state = onNoLadderTurn();
    expect(hintAvailable(SCRIPT, state)).toBe(false);
    // No-op: the state comes back unchanged, not stuck half-open.
    expect(openHint(SCRIPT, state)).toEqual(state);
  });

  it("first tap: 'none' -> 'situation'", () => {
    const state = onLearnerTurn();
    expect(hintAvailable(SCRIPT, state)).toBe(true);
    const opened = openHint(SCRIPT, state);
    expect(hintDepth(opened, 1)).toBe("situation");
  });

  it("second tap: 'situation' -> 'keywords'", () => {
    const once = openHint(SCRIPT, onLearnerTurn());
    expect(hintAvailable(SCRIPT, once)).toBe(true);
    const twice = openHint(SCRIPT, once);
    expect(hintDepth(twice, 1)).toBe("keywords");
  });

  it("third tap on an already-open ladder is a no-op", () => {
    const twice = openHint(SCRIPT, openHint(SCRIPT, onLearnerTurn()));
    expect(hintAvailable(SCRIPT, twice)).toBe(false);
    const thrice = openHint(SCRIPT, twice);
    expect(thrice).toEqual(twice);
    expect(hintDepth(thrice, 1)).toBe("keywords");
  });

  it("only ever acts on the current turn — no index parameter to misuse", () => {
    // `openHint` reads `state.cursor`, not an argument, so there is no way to
    // open a hint for a turn other than the one on screen.
    const opened = openHint(SCRIPT, onLearnerTurn());
    expect(opened.hints).toEqual({ 1: "situation" });
  });

  it("survives re-recording the same turn — unlike takes and scores", () => {
    const opened = openHint(SCRIPT, onLearnerTurn());
    const recorded = finishRecording(startRecording(opened, 5_000), TAKE);
    const scored = completeScoring(recorded, 1, assessTurn([], []), 1_000);
    const reRecording = startRecording(scored, 9_000);
    // Take and score are gone, per Story 2.2/2.3's rule...
    expect(reRecording.takes[1]).toBeUndefined();
    expect(reRecording.scores[1]).toBeUndefined();
    // ...but the hint depth from before the re-record is untouched.
    expect(hintDepth(reRecording, 1)).toBe("situation");
  });

  it("opening a hint never changes scores, completed turns or canContinue", () => {
    const before = onLearnerTurn();
    const after = openHint(SCRIPT, before);
    expect(after.scores).toEqual(before.scores);
    expect(after.completed).toEqual(before.completed);
    expect(canContinue(SCRIPT, after)).toBe(canContinue(SCRIPT, before));
    // Confirms the two states really do differ — otherwise the assertions
    // above would be trivially true because nothing happened at all.
    expect(after.hints).not.toEqual(before.hints);
  });

  it("both rungs stay visible once opened, after the turn is no longer current", () => {
    // "Scroll back" from the I/O matrix: open both rungs on turn 1, then walk
    // the session past it. The depth recorded for turn 1 must not reset.
    let state = openHint(SCRIPT, onLearnerTurn());
    state = openHint(SCRIPT, state);
    expect(hintDepth(state, 1)).toBe("keywords");
    state = completeCurrentTurn(SCRIPT, state, 6_000);
    state = completeCurrentTurn(SCRIPT, state, 7_000);
    expect(hintDepth(state, 1)).toBe("keywords");
  });

  it("survives the end of the session — same reasoning as scores", () => {
    const opened = openHint(SCRIPT, onLearnerTurn());
    const ended = endSession(opened);
    expect(hintDepth(ended, 1)).toBe("situation");
  });

  it("resets to '{}' on restart, same as takes and scores", () => {
    const opened = openHint(SCRIPT, onLearnerTurn());
    const restarted = startSession(SCRIPT, 50_000, opened);
    expect(restarted.hints).toEqual({});
    expect(hintDepth(restarted, 1)).toBe("none");
  });

  it("is unavailable and a no-op with no script", () => {
    expect(hintAvailable(null, onLearnerTurn())).toBe(false);
    expect(hintAvailable(undefined, onLearnerTurn())).toBe(false);
    const state = onLearnerTurn();
    expect(openHint(null, state)).toEqual(state);
    expect(openHint(undefined, state)).toEqual(state);
  });
});
