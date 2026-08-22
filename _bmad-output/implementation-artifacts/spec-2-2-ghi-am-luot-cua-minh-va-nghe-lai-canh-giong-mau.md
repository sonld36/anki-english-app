---
title: 'Story 2.2: Ghi âm lượt của mình và nghe lại cạnh giọng mẫu'
type: 'feature'
created: '2026-08-22'
status: 'done'
baseline_commit: 'dd3368133804bc794768870c0af273e661294651'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-1-dien-kich-ban-theo-luot-trong-khung-chat.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On `/session` the mic is a bare "I've said it" button — nothing is captured, so the
learner never hears themselves and has nothing to compare against. Story 2.3 cannot score what was
never recorded.

**Approach:** Capture the learner's turn as 16 kHz/16-bit mono PCM in a WAV container via the
existing AudioWorklet, trim leading/trailing silence, keep the take in IndexedDB under its own
`recordings` namespace for the length of the session, and give the just-recorded turn two play
controls — their own take and the native sample — plus an explicit "Tiếp" step so a turn no longer
ends the instant the mic stops.

## Boundaries & Constraints

**Always:**
- Recording is `PCM 16 kHz, 16-bit, mono` in WAV, captured through `public/audio-processor.worklet.js`.
  Tap to start, tap again to stop — never press-and-hold.
- Every decision worth a test lives in a pure `lib/` module — `vitest` runs `environment: "node"`,
  no jsdom. Browser hooks stay thin enough that nothing testable hides inside them.
- The learner's line is still **never rendered as text**, at any point, in any projection.
- Replay is unlimited, local-only: no `/api/pronunciation` call, no `/api/tts` call, no quota spend.
- Takes are cleared at session end and at session start (a reload mid-session orphans blobs);
  cleanup targets the `recordings` namespace only and must never touch `"tts"`.
- Every state carries a glyph **and** words: no state by colour alone. The recording glow on the mic
  is the one sanctioned shadow.
- The control row keeps its three fixed slots (hint · timer · mic) in every state. "Tiếp" belongs to
  the turn bubble, not the row.

**Ask First:**
- Persisting takes beyond one session, or uploading a take anywhere.
- Adding a fourth control to the sticky row, or any per-turn attempt counter (that is Story 2.5).

**Never:**
- `MediaRecorder` (it yields webm/opus).
- Scoring, phoneme feedback, attempt limits, hint content, latency measurement — Stories 2.3–2.6.
- A privacy disclosure about voice leaving the device: nothing leaves the device in this story;
  it is deferred to 2.3.
- Deleting or rewriting `public/audio-processor.worklet.js` — shared infrastructure.
- Blaming the microphone to excuse a result. The low-amplitude notice is a signal diagnostic only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Record a turn | learner turn on screen, mic tapped, tapped again | take trimmed, stored under `recordings`, turn enters `recorded`; both play controls appear; "Tiếp" enabled | N/A |
| Replay own take | a turn already recorded, this or an earlier one | take plays from IndexedDB, unlimited times, zero network | missing blob → that control reports it is gone, turn still advances |
| Native sample locked | learner turn, nothing recorded yet | no sample control exists; autoplay still returns `null` for learner turns | N/A |
| Native sample unlocked | same turn after a take exists | sample control plays that line's cached audio | sample never generated → control absent, take control unaffected |
| Re-record | turn already `recorded`, mic tapped again | previous take replaced, phase back to `recording`; no counter is kept | N/A |
| Permission denied | `getUserMedia` rejects `NotAllowedError` | one Vietnamese notice: why the mic is needed + how to re-enable; not asked again this session | mic stays inert, session still advances via "Tiếp" |
| No microphone / worklet fails | `NotFoundError`, or worklet load throws | distinct Vietnamese notice; partial capture state torn down (stream stopped, context closed) | as above |
| Peak too low | take's peak level below threshold | take is kept and playable, plus a `!` + worded warning that the wrong mic may be selected | N/A |
| Silence-only take | trimmed take has no samples left | treated as an empty take: not stored, worded notice, phase returns to `idle` | N/A |
| Session ends / restarts | "Kết thúc buổi", or a new session starts | `recordings` namespace dropped, fire-and-forget; `"tts"` untouched | rejection swallowed, never fails the UI |

</frozen-after-approval>

## Code Map

- `lib/wav.ts:10,19-48,51-60` -- `SAMPLE_RATE = 16000`, `encodeWav(chunks: Int16Array[], sampleRate?): Blob`,
  `peakLevel(chunks): number` (max |s|/32768). Already pure and node-testable; **no test file exists yet**.
  `writeAscii` at `:12-16` is module-private. Trimming does **not** exist anywhere in the repo.
- `app/lab/pronunciation/page.tsx:170-237` -- the working reference capture loop, and the source of the
  leaks to fix when extracting: `:203-208` one `catch` for getUserMedia + AudioContext + worklet with no
  teardown of partial state and no `NotAllowedError` discrimination; no unmount cleanup; `streamRef` never
  nulled; last object URL never revoked. `:234` hides the `peak < 0.05` threshold in a JSX string.
  `:185` `new AudioContext({ sampleRate: 16000 })` — there is no resampling code, the browser does it.
  `:194-201` the silent-gain graph-priming trick. Leave this page untouched.
- `public/audio-processor.worklet.js:28,33` -- processor name `"audio-capture-processor"`; one-way
  `postMessage(int16.buffer, [transfer])`, no envelope, no start/stop protocol. `_buffer`/`_bufferSize`
  at `:8-9` are dead — chunks arrive per 128-frame quantum (~8 ms).
- `lib/session.ts` -- `SessionStatus` `:44`, `CompletedTurn` `:47-51`, `SessionState` `:53-63`,
  `completeCurrentTurn` `:110` (the single advance transition, inert unless `running`), `TurnView` `:167-174`,
  `visibleTurnViews` `:190`, `currentTurnIndex` `:203`, `micEnabled` `:219`, `turnPlan` `:306`
  (learner ⇒ `fallbackMs: null`), `audioTurnToPlay` `:368` (**autoplay** leak rule — keep returning `null`
  for learner turns), `advanceDelayMs` `:410`, `shouldStopPlayback` `:437`, `audioNote` `:473`.
- `components/SessionView.tsx:585-588` -- mic `onClick` calls `advance()` directly; `advance` at `:127-132`
  (`stopPlayback()` then `completeCurrentTurn`). `:518-535` control row, slots `CONTROL_SLOT=96` `:45`,
  `MIC_SIZE=52` `:46`; `:572-589` the mic invariant comment + `aria-disabled` (not `disabled`, which drops
  focus). Timer `:556-569`, `elapsedMs` `:217-218`. Learner placeholder bubble `:450-456`. Playback stop
  orchestration `:122-125`, `:162-173`, `:230`, `:235`.
- `lib/blob-store.ts:32,128-193,197-215` -- `blobId`, `putBlob/getBlob/hasBlob/deleteBlob/deleteNamespace`,
  `NamespacedBlobStore`, `namespacedBlobStore(ns)`. Fully general, **needs no change**; `deleteNamespace`
  cursors `by_namespace` with `IDBKeyRange.only(ns)`, so dropping `recordings` provably leaves `"tts"` alone.
  Transaction-level settling at `:94-120` is what surfaces `QuotaExceededError`.
- `lib/sample-audio.ts:14,102-106,197` -- `SAMPLE_AUDIO_NAMESPACE = "tts"`; `SampleAudioStore` is the
  injected-store interface to mirror (a structural subset of `NamespacedBlobStore`); `classifyStorageError`
  is the existing quota/error classifier. Content hashing at `:43-52` is **not** reusable here — each take is
  unique audio, so a content hash is the wrong key.
- `lib/history.ts:170-184` -- `clear()` drops `"tts"` fire-and-forget; the comment explains why content-keyed
  blobs forbid per-entry cleanup. Recordings are per-take keyed, so that caveat does **not** apply to them.
- `hooks/useSampleAudio.ts:77-91,235-299` -- `statuses`/`playingTurn`/`play`/`notice`; `play(i)` while
  `playingTurn === i` **stops** it, there is no `stop()`; state is keyed on script **object identity**
  (`:120-121,157,240`). `play` on a learner index works — the refusal lives in `lib/session.ts`, not here.
- `_bmad-output/.../ux-designs/.../DESIGN.md:39-50,52,123-124,131-132,144-146,157,163-164` -- 4px spacing
  scale and radii, 52px `full`-radius mic, fixed row order, the green recording glow as the only shadow,
  disabled-mic-is-the-turn-indicator, `tabular-nums` count-up timer, mandated glyphs.
  `EXPERIENCE.md:45-48,56,111,139-145` -- coach voice ("Bạn", specific, no filler), never blame the mic,
  permission-denied rule (say why, say how to re-enable, do not ask twice), glyph+word pairs.
  Neither document specifies the replay UI, the permission copy, or a peak threshold — all authored here.

## Tasks & Acceptance

**Execution:**
- [x] `lib/wav.ts` -- add `trimSilence(chunks: Int16Array[], opts?): Int16Array[]` and export the
  low-peak policy as a named constant plus a predicate, replacing the magic `0.05` buried in the lab page.
  Pure, same `Int16Array[]` shape as the existing exports -- keeps the whole audio maths node-testable.
- [x] `lib/wav.test.ts` -- new: WAV header bytes at the documented offsets, chunk concatenation,
  peak normalisation, and the trimming matrix rows (silence-only, silence-both-ends, no silence,
  a take shorter than the window).
- [x] `lib/recording.ts` -- new pure module: `RECORDING_NAMESPACE`, a per-take key derived from entry id +
  turn index (**not** a content hash), an injected `RecordingStore` interface mirroring `SampleAudioStore`,
  the store/replace/clear decisions, and the mapping from a capture failure to its Vietnamese notice.
- [x] `lib/recording.test.ts` -- new: covers the matrix rows this module owns -- re-record replaces,
  empty take is refused, permission-denied vs no-device vs generic map to distinct notices, quota is
  classified, and clearing touches only its own namespace.
- [x] `lib/session.ts` -- grow the state machine: a per-turn phase (`idle | recording | recorded`) with its
  start stamp, `micAction` (record | stop | disabled) so the button's meaning is decided in the tested
  module, `canContinue`, the recording transitions, `completeCurrentTurn` refusing to fire mid-recording,
  a take reference on `CompletedTurn` and on `TurnView`, the clock basis while recording, and a **separate**
  projection for the unlocked native sample. `audioTurnToPlay` keeps returning `null` for learner turns.
- [x] `lib/session.test.ts` -- extend: the mic no longer advances on its own, no timer can fire mid-recording,
  the sample is locked before a take exists and unlocked after, an earlier turn's take stays replayable,
  and the existing leak sweep still finds no learner text or target word in any projection.
- [x] `hooks/useTurnRecorder.ts` -- new thin browser wrapper: `getUserMedia` → AudioWorklet → chunk
  accumulation → `trimSilence` → `encodeWav` → store; plus take playback. Owns teardown on stop, on error,
  and on unmount -- the leaks listed in the Code Map must not be reproduced.
- [x] `components/SessionView.tsx` -- wire it: mic toggles recording (glow while live, glyph and accessible
  name change with `micAction`), the recorded turn bubble grows two play controls and a "Tiếp" button,
  completed learner bubbles keep their controls, notices render with glyph + words, and playback stops
  before recording starts.
- [x] `app/globals.css` -- the recording glow and the take-player/notice styles, on the DESIGN tokens and the
  4px scale, scoped under `.session-screen` so no existing screen is repainted.
- [x] `AGENTS.md` -- document the `recordings` namespace and its session-scoped lifetime, `lib/recording.ts`,
  `lib/wav.ts` as the pure audio-maths module, and the narrowed reveal rule: the learner's line is never
  *shown*, and its audio unlocks only after a take exists.

**Acceptance Criteria:**
- Given a learner turn, when the mic is tapped and tapped again, then the turn stays on screen with the take
  playable and no timer advances it -- only "Tiếp" does.
- Given a completed learner turn scrolled back to, when its take control is used, then it plays with zero
  network requests to `/api/tts` or `/api/pronunciation`.
- Given a session that has recorded takes, when it ends or a new one starts, then the `recordings` namespace
  is empty and previously cached sample audio still plays.
- Given the branch, when `npm test`, `npx tsc --noEmit` and `npm run build` run, then all pass cleanly and
  `npm run lint` has not gained a new error.

## Spec Change Log

**2026-08-23 — implementation decisions** (no intent renegotiated):

- **The unlocked sample is `sampleReplayUnlocked`, a second projection, exactly as the
  Design Notes require.** `audioTurnToPlay` is untouched and still returns `null` for every
  learner turn under every audio status; a test pins that it stays `null` even on a turn that
  *has* a take, so the two rules cannot quietly merge.
- **"Tiếp" needed a second way to open, or a denied microphone dead-ends the session.**
  `canContinue` opens on `phase === "recorded"` **or** `micBlocked`. That is what makes the
  matrix's "mic stays inert, session still advances via Tiếp" true, and it is why *every*
  capture failure — not only a denial — sets `micBlocked`: the matrix's no-device/worklet row
  points at the same handling.
- **`shouldStopPlayback` grew a context argument, because the reaper would otherwise kill
  every replay.** A scrolled-back turn is by definition not the turn on screen, and a replay
  after "Kết thúc buổi" is by definition not `running` — both conditions the Story 2.1 reaper
  exists to catch. `replayTurn` marks a deliberate replay; `phase: "recording"` silences
  everything, since nothing may sound into a live microphone. The three-argument call sites
  behave exactly as before, and a test pins that.
- **Takes are cleared on `session.status === "finished"`, not inside "Kết thúc buổi".**
  A session also ends by running out of turns, which no gesture of the user's marks; watching
  the transition catches both. `endSession` and the final `completeCurrentTurn` clear
  `state.takes` in step with it, so no control is left offering a blob that has been deleted.
  `CompletedTurn.take` keeps the record of what happened; `state.takes` is what is still
  *playable*.
- **`startSession` takes an optional previous state, and carries `micBlocked` across a
  restart only.** "Luyện lại" must not re-prompt a microphone the browser has already refused
  — EXPERIENCE.md's "không xin lại lần nữa". Takes are deliberately *not* carried over: the
  blobs are dropped at the same moment.
- **`micAction` returns three values, not a boolean.** Glyph, accessible name, glow and
  `aria-pressed` all hang off it, and "tap to start, tap again to stop — never
  press-and-hold" is a frozen constraint that a stray `onMouseDown` could break silently.
  One `onClick`, one tested predicate.
- **`advanceDelayMs` gained `isRecording` even though it is redundant today.** Only learner
  turns can be recorded and they already have `fallbackMs: null`. Stating it anyway makes "no
  timer may cut a take short" a rule about recording rather than a side effect of where
  recording currently happens to be allowed.
- **The recording glow is green, not red.** DESIGN.md and the epic context both say *quầng
  sáng xanh*; a danger colour would also collide with "Chưa đạt" in Story 2.3. The mic keeps
  `--chrome` in both live states and is separated by glyph (`🎤`/`⏹`), accessible name and
  `aria-pressed`. `prefers-reduced-motion` drops the pulse and keeps the ring.
- **Pitfall found while verifying: `color-mix()` is unsafe in `globals.css`.** lightningcss
  emits a fallback for it outside `@keyframes`, and for
  `color-mix(in srgb, var(--chrome) 45%, transparent)` that fallback is the bare
  `var(--chrome)` — the alpha silently gone, so the reduced-motion glow rendered as a hard
  opaque ring while the identical declaration inside `@keyframes` was left correct. Replaced
  with literal `rgba()` values scoped to `.session-screen` (`--glow-record*`), which keeps the
  11-colour token layer untouched. Recorded in `AGENTS.md`.
- **The lab page's `peak < 0.05` now calls `isPeakTooLow`.** One token, and the only way the
  "replacing the magic 0.05" task can actually be true. Its capture loop is otherwise
  untouched, per the Code Map.
- **Two leaks the Code Map named are handled, plus one it did not.** `hooks/useTurnRecorder.ts`
  tears the graph down when construction throws (a rejected `addModule` otherwise leaves the
  microphone live), nulls every ref, revokes the object URL, and stops everything on unmount.
  The extra one: "Kết thúc buổi" pressed while the permission prompt is still open means
  `start()` resolves onto a session that no longer wants it — hence `recorder.cancel()`, and a
  `micBusy` ref so a second tap cannot fire a second `getUserMedia` during the prompt.
- **Threshold values chosen here, since no document specifies them:** `SILENCE_THRESHOLD =
  0.02` for trimming and `TRIM_PADDING_MS = 80` (cutting exactly at the first loud sample
  clips the onset of `/p/ /t/ /k/` — the very thing Story 2.3 scores). A test pins
  `SILENCE_THRESHOLD < LOW_PEAK_THRESHOLD`: if they ever crossed, a take could be trimmed to
  nothing *and* reported as merely quiet, which are two different messages.


**2026-08-23 — review round 1** (20 findings across three reviewers; all verified against the
code before patching, none rejected; no intent renegotiated):

- **The mic could be left open.** `endSession`/`startSession` set `phase: "idle"`, so the stop
  button vanished while the `MediaStream` and `AudioContext` stayed live with the browser's
  recording indicator lit and nothing left that could close them. `stopTake` only silenced
  *playback* — and its name is what made the mistake easy to write, so it is now
  `stopTakePlayback` and both handlers call `recorder.cancel()`. `start()` also checks
  `mounted` after each await (a `getUserMedia` that resolves post-unmount used to build the
  whole graph after cleanup had run), and the unmount path now calls the same two teardown
  functions the rest of the hook uses instead of repeating the sequence inline.
- **"Nothing may sound into a live microphone" held on one channel only.** `shouldStopPlayback`
  governs the sample channel; take playback has its own `<audio>` element and consulted
  nothing, so an earlier take played its full length into an open mic. The rule moves into
  `takeReplayUnlocked`, which now returns `false` while `phase === "recording"` — and
  `SessionView` reads that predicate instead of `view.take`, which also fixes it having been
  exported, tested, and consumed by nothing.
- **`useSampleAudio` gained a real `stop()`.** `play(playingTurn)` is a toggle that only works
  once `playingTurn` is set, and it is set *after* an async IndexedDB read — so a sample
  tapped a beat before the mic tap no-opped, and the native reading of the learner's own line
  bled into the start of their take until the reaper caught it a tick later. `stop()` bumps
  the play token, so a read still in flight is superseded and never sounds.
- **A failed write dead-ended the session.** `canContinue` opened only on a take or
  `micBlocked`, while `STORE_FAILURE_NOTICES.quota` promised "buổi luyện vẫn đi tiếp bình
  thường" — on a full disk every retry failed identically and the only exit was "Kết thúc
  buổi". Hence `takeBlocked`, a second flag: it opens the exit **without** making the mic
  inert. Set by a store failure, a no-signal capture, and any *transient* capture failure.
- **`micBlocked` is now only for failures a retry cannot fix** (`isPermanentCaptureFailure`:
  a denial, or no device). A busy microphone or a one-off worklet fetch used to kill the mic
  for the whole session — a permanent punishment for a temporary fault. Flagged in the
  previous report; now fixed rather than merely noted.
- **`micBusy` guarded the record branch only.** A second tap during `stop()`'s IndexedDB write
  re-entered, found `chunksRef` drained, reported `empty` first and ran `cancelRecording` —
  orphaning a take that had in fact been written and telling the learner "Không thu được tiếng
  nào" about a success. Both branches are guarded.
- **`no-signal` split from `empty`.** iOS and Safari hand back a *suspended* `AudioContext`;
  the worklet then never runs, no chunk arrives, and every take looked like silence answered
  with "nói to hơn một chút" — advice that could not work. `start()` calls `ctx.resume()`, and
  `stop()` reports "not one sample arrived" as its own outcome with its own notice and an exit.
- **`classifyCaptureError` missed the everyday case.** `NotReadableError` / `TrackStartError` /
  `AbortError` (the mic held by a video call or another tab) fell into `unavailable`, whose
  copy blamed the browser; they are now `device-busy` with actionable copy. `OverconstrainedError`
  mapped to `no-device` — telling the user to buy a microphone because of a constraint *we*
  asked for — and is now `unavailable`; the constraint itself became `channelCount: { ideal: 1 }`.
- **`autoGainControl` is off.** It normalises level, which is exactly what `peakLevel` /
  `isPeakTooLow` measure: with it on, the low-signal diagnostic this story ships could never
  fire.
- **`clearTakes` is sequenced.** A `deleteNamespace` cursor still running from the session
  start could sweep away the new session's first take; the promise is tracked and `stop()`
  awaits it before writing.
- **Object URLs are revoked when playback ends naturally**, not only when it is stopped.
- **Copy:** both capture notices told the user to reload — which discards every completed turn
  of an in-memory session — and the denial copy gave desktop-only "lock icon" guidance on a
  mobile-first screen. Both reworded; a test now pins that no capture notice says "rồi tải lại
  trang".
- **Accessibility and tokens:** `aria-pressed` is omitted while the mic is disabled (it
  announced "toggle button, not pressed" where the message is "chưa tới lượt bạn"); the mic
  gets a distinct accessible name when it is inert *during the learner's own turn*, so the
  only turn indicator stops lying; `MIC_GLYPH.disabled` is no longer identical to
  `MIC_GLYPH.record`; the notice lives inside a **persistent** `role="status"` wrapper (several
  screen readers ignore a region that mounts with its first message) while the inner node keeps
  its key; `.session-chip` and the ✕ gained `:focus-visible` and a 44px target; and the three
  `RecordingNotice.tone` values finally have three CSS modifiers each instead of every notice
  rendering as a warning with `tone` inert. `.session-chip`'s `999px` became `--radius-lg` —
  **not** `--radius-full`, which is `50%` in this token layer (a circle, for the 52px mic) and
  would render a wide chip as an ellipse.
- **`RecordingStore.delete` removed** — declared, faked in tests, called by nothing.
  `putBlob` already overwrites, which is what re-recording needs.
- **Tests (+17, 405 → 422):** `endSession` and `startSession` driven from mid-capture (the gap
  that let the first finding ship); `blockMic` / `blockTake` including on a non-running
  session; `takeReplayUnlocked` sealed mid-capture; a two-declarations-one-test pin that
  `state.takes[i].key === recordingKey(entryId, i)` (the map is keyed by `state.cursor` while
  the blob is keyed by the index passed to `stop()`, and nothing else made them agree); the
  four capture failures and their permanence; `no-signal` vs `empty`; and the toothless
  `expect(JSON.stringify(again)).not.toMatch(/attempt|tries/i)` replaced by an exhaustive key
  list that actually fails when a field is added.
- **Two stale comments corrected:** `PlaybackContext` justified protecting a replay after
  "Kết thúc buổi", a state the UI can no longer reach (takes are cleared at session end); and
  the AGENTS.md Story 2.1 bullet still said a learner turn is ended "only by the mic".

## Design Notes

**Why the mic stops meaning "next".** In 2.1 one tap both ended the turn and advanced it. A take has to be
listened to, so the turn must survive the tap. Splitting the exit into *stop recording* and *continue* is
also what leaves room for 2.3's score card and 2.5's retry to attach without moving the control row.

**Why the sample unlocks rather than stays sealed.** 2.1's invariant was "the learner's line never reaches
the speaker". This story's whole point is hearing yourself against the model, so the rule narrows: never
before a take exists, always available after. It is enforced as a *second, distinct* projection — the
autoplay path (`audioTurnToPlay`) keeps returning `null` unconditionally for learner turns, so the existing
leak tests keep meaning exactly what they say, and the text of the line is still never rendered at all.

**Why a per-take key, not a content hash.** `lib/sample-audio.ts` hashes voice+text because two identical
lines should share one blob. Two takes are never identical and must never be shared, so the key is
positional. That also makes per-entry cleanup safe here, unlike the `"tts"` namespace.

## Verification

**Commands:**
- `npm test` -- expected: all pass, including new `lib/wav.test.ts` and `lib/recording.test.ts`.
- `npx tsc --noEmit` -- expected: clean.
- `npm run build` -- expected: clean.
- `npm run lint` -- expected: still exactly the 3 known `react-hooks/set-state-in-effect` errors
  (`app/page.tsx:15`, `app/practice/page.tsx:18`, `components/HistoryPanel.tsx:19`), no new error.

**Manual checks (if no CLI):**
- Run a session: record a turn, stop, play the take, play the sample, tap "Tiếp"; scroll back and replay an
  earlier take. DevTools Network filtered to `api/` shows no request throughout.
- Deny the microphone permission in site settings and reload: one notice explains why and how to re-enable,
  it is not asked again, and "Tiếp" still moves the session on.
- Application → IndexedDB → `ankichat_blobs`: `recordings:` keys appear while the session runs and are gone
  after "Kết thúc buổi"; `tts:` keys survive.
- `rm -rf .next` before judging any CSS change (Turbopack serves a stale `globals.css`).

## Suggested Review Order

**The turn no longer ends when the mic stops**

- The whole design in one shape: a turn's phase, its take, and what may sound.
  [`session.ts:67`](../../lib/session.ts#L67)

- Recording starts; any previous take of that turn is dropped, not accumulated.
  [`session.ts:217`](../../lib/session.ts#L217)

- What the mic means right now — record, stop, or "chưa tới lượt bạn".
  [`session.ts:455`](../../lib/session.ts#L455)

- The second exit. Also opens when the mic or the write failed, so nothing strands the learner.
  [`session.ts:481`](../../lib/session.ts#L481)

- Advancing now refuses to fire mid-capture; only "Tiếp" ends a learner turn.
  [`session.ts:289`](../../lib/session.ts#L289)

**The reveal rule, narrowed rather than broken**

- The native sample unlocks only once a take exists — a second, distinct projection.
  [`session.ts:508`](../../lib/session.ts#L508)

- The learner's own take, sealed while capture is live. Both channels, one rule.
  [`session.ts:536`](../../lib/session.ts#L536)

- Autoplay still refuses every learner turn unconditionally, so 2.1's leak tests keep their meaning.
  [`session.ts:807`](../../lib/session.ts#L807)

**Capture, and everything that can go wrong with it**

- Silence is trimmed off both ends; an empty result means nothing was said.
  [`wav.ts:154`](../../lib/wav.ts#L154)

- Weak is not absent: two thresholds, one discards a take, one only warns.
  [`wav.ts:108`](../../lib/wav.ts#L108)

- Five failures, told apart by name — a busy mic is not a missing one.
  [`recording.ts:90`](../../lib/recording.ts#L90)

- Which failures kill the mic for the session, and which allow another try.
  [`recording.ts:143`](../../lib/recording.ts#L143)

- Per-take positional keys, never a content hash: two takes are never the same audio.
  [`recording.ts:38`](../../lib/recording.ts#L38)

**The browser half, kept thin on purpose**

- getUserMedia → worklet → trim → WAV → store, with teardown on every exit path.
  [`useTurnRecorder.ts:202`](../../hooks/useTurnRecorder.ts#L202)

- The one place teardown lives; unmount calls it rather than repeating it.
  [`useTurnRecorder.ts:151`](../../hooks/useTurnRecorder.ts#L151)

- A real `stop()` at last, so a sample cannot start after the toggle no-ops.
  [`useSampleAudio.ts:246`](../../hooks/useSampleAudio.ts#L246)

**Wiring**

- One tap starts, the next stops; both branches guarded against a double tap.
  [`SessionView.tsx:395`](../../components/SessionView.tsx#L395)

- Ending or restarting a session releases a live microphone.
  [`SessionView.tsx:377`](../../components/SessionView.tsx#L377)

**Tests**

- The leak sweep, now walking recorded and re-recorded states too.
  [`session.test.ts:963`](../../lib/session.test.ts#L963)

- Two declarations, one test: the take map's key must equal the blob's key.
  [`session.test.ts:1185`](../../lib/session.test.ts#L1185)

- The trim matrix, including the take that is nothing but silence.
  [`wav.test.ts:137`](../../lib/wav.test.ts#L137)

- Clearing takes leaves the sample-audio namespace untouched.
  [`recording.test.ts:158`](../../lib/recording.test.ts#L158)
