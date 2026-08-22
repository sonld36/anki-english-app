import { describe, expect, it } from "vitest";
import type { DialogueScript, DialogueTurn } from "./dialogue/types";
import type { HistoryEntry } from "./history";
import {
  AUDIO_START_GRACE_MS,
  advanceDelayMs,
  audioNote,
  audioTurnToPlay,
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
      { index: 0, speaker: "system", elapsedMs: 2_400 },
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
      status: "running",
      cursor: 99,
      turnStartedAt: 1_000,
      completed: [],
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
      { index: 0, speaker: "system", elapsedMs: 1_000 },
      { index: 1, speaker: "learner", elapsedMs: 4_000 },
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
    });
  });
});


// ---------------------------------------------------------------------------
// The decisions the screen used to make for itself
// ---------------------------------------------------------------------------

describe("audioTurnToPlay", () => {
  const onTurn = (i: number): SessionState => ({
    status: "running",
    cursor: i,
    turnStartedAt: 1_000,
    completed: [],
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
