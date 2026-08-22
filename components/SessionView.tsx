"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { HistoryEntry } from "@/lib/history";
import { SPEAKER_LABELS } from "@/lib/dialogue/types";
import { renderHighlightedHtml } from "@/lib/dialogue/words";
import { useSampleAudio } from "@/hooks/useSampleAudio";
import {
  advanceDelayMs,
  audioNote,
  audioTurnToPlay,
  completeCurrentTurn,
  createSession,
  currentTurnIndex,
  endSession,
  isPracticable,
  micEnabled,
  sessionSummary,
  shouldStopPlayback,
  startSession,
  turnPlan,
  visibleTurnViews,
  type SessionState,
} from "@/lib/session";

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
 * What it does **not** do is as load-bearing as what it does. No recording, no
 * microphone permission, no scoring, no hint content, no attempt limit, no
 * latency metric — those are 2.2–2.7. The mic here means only "I have said it,
 * move on". And the learner's own line is never revealed, on screen *or*
 * through the speaker.
 */

/** One column of the control row, so nothing shifts between states. */
const CONTROL_SLOT = 96;
const MIC_SIZE = 52;

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
  const [session, setSession] = useState<SessionState>(createSession);
  const [nowMs, setNowMs] = useState(() => Date.now());

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
  const micLive = micEnabled(script, session);

  /**
   * The decision of *which* turn may sound — made in the tested module, not
   * here. It is `null` on every learner turn, so no edit to this file can hand
   * `play` a learner index: their line has a blob too (Story 1.4 synthesises
   * both roles), and playing it would reveal the whole sentence aloud.
   */
  const audioTurn = audioTurnToPlay(script, session, audioStatus);

  /**
   * The latest committed values, so callbacks can read them without becoming
   * effect dependencies. `useSampleAudio`'s `play` is rebuilt whenever
   * `playingTurn` changes; depending on it directly would re-trigger playback
   * on every change.
   */
  const live = useRef({
    play: sampleAudio.play,
    playingTurn,
    cursor,
    status: session.status,
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
    const { play, playingTurn: sounding } = live.current;
    if (sounding !== null) play(sounding);
  }, []);

  const advance = useCallback(() => {
    // Nothing from the turn being left behind may still be audible over the
    // next one — least of all a system line playing across the learner's turn.
    stopPlayback();
    setSession((prev) => completeCurrentTurn(script, prev, Date.now()));
  }, [script, stopPlayback]);

  const advanceRef = useRef(advance);

  useEffect(() => {
    advanceRef.current = advance;
    live.current = {
      play: sampleAudio.play,
      playingTurn,
      cursor,
      status: session.status,
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
    if (!shouldStopPlayback(playingTurn, cursor, session.status)) return;
    // Deferred by a tick on purpose: `play()` calls `setState`, and calling it
    // straight from an effect body is the `react-hooks/set-state-in-effect`
    // error this story must not add a fourth of.
    const id = setTimeout(() => {
      const s = live.current;
      if (!shouldStopPlayback(s.playingTurn, s.cursor, s.status)) return;
      stopPlayback();
    }, 0);
    return () => clearTimeout(id);
  }, [playingTurn, cursor, session.status, stopPlayback]);

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
    });
    // `null` means schedule nothing: a learner turn (only the mic ends it), or
    // a line still sounding (this effect re-runs when it stops).
    if (delay === null) return;

    // Deliberately a timer and not a synchronous advance — same lint rule.
    const id = setTimeout(() => advanceRef.current(), delay);
    return () => clearTimeout(id);
  }, [cursor, turnStartedAt, isSounding, awaitPlayback, minDwellMs, fallbackMs]);

  // The clock. Counts up from when the turn went on screen; no limit, no
  // countdown, nothing happens at any mark.
  useEffect(() => {
    if (session.status !== "running") return;
    const id = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(id);
  }, [session.status]);

  const elapsedMs =
    turnStartedAt === null ? 0 : Math.max(0, nowMs - turnStartedAt);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.cursor, session.status]);

  // Both gestures silence audio first. Without it "Luyện lại" calls `play(0)`
  // while turn 0 is still the sounding turn — and `play` *toggles*, so the
  // restart would stop turn 0 instead of starting it, and the session would
  // open in silence.
  const handleStart = () => {
    stopPlayback();
    setSession(startSession(script, Date.now()));
  };
  const handleEnd = () => {
    stopPlayback();
    setSession((prev) => endSession(prev));
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
              Đến lượt bạn, nút mic mở ra — nói câu của bạn rồi bấm mic để đi tiếp.
            </p>
            <p style={{ fontSize: "13px", color: "var(--ink-muted)", lineHeight: 1.6 }}>
              Câu của bạn không hiện trên màn hình. Đó là phần bạn phải tự bật ra.
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
                      {isCurrent
                        ? "··· lượt của bạn — nói ra thành tiếng"
                        : "··· lượt của bạn"}
                    </span>
                  )}
                </div>

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
        {/* Hint slot. Empty of content on purpose — the ladder is Story 2.4;
            the slot exists now so the row never changes shape later. */}
        <div style={{ width: CONTROL_SLOT, display: "flex", justifyContent: "flex-start" }}>
          <button
            type="button"
            disabled
            title="Thang gợi ý sẽ mở ở bước sau"
            aria-label="Thang gợi ý: chưa dùng được"
            style={{
              ...ghostButton,
              borderStyle: "dashed",
              color: "var(--ink-muted)",
              cursor: "not-allowed",
              opacity: 0.6,
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
          aria-label={`Thời gian lượt này: ${formatClock(elapsedMs)}`}
        >
          {formatClock(elapsedMs)}
        </div>

        <div style={{ width: CONTROL_SLOT, display: "flex", justifyContent: "flex-end" }}>
          {/* The disabled state IS the "chưa tới lượt bạn" signal — DESIGN.md
              rules out a separate turn badge. So it must not be carried by
              colour alone: the shape changes (solid fill vs dashed outline),
              the accessible name says it in words, and `aria-disabled` says it
              semantically.

              `aria-disabled` rather than `disabled`: this is the button the
              learner has just pressed, and a real `disabled` on the focused
              element drops focus to `<body>`, so a keyboard user re-tabs from
              the top of the page every single turn. It stays focusable and
              inert. */}
          <button
            type="button"
            onClick={() => {
              if (!micLive) return;
              advance();
            }}
            aria-disabled={!micLive}
            aria-label={
              micLive
                ? "Micro đang mở: bấm khi bạn đã nói xong câu của mình"
                : "Micro đang tắt: chưa tới lượt bạn"
            }
            title={
              micLive
                ? "Bấm khi bạn đã nói xong"
                : "Chưa tới lượt bạn"
            }
            style={{
              width: MIC_SIZE,
              height: MIC_SIZE,
              borderRadius: "var(--radius-full)",
              fontSize: "22px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: micLive ? "var(--chrome)" : "transparent",
              color: micLive ? "var(--surface-base)" : "var(--ink-muted)",
              border: micLive
                ? "2px solid var(--chrome)"
                : "2px dashed var(--border-hairline)",
              cursor: micLive ? "pointer" : "not-allowed",
              opacity: micLive ? 1 : 0.55,
              transition: "background 0.15s ease, opacity 0.15s ease",
            }}
          >
            <span aria-hidden="true">🎤</span>
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
