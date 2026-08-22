---
title: 'Story 2.1: Diễn kịch bản theo lượt trong khung chat'
type: 'feature'
created: '2026-08-22'
status: 'done'
baseline_commit: '5166917296651f4bf2815055c3b4547aba07a57e'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4-giong-mau-ban-ngu-sinh-mot-lan.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 1 produces a structured script with per-turn hints and cached native audio, but the only way to practise it is `VoicePractice.tsx` on Gemini Live — a two-way path Epic 2 replaces wholesale. There is no screen that walks a script one turn at a time, and 2.2–2.7 all bolt onto that screen, so nothing in Epic 2 can start until it exists.

**Approach:** A new additive route `/session?id=…` that plays the system's turns (cached audio + text) and stops at each learner turn behind a disabled-until-your-turn mic button, never revealing the learner's line. The turn cursor lives in a pure, node-testable state machine; the screen is a thin renderer. Ship the DESIGN.md two-mode token layer alongside it so no later story has to guess whether one mode or two exists.

## Boundaries & Constraints

**Always:**
- The learner's `turn.text` is **never** rendered, in any state, at any point. Their turn shows a placeholder only. (The single sanctioned reveal is Story 2.5's third-failure path — not this story.)
- The old path `/practice → VoicePractice.tsx → useGeminiLive → /api/live-token` keeps working untouched. Story 2.8 removes it, and only after the new screen works.
- Bottom control row holds its position in every state: hint slot left · timer centre · mic right. Controls never move while the learner is trying to speak.
- The mic button's **disabled state is the only turn indicator**. No separate "your turn" badge.
- No state is conveyed by colour alone — every status carries a glyph plus words, reachable by a screen reader.
- Audio is optional to the flow: a turn with missing or failed audio still shows its text and still advances. Silence must never strand the learner.
- The script object handed to `useSampleAudio` must be referentially stable (memoized) — the hook keys all state on object identity.
- All colours the new screen introduces go through the new tokens. Spacing stays on the 4px scale.

**Ask First:**
- Adding any dependency (a jsdom/testing-library setup, a state library, an animation library).
- Persisting session data to `localStorage` or IndexedDB — deliberately out of scope here.
- Changing, renaming, or removing any of the 18 existing `--bg-*/--accent-*/--text-*` variables.

**Never:**
- No recording, no microphone permission request, no scoring, no hint content, no attempt limit, no latency metric, no end-of-session summary — those are 2.2–2.7. The mic button in this story only confirms "I've said it" and advances.
- No theme toggle and no Settings surface; no `prefers-color-scheme` (DESIGN.md:78 explicitly rejects OS-following).
- Do not repaint the existing screens. Retiring the purple `#7c3aed` / blue `#3b82f6` palette across the 9 files that use it is separate deferred work.
- Do not modify or delete `VoicePractice.tsx`, `useGeminiLive.ts`, `/api/live-token`, or the recording worklet.
- Do not add a 4th `react-hooks/set-state-in-effect` error — derive the entry during render, don't `setNotFound` in an effect.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Entry with a v3 script, audio cached | "Bắt đầu buổi" → system turns play audio + show text; learner turns show a placeholder and enable the mic; tapping it advances | N/A |
| Learner turn | Cursor on a `learner` turn | Placeholder bubble, mic enabled, timer counts up from turn display | N/A |
| System turn | Cursor on a `system` turn | Text shown immediately, audio plays, advance when playback ends | N/A |
| Audio missing/failed | `statuses[i]` is `failed`/`idle` | Text still shown, advance after a readable delay | No error surfaced; flow continues |
| Autoplay blocked | Browser refuses playback | Session still advances on the timed fallback | Never silently stalls on a turn |
| v2 script | `script.version === 2`, no hints | Runs identically — this story reads no hints | N/A |
| Legacy entry | `script: null` + `legacyDialogue` | Explicit Vietnamese state: not practicable turn-by-turn, offer `/practice?id=` | Not a crash, not an empty screen |
| Missing / unknown `id` | No `?id=`, or no matching entry | Vietnamese empty state + route back to `/` | Mirrors `app/practice/page.tsx:30-57` |
| End mid-session | "Kết thúc buổi" tapped at any point | Finished state showing turns completed so far | In-memory stats survive the transition |
| All turns done | Cursor past the last turn | Finished state, mic disabled | N/A |

</frozen-after-approval>

## Code Map

- `app/practice/page.tsx:8-11,13-28,136-155` -- **pattern to mirror**: `useSearchParams().get("id")`, notFound→loading→content render order, `Suspense` at the default export. Derive the entry instead of `setNotFound` in an effect (`:18` is a known lint error). Leave this file untouched.
- `lib/history.ts:129-131` -- **no `getById`**; only `getAll()`, read one via `.find(e => e.id === id)`. `HistoryEntry` at `:8-28`.
- `hooks/useSampleAudio.ts:107` -- `useSampleAudio(script: DialogueScript | null)`. Returns `statuses: Record<number, SampleAudioStatus>` (`:79`), `playingTurn: number | null` (`:81`), `play(turnIndex): void` (`:84`), `notice: string | null` (`:90`). **Zero coupling to `DialogueDisplay`.**
  - `:147-219` -- generation effect keyed `[script]`; with blobs present nothing hits `/api/tts`.
  - `:235-299` -- `play` is fire-and-forget with **no completion callback**; `play(i)` while `playingTurn === i` **stops** it (`:245-251`). No `replay()`.
  - `:295` -- **hazard**: `audio.play().catch(clear)` swallows a blocked autoplay — no error, no notice.
  - `:120-121,157,240` -- state keyed on script **object identity**; a fresh object per render resets statuses and makes `play` a no-op.
- `lib/sample-audio.ts:17` -- `SampleAudioStatus = "idle" | "fetching" | "ready" | "failed"`. `idle` = still queued; `failed` = not coming.
- `lib/dialogue/types.ts:81-97` -- `DialogueTurn { index, speaker, text, targetWords, hints? }`; `index` always equals array position, safe as audio key and React key. `:107-110` `DialogueScript`; `:21-24` `SPEAKER_LABELS`.
- `lib/dialogue/words.ts:70` -- `renderHighlightedHtml(text, words)`, the only sanctioned `dangerouslySetInnerHTML` feed; call site `components/DialogueDisplay.tsx:290-292`. Never build an attribute from its output.
- `app/globals.css:4-23` -- existing 18 vars, **read-only** here; `:25-29` is the insertion point. `:1` Google-Fonts Inter import; `:36` hardcodes `'Inter', sans-serif`.
- `app/globals.css:350-395` -- `.voice-button`: 80px, purple, hold-to-talk, belongs to legacy `VoicePractice`. **Do not reuse**; the 52px tap-to-toggle mic is its own control.
- `app/layout.tsx:17-18` -- `<html lang="vi" suppressHydrationWarning>`, no `data-theme` hook yet; server component with `export const metadata`, so a `"use client"` page cannot export metadata.
- `components/HistoryPanel.tsx:30` -- `handleViewEntry` → `/practice?id=`; new entry point goes **beside** it. Leave `components/DialogueDisplay.tsx:176,195` alone.
- `app/lab/pronunciation/page.tsx` -- Epic 2's recording reference (`:170-209`, `:211-237`); **not needed here** — no recording, and it has no timer.
- `vitest.config.mts` -- `environment: "node"`, no jsdom: component/hook tests are impossible, so turn logic must be a pure module.
- `.../ux-designs/.../DESIGN.md:7-52` -- 11 semantic tokens × 2 modes, typography, 4px scale, radii, 52px mic spec.

## Tasks & Acceptance

**Execution:**
- [x] `app/globals.css` -- append a second `:root` block after `:23` carrying the 11 DESIGN.md tokens with **dark** values, plus `--font-sans`, `--font-phonetic`, `--space-1..6`, `--radius-sm/md/lg/full`, and `color-scheme: dark`; then a `[data-theme="light"]` block redefining only the 11 colours with the light values. Leave the existing 18 vars and every existing rule alone -- additive keeps the 9 files that use them working while the new screen is built on tokens.
- [x] `app/layout.tsx` -- add `data-theme="dark"` to `<html>` -- so the light block has a switch to flip later without a toggle existing now.
- [x] `lib/session.ts` -- pure, in-memory session state machine: session status (`idle | running | finished`), the turn cursor, per-completed-turn stats (`index`, `elapsedMs`), and the advance decision for a turn given its `SampleAudioStatus`. No React, no storage, no DOM -- it is the only part of this story the node test environment can reach.
- [x] `lib/session.test.ts` -- cover the matrix rows that are pure logic: advance on system vs learner turns, audio-failed still advances, ending early preserves completed-turn stats, cursor past the last turn finishes, and **no path ever returns a learner turn's text**.
- [x] `components/SessionView.tsx` -- the screen: status strip, scrolling chat, sticky control row (hint slot · timer · 52px mic). Drives `useSampleAudio` off a memoized script, renders system text via `renderHighlightedHtml`, renders learner turns as a placeholder, and handles the legacy/`script: null` state.
- [x] `app/session/page.tsx` -- `"use client"` route reading `?id=`, `Suspense`-wrapped per `app/practice/page.tsx:136-155`, entry derived during render (no `setState` in an effect).
- [x] `components/HistoryPanel.tsx` -- add a second action that opens `/session?id=` -- an additive entry point; the existing `/practice` action stays exactly as it is.
- [x] `AGENTS.md` -- document the `/session` route, the token layer and its additive relationship to the legacy vars, and `lib/session.ts`.

**Acceptance Criteria:**
- Given a session in progress, when the learner reaches their turn, then the mic button becomes enabled and no rendered element anywhere on the page contains that turn's `text`.
- Given a script whose sample audio is already cached, when the session screen mounts, then zero requests are made to `/api/tts`.
- Given the "Kết thúc buổi" control, when it is used at any point in any state, then it responds and the finished state reports the turns completed up to that moment.
- Given the new token layer, when any existing screen is loaded, then it renders exactly as it did before this change.
- Given the branch, when `npx tsc --noEmit` and `npm run build` run, then both are clean and `npm run lint` has not gained a new error.

## Spec Change Log

**2026-08-22 — implementation decisions** (no intent renegotiated):

- **The advance decision is a `TurnPlan`, not a boolean.** `turnPlan(turn, status)` returns
  `playAudio` / `awaitPlayback` / `minDwellMs` / `fallbackMs`. A learner turn is the only shape with
  `fallbackMs: null` — nothing but the mic ends it — and every `system` turn has a finite one, which
  is how "audio failed", "audio still queued" and "autoplay blocked" all end up advancing without
  three separate code paths. `awaitPlayback` is what lets a *long* line outlast its own estimate:
  the screen drops the fallback the moment it observes playback start, so no timer can cut a line
  off mid-word.
- **Every advance goes through a `setTimeout`.** Advancing on playback-end is naturally an effect
  reacting to `playingTurn` returning to `null`, and doing it synchronously in the effect body is
  exactly the `react-hooks/set-state-in-effect` error the spec forbids a fourth of. Routing all
  advances through a timer (delay `0` when nothing is left to wait for) keeps the rule and costs
  nothing.
- **`TurnView` blanks `targetWords`, not just `text`.** A target word is a literal substring of the
  learner's line, so shipping the words while withholding the sentence is a partial reveal wearing a
  different name. `lib/session.test.ts` searches every projection, in every state, for both.
- **The route needs a hydration gate.** Deriving the entry during render is right, but `next dev`
  renders routes on demand, so the component *does* run on the server, where `historyStorage` sees
  no `window` and returns `[]`. Server "not found" against client "found" is a hydration mismatch
  and a red overlay in dev. A one-line `useSyncExternalStore(noop, () => true, () => false)` tells
  React the two differ, so it paints the loading state during hydration and the real one straight
  after — the practice page's notFound→loading→content order, without the effect. (In production the
  question does not arise: `useSearchParams` makes the tree client-only up to the `Suspense`
  boundary, and the prerendered HTML holds only the spinner.)
- **One CSS class, scoped.** `renderHighlightedHtml` emits a fixed `.word-highlight`, so tinting
  target words with `--chrome` (DESIGN.md) cannot be done inline. `.session-bubble .word-highlight`
  is scoped to the new screen precisely so `DialogueDisplay` keeps its amber highlight — repainting
  the shared class would have been repainting an existing screen.
- **Shadowed Tailwind theme variables are harmless here.** `--font-sans` and `--radius-*` also exist
  in Tailwind v4's generated `@theme`. Nothing in `app/` or `components/` uses a Tailwind utility
  class (checked), so overriding them changes no rendered output — but that is a fact about this
  codebase, not a general licence.
- **Pitfall found while verifying:** Turbopack's `.next` cache served a stale `globals.css` after the
  token block was added — every new `var()` resolved to `""` in the browser while `npm run build`
  output had them. `rm -rf .next` and restart. Recorded in `AGENTS.md`.

**2026-08-22 — matrix test audit** (no intent renegotiated):

- **`findEntry(entries, id)` extracted to `lib/session.ts`.** The "missing / unknown `id`" matrix row
  was the one row decided inline in `app/session/page.tsx` and therefore covered by no test that
  `npm test` runs — a node suite has neither `localStorage` nor a DOM to reach it through. Moving the
  choosing (not the reading) into the pure module is the same split the rest of this story already
  uses, and needs no new dependency. The page now supplies the list and `findEntry` picks; five tests
  pin whole-id matching, the empty history, and the deliberate collapse of "no `id`" and "unknown
  `id`" onto one state.

**2026-08-22 — review round 1** (10 findings; no intent renegotiated; fixes applied in place at the human's direction rather than re-derived):

- **Playback is never stopped.** Ending the session, advancing past a system turn, and restarting all left audio running — a line could sound *over* the learner's turn, which defeats the screen's purpose. Restarting was worse: `useSampleAudio.play(i)` **toggles**, so `play(0)` while `playingTurn === 0` stopped turn 0 instead of starting it. The Code Map warned that `play` toggles and has no `replay()`; the spec never said what must happen to audio when the turn changes. It does now: **playback stops on every turn change, on `endSession`, and before any restart.**
- **The headline invariant was enforced in untested code.** `playAudio: false` on learner turns is pinned in `lib/session.ts`, but the *decision to call `play`* lived in `SessionView`. Deleting `|| !wantsAudio` there made the app read the learner's own line aloud in `en-US-AvaNeural` with all 293 tests, `tsc` and lint green — the leak sweep only inspects serialised projections, never playback. Blobs for learner lines really do exist locally, so this is a reveal through audio. **The trigger decision moves into `lib/session.ts` and is tested.**
- **The advance arithmetic was likewise untested.** `fallbackMs ?? null` vs `?? 0` in `SessionView` is a one-character edit that makes a learner turn vanish on a zero timer; `turnPlan`'s tests still pass because `turnPlan` is unchanged. **The delay arithmetic moves into `lib/session.ts` and is tested.**
- **First run is mostly silent with nothing explaining it.** Audio generates sequentially (~1–2s/line) while the session advances at reading pace, and only `failed` renders a badge — `idle`/`fetching` render nothing. A script opened from history (generation is driven from `DialogueDisplay` and never resumes) races ahead of its own synthesis. **`idle`/`fetching` get a Vietnamese "đang tạo giọng mẫu" indicator.** The advance rule is unchanged — the frozen matrix says these still advance, and audio must never gate a turn.
- **`color-scheme: dark` was app-wide**, repainting native scrollbars and form controls on all nine legacy screens — against the AC "renders exactly as it did before". **Scoped to the session screen.**
- Six patches: Enter on the new history button fired both routes (the card's `onKeyDown` needs the same `stopPropagation` the click has); the `disabled` mic dropped keyboard focus every turn (`aria-disabled` + no-op keeps it focusable, and the frozen "disabled state is the only turn indicator" still holds); the chat log had no `aria-live`, so nothing announced a new line or the turn passing; English lines inherited `lang="vi"` — a Vietnamese voice reading the target sentence in a pronunciation app; `env(safe-area-inset-bottom)` was inert without `viewport-fit=cover`; and the "sticky" control row was neither sticky nor guaranteed on screen (`body { min-height: 100vh }` against the shell's `100dvh`).
- **Rejected:** `cursor`-vs-`turn.index` was reported as a live bug. `validateScript` enforces `turn.index === i` (`lib/dialogue/validate.ts:401`), so every generated script satisfies it; `isDialogueScript` does not re-check on read, so the two are still converted explicitly rather than assumed. Also rejected: replay/pause/skip controls, confirming "Kết thúc buổi", and hiding the button on legacy entries — all product decisions beyond this story.

## Design Notes

**Why a pure state machine.** `vitest` runs in `environment: "node"` — no jsdom, so a `.test.tsx` is collected and then fails for want of a DOM. Story 1.4 hit the same wall and answered it with `lib/sample-audio.ts`: pure decisions in a testable module, thin browser wrapper verified by hand. `lib/session.ts` is that module here — and "never reveal the learner's line" is precisely a claim that must be pinned by a test, not by eyeballing the UI.

**Why a start gesture *and* a timed fallback.** `useSampleAudio` swallows a rejected `audio.play()` (`hooks/useSampleAudio.ts:295`), so a session that auto-speaks on mount would advance through silent turns explaining nothing. A "Bắt đầu buổi" tap supplies the user activation. That is necessary but not sufficient — Safari's activation is stricter than Chrome's sticky one, and `play` reports nothing back either way — so advance watches `playingTurn` return to `null` and falls back on a timer when playback never starts. Audio enriches a turn; it never gates it.

**In-memory only, deliberately.** The AC "kết thúc giữa chừng vẫn giữ số liệu" is satisfied *within* a session and does **not** survive a reload. Story 2.3 brings the first metrics worth a storage layer and can choose the shape then.

**Additive tokens, not a migration.** DESIGN.md retires the purple/blue palette, but doing that here repaints 9 files inside a feature story. The new dark base `#0a120d` is as dark as today's `#0a0a14`, so declaring the new tokens beside the old vars changes nothing visually and still gives the new screen a clean surface.

## Verification

**Commands:**
- `npm test` -- expected: all pass, including the new `lib/session.test.ts`.
- `npx tsc --noEmit` -- expected: clean.
- `npm run build` -- expected: clean.
- `npm run lint` -- expected: still exactly the 3 known `react-hooks/set-state-in-effect` errors (`app/page.tsx:15`, `app/practice/page.tsx:18`, `components/HistoryPanel.tsx:19`) and no new error.

**Manual checks (if no CLI):**
- With Anki + AnkiConnect running and a generated script saved, open `/session?id=…`: the start control appears, system turns speak and show text, learner turns show a placeholder with the mic enabled, and the control row does not shift between states.
- DevTools Network tab filtered to `/api/tts` while the session runs on an already-generated script: zero requests.
- `/practice?id=…` for the same entry still loads and behaves exactly as before.
- Load `/`, `/deck/[name]`, and `/practice` and confirm no visual change from the token layer.

## Suggested Review Order

**The decisions (start here — everything else is wiring)**

- The whole design in one shape: what may sound, what advances, what may be rendered.
  [`session.ts:1`](../../lib/session.ts#L1)

- The story's headline invariant, as code: never returns a learner turn, whatever the audio status.
  [`session.ts:368`](../../lib/session.ts#L368)

- `null` means two different "don't schedule anything" — learner turn, and still sounding.
  [`session.ts:410`](../../lib/session.ts#L410)

- Why a learner turn has no timer and a system turn always has a way out.
  [`session.ts:306`](../../lib/session.ts#L306)

- Blanks `targetWords` as well as `text` — a target word is a substring of the line.
  [`session.ts:176`](../../lib/session.ts#L176)

**Playback lifecycle (where round-1 review found real bugs)**

- Stops via `play(playingTurn)` read from a ref; any other index would start that line.
  [`SessionView.tsx:122`](../../components/SessionView.tsx#L122)

- The reaper: silences anything sounding that is not the turn on screen.
  [`SessionView.tsx:170`](../../components/SessionView.tsx#L170)

- Stop before restart — `play` toggles, so this is what keeps turn 0 audible.
  [`SessionView.tsx:229`](../../components/SessionView.tsx#L229)

- Component asks the pure module which turn may sound; it no longer decides.
  [`SessionView.tsx:99`](../../components/SessionView.tsx#L99)

**Screen and accessibility**

- Memoized script — `useSampleAudio` keys all state on object identity.
  [`SessionView.tsx:69`](../../components/SessionView.tsx#L69)

- `aria-disabled`, not `disabled`: the turn signal that does not drop keyboard focus.
  [`SessionView.tsx:589`](../../components/SessionView.tsx#L589)

- The transcript announces new lines; nothing else tells a screen reader the turn passed.
  [`SessionView.tsx:380`](../../components/SessionView.tsx#L380)

- `lang="en"` so a Vietnamese voice does not read the target sentence.
  [`SessionView.tsx:443`](../../components/SessionView.tsx#L443)

- `idle`/`fetching` say so in glyph *and* words, instead of rendering silence.
  [`SessionView.tsx:394`](../../components/SessionView.tsx#L394)

**Route and entry point**

- Entry derived during render, hydration-gated — no fourth `set-state-in-effect`.
  [`page.tsx:49`](../../app/session/page.tsx#L49)

- The tested lookup: no `id` and unknown `id` collapse to one state.
  [`session.ts:35`](../../lib/session.ts#L35)

- Additive second door; the card's `/practice` click is untouched.
  [`HistoryPanel.tsx:39`](../../components/HistoryPanel.tsx#L39)

- The keydown stop that keeps Enter from firing both routes.
  [`HistoryPanel.tsx:270`](../../components/HistoryPanel.tsx#L270)

**Token layer (additive — the nine legacy screens must look identical)**

- Dark values on `:root`, deliberately no `color-scheme` here.
  [`globals.css:49`](../../app/globals.css#L49)

- Light values, ready for a toggle that this story does not ship.
  [`globals.css:83`](../../app/globals.css#L83)

- `color-scheme` scoped to the session screen — on `:root` it repaints legacy form controls.
  [`globals.css:373`](../../app/globals.css#L373)

- `viewportFit: "cover"`, without which the safe-area padding is inert.
  [`layout.tsx:18`](../../app/layout.tsx#L18)

**Peripherals**

- 316 tests; the leak sweep and the audio sweep are the two that matter.
  [`session.test.ts:1`](../../lib/session.test.ts#L1)
