---
title: 'Fix dialogue 422: extract real vocabulary from Anki cards, demote consonant-clash to non-fatal'
type: 'bugfix'
created: '2026-08-22'
status: 'done'
baseline_commit: '03d42acce62a41a876722ad8fc14946375f8ecf4'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Dialogue generation 422s on every real deck the user owns, twice over. (A) `parseCard` takes the whole `Front` field as `word`: BBC Reactor note types put a Vietnamese instruction paragraph there (the English unit lives in `Back`'s first `<b>`), and Basic/TOEIC fronts carry `[sound:]`, IPA brackets and `(a)` POS noise — so `requestedWords` contains strings no English dialogue can ever include, an unfixable violation. (B) The consonant-clash rule treats every word ending in t/d/s (`seat`, `sweet`, `quiet`) as a fatal script violation the model repeatedly fails to repair, costing whole generations.

**Approach:** (A) Rewrite extraction in the Anki source: clean `Front` first (strip sound tags, bracket groups, POS markers); when the cleaned front is not usable English, fall back to `Back`'s first `<b>` element; drop cards yielding no usable English unit; dedupe by word. (B) Move the consonant-clash finding from fatal `violations` into a new non-fatal `softViolations` array — still fed to the repair attempt, never able to produce a 422 on its own.

## Boundaries & Constraints

**Always:**
- Anki internals stay module-private in `lib/vocabulary/sources/anki.ts`; concrete sources import from `types.ts` only.
- Keep `violations` / `hintViolations` as separate arrays with their current meanings; `softViolations` is a third, also separate. A 422 remains possible only when neither attempt is clean of *fatal* `violations`.
- Both attempts stay on the table; the route returns the better of the two (fatal-clean first, then fewest non-fatal faults, ties keep the earlier).
- Multi-word phrases are legitimate `word` values (`containsWord` already supports them); strip trailing ellipsis (`...`/`…`) **and terminal sentence punctuation** (`.` `?` `!`, repeatedly, so `"...?"` fully unwinds) — a unit that keeps them can only match a line ending exactly there, never mid-sentence. <!-- amended 2026-08-22, human-approved: live e2e on the real BBC deck 422'd with punctuation kept -->

- The repair prompt still receives clash findings; the prompt keeps its pronunciation-constraint line.
- UI copy stays Vietnamese; validation messages stay English/model-facing.

**Ask First:**
- Any change to `DialogueScript` shape, script version, or stored-data handling.
- Widening the clash demotion into removing the rule or the prompt line entirely.

**Never:**
- No per-note-type config surface or new UI; heuristics live inside the Anki source.
- Don't touch `lib/gemini.ts`'s dead `generateDialogue` or the legacy branches.
- Don't merge `softViolations` into `hintViolations` or back into `violations`.
- No jsdom/`fake-indexeddb`; tests stay node-only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| TOEIC Basic card | `Front: "favorable (a) [ ˈfeɪ… ] [sound:favorable.mp3]"` | `word: "favorable"`, meaning from `Back` | N/A |
| Compound front | `Front: "reasonable delivery&nbsp;"` | `word: "reasonable delivery"` | N/A |
| Reactor sentence card | Vietnamese `Front`, `Back: "<b>I don't mean to interrupt.</b><div>Tôi…</div>"` | `word: "I don't mean to interrupt"` (terminal punctuation stripped), meaning = rest of Back (falls back to stripped Front when empty) | N/A |
| Reactor vocab card | `Back: "<b>night owl</b> = people who…"` | `word: "night owl"` | N/A |
| Trailing ellipsis / punctuation | `Back: "<b>I'd like to introduce you to ...</b>"`; `Back: "<b>Have you met ...?</b>"` | `word: "I'd like to introduce you to"`; `word: "Have you met"` — trailing ellipsis and sentence-final punctuation stripped, in any stacking order | N/A |
| Intro/full-lesson card | `Back` has no `<b>`, front Vietnamese | Card dropped | Silently skipped, rest of deck loads |
| Duplicate sentence | Two cards yield the same word (case-insensitive) | First kept, second dropped | N/A |
| Overlong extraction | Cleaned unit > 80 chars | Card dropped (guard against paragraph leakage) | N/A |
| Clash in script | Turn text `"…a seat to…"`, target `seat` | Finding in `softViolations`; repair attempted; script still returned if otherwise valid | Never a 422 by itself |
| Clash + fatal fault | Clash and a missing target word, both attempts | 422 lists only fatal violations | Vietnamese `error`, English `violations` |

</frozen-after-approval>

## Code Map

- `lib/vocabulary/sources/anki.ts` -- `parseCard` (l.65-85) is the bug: `frontKey`/`backKey` name-matching then raw `stripHtml`. Rewrite extraction here; `stripHtml` (l.53) exists, keep/extend. `fetchDeckCards` (l.88) has the `.filter(c => c.word && c.meaning)` — dedupe goes next to it.
- `lib/vocabulary/sources/anki.test.ts` -- existing specs pin Front/Back mapping, fallback order, malformed-card dropping, 200-cap. Extend with the matrix cases; the `card()` helper builds fields.
- `lib/dialogue/validate.ts` -- `clashingInitials`/`findConsonantClash` (l.45-72) stay; the push at l.434-443 moves from `violations` to `softViolations`. `ValidationResult` (l.33) gains the third array; final return (l.474) treats any non-empty array as `ok: false`.
- `lib/dialogue/validate.test.ts` -- "consonant clash" describe (l.244+) asserts fatal placement; retarget to `softViolations`.
- `app/api/dialogue/route.ts` -- `scriptFaults`/`hintFaults`/`allFaults`/`isScriptClean`/`bestAttempt` (l.216-247): `isScriptClean` keeps meaning "no fatal violations"; ranking counts hint+soft; `allFaults` includes soft so repair sees them; 422 body's `violations` stays fatal-only (l.490-497).
- `app/api/dialogue/route.test.ts` -- repair-attempt describe (l.312+) covers the accept-with-faulty-hints path; mirror it for soft faults.
- `lib/dialogue/words.ts` -- read-only: `containsWord`/`wordPattern` already phrase-safe (boundaries only at word-char edges); this is why sentences work as targets.
- `components/DialogueGenerator.tsx` -- read-only: sends `cards` as-is; source-level filtering is the guard.

## Tasks & Acceptance

**Execution:**
- [x] `lib/vocabulary/sources/anki.test.ts` -- add failing specs for the extraction matrix (TOEIC noise, Reactor Back-bold, ellipsis, intro-card drop, dedupe, overlong drop) -- red first.
- [x] `lib/vocabulary/sources/anki.ts` -- implement extraction: clean-front strategy, Back-first-`<b>` fallback (usability = non-empty, no Vietnamese letters, ≤ 80 chars), meaning = Back-remainder-else-Front, dedupe in `fetchDeckCards` -- green.
- [x] `lib/dialogue/validate.test.ts` -- retarget clash specs to `softViolations`; assert clash alone ⇒ `ok: false` with empty `violations` -- red.
- [x] `lib/dialogue/validate.ts` -- add `softViolations` to `ValidationResult`, move the clash push -- green.
- [x] `app/api/dialogue/route.ts` -- thread `softViolations` through fault helpers and `bestAttempt`; repair prompt includes them; 422 impossible from soft faults alone.
- [x] `app/api/dialogue/route.test.ts` -- spec: clash-only attempt returns 200 with script; clash+fatal on both attempts returns 422 without soft findings in `violations`.

**Acceptance Criteria:**
- Given the user's real decks (BBC Reactor + TOEIC Basic shapes), when items are fetched, then every `word` is the English learnable unit and instruction/intro cards are absent.
- Given a script whose only fault is a consonant clash, when validated, then `violations` is empty, `softViolations` names the clash, and the route returns the script (after at most one repair) — never 422.
- Given both attempts break a fatal rule, when the route responds 422, then `violations` contains only fatal findings.
- Given the full suite, when `npm test`, `npx tsc --noEmit`, `npm run build` run, then all pass (lint keeps only its 3 pre-existing errors).

## Design Notes

Strategy order is content-driven, not model-name-driven: (1) clean `Front` (strip `[sound:…]`, `[…]` bracket groups, trailing `(a)`/`(v)`/`(n)`/`(adj)`-style POS, entities, tags); if the result is usable English, use it. (2) Otherwise parse `Back`'s first `<b>…</b>` innerText and clean the same way. (3) Otherwise drop. This handles all observed shapes without hardcoding the user's note-type names and degrades safely for unknown decks (unchanged behavior for plain Front/Back cards, minus noise stripping). "Usable English" = non-empty, ≤ 80 chars, and no Vietnamese-specific letters (same alphabet heuristic as `VIETNAMESE_LETTERS` in `validate.ts` — duplicate the regex locally rather than exporting validator internals into the vocabulary layer).

Demotion, not narrowing, for the clash rule: the pronunciation concern is real for Epic 2 scoring, so the finding survives and still buys the repair attempt — it just can't cost the user a generation, mirroring the existing hint-fault design.

## Verification

**Commands:**
- `npm test` -- expected: all green, including new anki/validate/route specs.
- `npx tsc --noEmit` -- expected: clean.
- `npm run build` -- expected: clean.
- Manual: with Anki running, `POST /api/dialogue` with items fetched from `English Speaking::BBC How To` and from `TOEIC` -- expected: 200 with a valid script, no "never appears" violations in server logs.

## Suggested Review Order

**Vocabulary extraction (root cause A)**

- Entry point: the strategy that decides what a card's learnable unit is.
  [`anki.ts:258`](../../lib/vocabulary/sources/anki.ts#L258)

- The usability gate — two orthogonal Vietnamese signals, not one.
  [`anki.ts:191`](../../lib/vocabulary/sources/anki.ts#L191)

- Word-list signal; alphabet alone let a real intro card through.
  [`anki.ts:92`](../../lib/vocabulary/sources/anki.ts#L92)

- Edge/POS cleaning; terminal punctuation must go or phrases never match mid-line.
  [`anki.ts:134`](../../lib/vocabulary/sources/anki.ts#L134)

- First *usable* bold, not first bold — a Vietnamese heading must not sink the card.
  [`anki.ts:212`](../../lib/vocabulary/sources/anki.ts#L212)

**Clash demotion (root cause B)**

- The three-array contract and why they stay separate.
  [`validate.ts:36`](../../lib/dialogue/validate.ts#L36)

- The one moved push: clash is now soft, still fed to repair.
  [`validate.ts:452`](../../lib/dialogue/validate.ts#L452)

- Ranking counts hint+soft; only fatal faults can 422.
  [`route.ts:229`](../../app/api/dialogue/route.ts#L229)

**Matching**

- Apostrophe variants interchangeable; otherwise sentence targets 422 unfixably.
  [`words.ts:39`](../../lib/dialogue/words.ts#L39)

**Supporting**

- Extraction specs, including the live-found regression.
  [`anki.test.ts:419`](../../lib/vocabulary/sources/anki.test.ts#L419)

- Soft-fault routing specs.
  [`route.test.ts:431`](../../app/api/dialogue/route.test.ts#L431)
