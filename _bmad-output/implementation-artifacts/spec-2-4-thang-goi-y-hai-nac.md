---
title: 'Story 2.4: Thang gợi ý hai nấc'
type: 'feature'
created: '2026-09-03'
status: 'done'
baseline_commit: '32ea64468fa2e86562db368e0c02c6fb3dcf585a'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-3-cham-diem-ngay-trong-luong-chat.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The hint ladder's data (`situation` + `keywords`) has existed since Story 1.3, generated
and cached with every script. Nothing in the session screen exposes it — the control row's hint slot
is a disabled placeholder reserved on purpose since Story 2.2.

**Approach:** Enable that slot. Tapping it reveals the current learner turn's two rungs in fixed order
— situation first, keywords second — never the line itself, never a network call, and records which
depth was reached (none / situation / keywords) for that turn, for the rest of the session.

## Boundaries & Constraints

**Always:**
- Fixed order, no skipping: situation before keywords. One tap advances one rung; a third tap on an
  already-fully-open turn does nothing.
- Never reveals the whole target line — enforced already by the generator/validator (Story 1.3); this
  story only renders what `DialogueTurn.hints` already contains, unmodified.
- No network call to open a hint — the content is already on `script.turns[i].hints`.
- Hint depth is per-turn, keyed like `takes`/`scores`, and **never resets** once opened — not on
  re-recording (unlike `takes`/`scores`, which `startRecording` clears), not on session end (like
  `scores`, unlike `takes`). It answers "did this turn ever need a hint", which is what FR-17's future
  latency exclusion and FR-4's "vẫn tính" rule both need to stay true for the turn's whole life, not
  just its latest attempt.
- Opening a hint never changes `canContinue`, the score gate, or the pass count — no coupling to
  `lib/pronunciation.ts` or the scoring transitions.
- The hint button only ever acts on the current turn (`state.cursor`), mirrors `startRecording`'s
  implicit-cursor style — no turn index parameter.
- A turn with no usable ladder (v2 script, or a learner turn Gemini generated without hints) shows the
  slot as permanently inert — never a broken button that opens nothing.

**Never:**
- No hint-fetching endpoint, no lazy generation, no third rung.
- No change to `TurnView` — hint depth is UI/session state, not a leak-prone content projection, so it
  does not need a fifth projection the way `scoreCard` needed a fourth. It lives on `SessionState`
  exactly like `takes`/`scores` do, read directly by `SessionView` from `script.turns[i].hints`.
- No coupling to recording phase — the button stays live whether `phase` is `idle`, `recording` or
  `recorded`, matching how `canContinue`/`micAction`/scoring already stay independent of each other.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First tap | Current turn is learner, has hints, depth `none` | Depth → `situation`; situation chip renders | N/A |
| Second tap | Depth `situation` | Depth → `keywords`; keyword chips render alongside | N/A |
| Third tap | Depth already `keywords` | No-op; button now inert | N/A |
| No ladder | Learner turn with no/empty `hints` (v2 script) | Slot stays disabled, `title` says why | N/A |
| System turn on screen | `cursor` turn is `system` | Slot disabled | N/A |
| Re-record | Depth `situation`, learner re-records the same turn | Take/score reset per existing rule; hint depth stays `situation` | N/A |
| Scroll back | Turn no longer current, depth was `keywords` | Both rungs still render under that turn's bubble | N/A |

</frozen-after-approval>

## Code Map

- `lib/dialogue/types.ts:66-79` `DialogueHints` (`situation`, `keywords`), `:96` `DialogueTurn.hints?`,
  `:160-167` `turnHasHints(turn)` (learner + non-empty situation + ≥1 keyword), `:177-179` `hasHints`.
  Import `turnHasHints` as a value (session.ts currently only imports types from this module).
- `lib/session.ts:119-174` `SessionState` (add `hints: Record<number, HintDepth>`, keyed like `:137`
  `takes` / `:149` `scores`), `:176-189` `createSession` (add `hints: {}`), `:254-265` `startRecording`
  (deliberately **not** touched — hints must survive re-recording, unlike takes/scores cleared there),
  `:533-540` `currentTurnIndex` (reuse for the implicit-cursor gate, same as `:571-583` `micAction`).
  Add: `HintDepth = "none" | "situation" | "keywords"`, `hintDepth(state, index)` (default `"none"`),
  `hintAvailable(script, state)` (current turn is learner, `turnHasHints`, depth ≠ `"keywords"`),
  `openHint(script, state)` (no-op unless `hintAvailable`; `none→situation`, else `→keywords`).
- `lib/session.test.ts:94-107` `createSession` full `toEqual` (add `hints: {}`), `:746-757` exhaustive
  `Object.keys` list after `startRecording` (add `"hints"`, alphabetically before `"micBlocked"` —
  proves it survives that reset), `:1109-1124` `stateWithoutScores` (add `hints: s.hints`, not to the
  `:1127` `OMITTED` list — nothing about depth is a secret), `:73` fixture `SCRIPT.turns[1].hints =
  { situation: "Khi bạn chào lại", keywords: ["Zebrafish"] }`, turn `:3` has no `hints` (the no-ladder
  case). `:398-429` and `:1014-1183` leak sweeps already include `"Khi bạn chào lại"` in their secrets
  list — must keep passing unmodified, since hint text never enters `SessionState`.
- `components/SessionView.tsx:1197-1215` the disabled hint-slot placeholder — replace with a live
  button wired to `openHint`/`hintAvailable`. `:858` `const turn = script.turns[view.index]` already
  computed for the score card — reuse for `turn?.hints`. Insert the reveal (situation chip, then
  keyword chips once open) right after the bubble closes (`:930`) and before the take/sample row
  (`:936-980`), gated on `!isSystem && session.hints[view.index] !== "none"`. `:936-944` is the
  existing inline flex-wrap row style — copy its shape for the keyword-chip row.
- `app/globals.css:461-491` `.session-chip` — interactive pill (cursor pointer, hover). Add
  `.session-hint-chip` beside it: same visual tokens, no `cursor: pointer`/hover (these chips are
  read-only), for both rungs per `DESIGN.md:151` ("Chip gợi ý ... Hai nấc: tình huống, rồi từ khoá").
- `DESIGN.md:123` control-row order (gợi ý · đồng hồ · mic — unchanged), `:151` the chip spec above.
  `EXPERIENCE.md:77-84` fixed order, no Vietnamese translation of the line, no network call.

## Tasks & Acceptance

**Execution:**
- [x] `lib/session.ts` -- add `HintDepth`, the `hints` slot on `SessionState`/`createSession`, and
  `hintDepth`/`hintAvailable`/`openHint` per the Code Map. `startRecording` untouched.
- [x] `lib/session.test.ts` -- extend the two exhaustive-shape assertions and `stateWithoutScores`;
  add cases for the I/O matrix rows (first/second/third tap, no-ladder turn, system-turn gating,
  hint depth surviving re-record, and that `openHint` never changes `scores`/`completed`/`canContinue`).
- [x] `components/SessionView.tsx` -- wire the hint slot button to `openHint`/`hintAvailable`; render
  the situation chip and keyword chips under the current/any turn per its recorded depth.
- [x] `app/globals.css` -- add `.session-hint-chip`, scoped under `.session-screen`.
- [x] `AGENTS.md` -- document the `hints` slot, `HintDepth`, and why it is not a fifth projection.

**Acceptance Criteria:**
- Given a learner turn with a hint ladder, when the hint button is tapped twice, then situation shows
  first and keywords second, never the line, and a third tap does nothing.
- Given a learner turn with no ladder, when the session reaches it, then the hint slot stays disabled.
- Given a turn whose hints were opened, when the learner re-records that turn, then the take and score
  reset but the hint depth does not.
- Given the branch, when `npm test`, `npx tsc --noEmit` and `npm run build` run, then all pass and
  `npm run lint` gains no new error.

## Spec Change Log

## Verification

**Commands:**
- `npm test` -- expected: all pass, including the extended `lib/session.test.ts`.
- `npx tsc --noEmit` -- expected: clean.
- `npm run build` -- expected: clean.
- `npm run lint` -- expected: still exactly the 3 known `react-hooks/set-state-in-effect` errors.

**Manual checks (if no CLI):**
- Run a session on a turn with hints (an Epic-1-generated script, not an old v2 entry): tap the hint
  button twice, confirm situation then keywords, confirm a third tap is inert.
- Open a v2/no-hints entry: confirm the slot stays visibly disabled throughout.
- Scroll back to a completed turn whose hints were opened: confirm both rungs still render.

## Suggested Review Order

**Hint-ladder decisions (`lib/session.ts`)**

- Entry point — the state slot and its lifecycle contract (keyed like `takes`/`scores`, never cleared).
  [`session.ts:190`](../../lib/session.ts#L190)

- Fixed-order transition: `none → situation → keywords`, no-ops past `hintAvailable`.
  [`session.ts:675`](../../lib/session.ts#L675)

- Gate: implicit-cursor, system-turn/no-ladder/fully-open all read `false`.
  [`session.ts:656`](../../lib/session.ts#L656)

- The two-rung type itself — deliberately no third value.
  [`session.ts:637`](../../lib/session.ts#L637)

**UI wiring (`components/SessionView.tsx`)**

- The control-row button: `aria-disabled` (not `disabled`) so focus doesn't drop to `<body>`.
  [`SessionView.tsx:1310`](../../components/SessionView.tsx#L1310)

- The reveal: situation chip, then keyword chips, captioned so the pills read as hints.
  [`SessionView.tsx:1020`](../../components/SessionView.tsx#L1020)

- Keyword list filtered/deduped before render — guards against a blank or repeated model keyword.
  [`SessionView.tsx:916`](../../components/SessionView.tsx#L916)

- Derived state for the button's label/enabled-ness, read once per render.
  [`SessionView.tsx:253`](../../components/SessionView.tsx#L253)

**Peripherals**

- `.session-hint-chip` — same pill as `.session-chip`, deliberately non-interactive.
  [`globals.css:498`](../../app/globals.css#L498)

- Documentation of the slot, its reset rule, and why it isn't a fifth projection.
  [`AGENTS.md:28`](../../AGENTS.md#L28)

- Full test coverage of the I/O matrix plus the review's patched gaps (restart, `endSession`, no-script).
  [`session.test.ts:1597`](../../lib/session.test.ts#L1597)
