---
title: 'Story 1.3: Sinh sẵn thang gợi ý cùng kịch bản'
type: 'feature'
created: '2026-08-21'
status: 'done'
baseline_commit: '6513901cad86ded1becdbb114a32381829a22c04'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-2-kich-ban-thanh-du-lieu-co-cau-truc.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A learner who stalls mid-turn needs a way out. Generating a hint at that moment is
the wrong time to call the network — the learner is standing there waiting, and the free Gemini
tier allows one concurrent request. FR-10 is explicit: opening a hint must produce no network
call at all.

**Approach:** Generate both hint levels in the **same call** that produces the script, attached
to the learner turns they belong to, and persist them with the script. Extend the existing
validator rather than adding a second rule engine.

**Scope: data only.** The hint-ladder UI — opening each level in order, recording hint depth —
is Story 2.4. Building any of it here would collide with that story.

## Boundaries & Constraints

**Always:**
- Hints are generated in the same model call as the script and stored alongside it. Opening a
  hint later must never trigger a request.
- Exactly two levels, fixed order: (1) the situation the line is used in, (2) keywords.
- Level 1 is written in Vietnamese and must not be a Vietnamese translation of the target line.
- Level 2 contains the turn's target words plus at most 2 other content words.
- **No level may reveal the whole target line.** There is deliberately no third level.
- Only `learner` turns carry hints.
- Scripts generated before this story (no hints) must still load and not break the app.
- Reuse `containsWord` / `wordPattern` from `lib/dialogue/words.ts` — do not write a second
  word-boundary matcher.
- Typecheck and build clean; lint stays at exactly its 3 pre-existing errors.

**Ask First:** adding any dependency; changing the one-repair-attempt policy; touching the
Gemini Live path.

**Never:** hint UI or hint-depth recording (Story 2.4); sample audio or IndexedDB (Story 1.4);
a third hint level; Tailwind classes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid hints | Every learner turn has both levels, within limits | Script returned with hints, 200 | N/A |
| Missing hints | A `learner` turn has no `hints` | Hint violation | Repair once |
| Hints on wrong speaker | A `system` turn carries `hints` | Hint violation | Repair once |
| Level 1 leaks the line | `situation` contains the target line verbatim | Hint violation | Repair once |
| Level 1 partially leaks | `situation` contains ≥4 consecutive content words of the line | Hint violation | Repair once |
| Level 2 incomplete | `keywords` omits one of the turn's target words | Hint violation | Repair once |
| Level 2 too broad | `keywords` carries 3+ non-target content words | Hint violation | Repair once |
| Level 2 reconstructs | `keywords` joined reproduces the whole target line | Hint violation | Repair once |
| Hints still bad after repair | Only hint violations remain; script rules all pass | **200**, violations logged, not returned to the user | N/A |
| Script still bad after repair | Any script-level violation remains | 422 as before | Vietnamese message |
| Legacy v2 script | Stored script with `version: 2` and no hints | Loads and renders; simply has no hints | Never blanks the screen |

</frozen-after-approval>

## Code Map

- `lib/dialogue/types.ts` -- `DialogueTurn` L26 gains optional `hints`; `DIALOGUE_SCRIPT_VERSION`
  L47 goes 2 → 3; `SPEAKER_LABELS` L21 and the shared constants block are the pattern to follow
  for any new limit.
- `lib/dialogue/validate.ts` -- `ValidationResult` L21 (**the shape change**: add a second
  `hintViolations` array rather than reworking `violations`, so the route can tell the two
  apart); `validateScript` L89; `isDialogueScript` L81 must accept **both** version 2 and 3.
- `lib/dialogue/words.ts` -- **reuse, do not duplicate.** `wordPattern` L30 and `containsWord`
  L37 already handle punctuation and non-ASCII targets correctly.
- `app/api/dialogue/route.ts` -- `RESPONSE_SCHEMA` L20 (add `hints`, optional); `buildPrompt`
  L171 (hint rules); `buildScript` L137 (**pass `hints` through untouched**, the way it already
  leaves `targetWords` for the validator to judge); the repair/decision block L299-338 is where
  the new accept-with-warning path goes.
- `lib/history.ts` -- `isStoredEntry` L73 and `normalizeEntry` L85; script detection goes
  through `isDialogueScript`, so accepting v2+v3 there is what keeps old entries loading.
- **Read-only reference:** `lib/dialogue/validate.test.ts` and `app/api/dialogue/route.test.ts`
  — the existing rule-test and stubbed-transport idioms to extend.

## Tasks & Acceptance

**Execution:**
- [x] `lib/dialogue/types.ts` -- add `DialogueHints` (`situation`, `keywords`) and optional
      `hints` on `DialogueTurn`; bump version to 3; add `hasHints(script)` -- Story 2.4 needs to
      know whether a stored script predates hints.
- [x] `lib/dialogue/stopwords.ts` -- a small English function-word set -- "at most 2 other
      content words" is unenforceable without one.
- [x] `lib/dialogue/validate.ts` -- the four hint rules, reported in a separate
      `hintViolations` array; `isDialogueScript` accepts v2 and v3 -- separating the arrays is
      what lets the route accept a script whose only remaining faults are hints.
- [x] `app/api/dialogue/route.ts` -- schema field, prompt rules, and the decision flow: repair
      once on any violation; after repair, script violations → 422, hint-only violations → 200
      with `console.warn` -- hints have no consumer until Story 2.4, so they must not cost the
      user a whole generation.
- [x] `lib/history.ts` -- load v2 and v3 alike.
- [x] `AGENTS.md` -- document the hint fields, the version bump, and the hint-only-accept rule.
- [x] Tests -- every matrix row above, including the two the route owns (hint-only → 200,
      script-still-bad → 422) and the v2-still-loads case.
- [x] `lib/dialogue/stopwords.test.ts` (**added, beyond the task list**) -- `tokenize`,
      `contentWords` and `containsSequence` decide two hint rules between them, and a quiet
      change to any of them loosens both with nothing failing.

**Acceptance Criteria:**
- Given a script is generated, when it is returned, then every learner turn carries both hint
  levels, produced in that same call and stored with the script.
- Given a hint level, when it is inspected, then it never contains the whole target line, and
  level 2 holds the turn's target words plus at most two other content words.
- Given a hint is opened later, then no network request occurs — hints come from stored data.
- Given only hint rules fail after the repair attempt, when the request completes, then the user
  gets their script and the violations are logged rather than surfaced.
- Given a script stored before this story, when it is loaded, then the app works and simply has
  no hints.
- Given the branch, when typecheck and build run, then both are clean and lint has not regressed.

## Spec Change Log

**2026-08-21 — implementation decisions** (no intent renegotiated):

- **`version` is a union, `2 | 3`, not the literal 3.** `isDialogueScript` has to accept both,
  and a stored v2 script has to keep typechecking as a `DialogueScript` everywhere it is read.
  `SUPPORTED_SCRIPT_VERSIONS` is what the guard consults; `validateScript` still insists on
  `DIALOGUE_SCRIPT_VERSION` (3), because only fresh model output has to be current.
- **Hints on a `system` turn are carried through, not stripped.** `buildScript` shapes hints but
  never drops them, so the "hints on wrong speaker" violation is visible to the validator and can
  be fed back on the repair. Silently deleting them would make the rule unenforceable.
- **A malformed `hints` fails the shape guard.** `isDialogueTurn` accepts hints that are absent
  (a v2 script) or well-formed, and rejects garbage. The route shapes hints before the validator
  sees them, so garbage can only come from a hand-edited `localStorage`.
- **"Content word" is defined by a closed function-word list** (`lib/dialogue/stopwords.ts`).
  Level 2's extras are counted as *distinct content-word tokens across all keyword entries*, so
  `"the changed"` costs one and `"the"` costs nothing — a hint cannot be padded with glue.
- **The reconstruction rule is skipped for lines with fewer than 3 content words.** A turn may
  carry 2 target words, level 2 is *required* to list them, and if that alone covers the line
  then no rewrite could ever clear the violation. Above that threshold it is always fixable by
  dropping an optional keyword.
- **Hint violations earn the same single repair attempt** and are fed back alongside the script
  violations — it is the only chance they get, since hints are never regenerated.
- **The 422 body carries script violations only.** Hint faults never reach a 422 (that path
  returns 200) and the diagnostic array should describe what actually caused the rejection.
- **`hasHints` ignores hints sitting on a `system` turn** — those are a validation failure, not a
  usable ladder, and must not make a script look hinted to Story 2.4's UI.
- **`validate.test.ts`'s helper attaches a default ladder to learner turns** unless a spec says
  otherwise. Script-rule tests rewrite turns freely and should not have to restate a hint ladder
  to stay clear of rules they are not testing; hint tests pass theirs explicitly.

**2026-08-21 — review round 1** (16 patches applied; no intent renegotiated):

- **A script-valid attempt is never thrown away.** The post-repair branch only inspected the
  *retry*, so a first attempt that broke nothing but a hint rule was lost twice over: to a 500
  when the repair call transport-failed, and to a 422 when the repair regressed and broke a
  script rule. Both attempts now stay on the table and the route returns the better — any
  script-clean attempt beats none, fewer hint faults wins, ties keep the earlier — so a 422 is
  possible only when *neither* attempt was script-clean. This is the accepted rule ("a bad rung
  must never cost a whole generation") applied to the whole flow rather than to one branch.
- **Stray hints are stripped at the point of return.** They are still carried through validation
  so the violation can be reported and repaired, but "only learner turns carry hints" is an
  invariant of the *stored* shape, and a script breaking it must not reach `localStorage`.
- **A target word is never a stopword.** `contentWords`/`isStopword` take an `alwaysContent` set
  and the validator passes the turn's target words. The list contains `like`, `right`, `well`,
  `much` — exactly what an A2/B1 deck ships as vocabulary — so the guarantee had to be
  structural rather than lexical.
- **Level 2 keywords must come from the line.** The prompt demanded it; nothing checked it, so a
  hallucinated keyword sent the learner after a word they were never meant to say.
- **Level 1 is checked for Vietnamese** with a diacritics heuristic, deliberately as a *hint*
  rule: an all-English "situation" is usually a translation in disguise, and at non-fatal stakes
  a false positive on an unaccented sentence costs one repair call rather than a script.
- **The leak window is clamped to the line's length**, so a short line quoted in full no longer
  slips past a rule expressed in 4-word windows.
- **`MAX_LEAKED_CONTENT_WORDS = 3` → `MIN_LEAKED_CONTENT_WORDS = 4`**, named for the side the
  rule states, and the prompt now interpolates it and says "content words" — it previously
  hard-coded a literal 4 while the validator counted content words after stopword removal, so a
  model obeying the prompt could still fail and read contradictory feedback.
- **The reconstruction threshold uses `MAX_TARGET_WORDS_PER_TURN`**, which is what its own
  rationale appeals to; `MAX_EXTRA_HINT_KEYWORDS + 1` was the same number by coincidence.
- **`hasHints` no longer counts an empty ladder.** `{situation: "", keywords: []}` is a shape the
  accept-with-faulty-hints path can genuinely ship; `turnHasHints` is exported for per-turn use.
- **`buildHints` returns `undefined` for junk** (arrays included, and objects where neither field
  survives), so the repair prompt hears the clear "no hints" rather than "empty situation".
- **A malformed stored hint no longer destroys the entry.** `withoutMalformedHints` strips bad
  ladders during `normalizeEntry`, so the shape guard sees a loadable script; storage is
  untouched, as always. This is the persistence-shaped risk of the story and it is now pinned.
- **`DIALOGUE_SCRIPT_VERSION ∈ SUPPORTED_SCRIPT_VERSIONS` is pinned by a test** — two independent
  declarations, and bumping one without the other would make every newly saved entry unloadable.
  The cast inside `isDialogueScript` (which asserted what the guard establishes) is gone.
- Also: the first-pass log distinguishes "rejected" from "valid script, faulty hints";
  `buildScript`'s JSDoc was reunited with `buildScript`; and tests were added for the two
  best-of-two paths, route-level malformed hints, stray system-turn hints, and `isStopword`.

One review finding was triaged as a non-issue: that any hint imperfection costs a second Gemini
call even when the script was already perfect. That is the policy the Intent chose — hints get
the one repair attempt because it is the only chance they will ever get.

## Design Notes

Level 1 is Vietnamese. The AC forbids it from containing "a Vietnamese translation of the
target line" — a prohibition that only makes sense if the level is written in Vietnamese to
begin with. EXPERIENCE.md's coach voice is Vietnamese too.

"Is this a translation?" is not machine-checkable. What is checkable is leakage, so the rule is
a proxy: reject a `situation` that contains the target line verbatim, or ≥4 consecutive content
words of it, after normalising case, punctuation and whitespace. A human still has to read a few
and confirm they describe *when you'd say this* rather than *what it means* — that check is in
Verification on purpose, not pretended away in code.

Version 3 rather than an optional field on version 2: the stored shape genuinely changed, and
`version` exists to mark exactly that. `isDialogueScript` accepting both is what keeps this
morning's v2 entries loading.

## Verification

**Commands:**
- `npm test` -- expected: all pass, including the new hint rules and the route's accept-with-
  warning path.
- `npx tsc --noEmit` -- expected: no errors.
- `npm run build` -- expected: succeeds.
- `npm run lint` -- expected: **exactly 3 errors** (`app/page.tsx:15`, `app/practice/page.tsx:18`,
  `components/HistoryPanel.tsx:19`). A 4th means this story regressed something.

**Manual checks** (needs Anki + AnkiConnect on :8765, `GEMINI_API_KEY`, `npm run dev`):
- Generate a script → in DevTools › Application › localStorage › `ankichat_history`, every
  `learner` turn has `hints` and no `system` turn does.
- **Read several `situation` values.** They must describe the situation, not translate the line.
  This is the one thing only a human can judge; if Gemini is translating, fix the prompt rather
  than tightening the validator.
- Open an entry generated before this story → still loads, simply without hints.

## Suggested Review Order

**The hint contract**

- Start here: two rungs, fixed order, deliberately no third — the whole story in one type.
  [`types.ts:34`](../../lib/dialogue/types.ts#L34)

- Named for the side the rule states, so prompt, message, doc and code all show 4.
  [`types.ts:108`](../../lib/dialogue/types.ts#L108)

- Presence is not enough — the accept-with-faulty-hints path can ship an empty ladder.
  [`types.ts:128`](../../lib/dialogue/types.ts#L128)

**The rules**

- The four hint rules, reported separately from script rules so the route can treat them differently.
  [`validate.ts:120`](../../lib/dialogue/validate.ts#L120)

- Leakage is the machine-checkable proxy for "not a translation"; a human still reads a few.
  [`validate.ts:102`](../../lib/dialogue/validate.ts#L102)

- A target word is structurally never glue, whatever the stopword list happens to contain.
  [`stopwords.ts:89`](../../lib/dialogue/stopwords.ts#L89)

**The decision — the riskiest part**

- Best of both attempts. A 422 is reachable only when neither attempt was script-clean.
  [`route.ts:241`](../../app/api/dialogue/route.ts#L241)

- The bar: hints may be wrong, a broken script rule may not.
  [`route.ts:229`](../../app/api/dialogue/route.ts#L229)

- Stray hints reach the validator but never `localStorage`.
  [`route.ts:267`](../../app/api/dialogue/route.ts#L267)

- Hints are optional in the schema — the validator is the enforcer, not the schema.
  [`route.ts:23`](../../app/api/dialogue/route.ts#L23)

**Persistence**

- A garbled ladder costs the entry its hints, never its script.
  [`history.ts:98`](../../lib/history.ts#L98)
