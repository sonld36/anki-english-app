---
title: 'Story 1.2: Kịch bản thành dữ liệu có cấu trúc'
type: 'feature'
created: '2026-08-21'
status: 'done'
baseline_commit: '17e4fa5ecb4a04cff95fc9d37978424971b9d19b'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-1-nap-tu-vung-qua-lop-nguon-thay-the-duoc.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `dialogue` is one markdown string prefixed `**A (Alex):**`. Nothing can tell whose
turn it is or what the target sentence is, so scoring is impossible; target words have to be
found by substring search (`cold` matches inside `colder`); and "at most 2 target words per
turn" lives only in a prompt where nothing can check it. epics.md calls this the change
**everything else depends on**.

**Approach:** Have Gemini return JSON against a response schema — a list of turns, each with a
speaker, its text, and its own target-word list taken from data rather than string matching.
Add a pure validator that is the single definition of "valid script". Old markdown entries in
history keep rendering.

## Boundaries & Constraints

**Always:**
- 5–12 turns, both speakers present, ≤2 target words per turn, ≤20 per script, and every
  requested target word appears at least once.
- A target word ending `-ed`/`-s`/`-d`/`-t` must not sit immediately before a word starting
  with that same consonant (`walked to`, `cold drink`). Measured constraint, not a preference —
  native speakers don't release the ending there, so Epic 2 cannot score it.
- Level (A2/B1/B2) governs only the language *around* target words.
- Pre-existing markdown entries in `localStorage` must still render. Normalize on read; never
  rewrite what is already stored.
- Keep the `models` fallback array and `thinkingConfig` in the route as-is.
- Typecheck and build clean; lint must stay at exactly its 3 pre-existing errors.

**Ask First:** removing the Gemini Live path or `/api/live-token` (that is Story 2.8); adding
any dependency; changing `ALLOWED_ACTIONS`.

**Never:** hint-ladder content (Story 1.3); sample audio or IndexedDB (Story 1.4); due-date
selection logic (Epic 3); Tailwind classes; deleting the legacy markdown renderer.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid script | Model returns schema-conformant JSON meeting all rules | `DialogueScript` returned, saved, rendered | N/A |
| Missing target word | A requested word appears in no turn | Retry once with the violation fed back | Still bad → 422 listing violations |
| Too many per turn | A turn carries 3 target words | Same retry-once path | Same |
| Hallucinated label | `targetWords` names a word absent from that turn's `text` | Rejected as a violation | Same |
| Substring trap | Turn says `colder`, target word is `cold` | NOT counted as present — word-boundary match only | N/A |
| Consonant clash | Turn text contains `walked to` where `walked` is a target | Rejected as a violation | Same |
| Turn count out of range | 4 turns, or 13 turns | Rejected as a violation | Same |
| Model/transport failure | HTTP error or unparseable body | Fall through the `models` array as today | All models fail → 500, vocabulary kept |
| Legacy history entry | Stored entry whose `dialogue` is a markdown string | Renders through the legacy markdown path | Never blanks the screen |

</frozen-after-approval>

## Code Map

- `app/api/dialogue/route.ts` -- **main change.** Prompt L35-57 (rewrite to JSON; drop the
  "Vocabulary in Context" section); `models` L64 and `generationConfig` L77 with
  `thinkingConfig` L86 (**keep both**, add `responseMimeType`/`responseSchema`); response
  shape L115; request parse L14.
- `lib/gemini.ts` -- `generateDialogue` L16 returns `DialogueScript` not `string` (L37 is the
  cast to change). **`highlightWords` L41 is correct already** — its `\b(...)\b` pattern is the
  word-boundary behavior the validator needs; reuse the idea, don't rewrite it.
- `app/deck/[deckName]/page.tsx` -- **the substring bug.** L52-54 uses
  `dlg.toLowerCase().includes(w)`; replace with the union of `turns[].targetWords`.
- `lib/history.ts` -- `dialogue: string` field L10; `normalizeEntry` L48 and `readRaw` L57 are
  the **proven Story 1.1 pattern to extend** — normalize on read, mutators read raw so
  untouched entries stay byte-identical.
- `components/DialogueDisplay.tsx` -- `parseDialogue` L36 and the render loop L122 become the
  **legacy branch**, kept intact. `highlightedHtml` L33 is computed and never used — dead, drop
  it. Save calls L62/L70 change shape.
- `components/DialogueGenerator.tsx` -- callback type L9-10, call site L47.
- `components/VoicePractice.tsx` -- reads `entry.dialogue` at L28 and L343. **Minimum viable
  only** — this is the dead Gemini Live path, scheduled for teardown in Story 2.8.
- **Read-only reference:** `lib/vocabulary/types.ts` (the transport-free types module this
  mirrors) and `lib/vocabulary/sources/anki.test.ts` (the stub-and-assert test idiom to follow).

## Tasks & Acceptance

**Execution:**
- [x] `lib/dialogue/types.ts` -- `Speaker` (`"system" | "learner"`), `DialogueTurn` (`index`,
      `speaker`, `text`, `targetWords`), `DialogueScript` (`version: 2`, `turns`) -- transport-free,
      mirroring `lib/vocabulary/types.ts`. Speakers come from DESIGN.md (system left, learner right).
- [x] `lib/dialogue/validate.ts` -- pure `validateScript(script, requestedWords)` returning
      `{ok:true} | {ok:false, violations:string[]}` -- the single definition of a valid script,
      and the only part of this story testable without the network.
- [x] `lib/dialogue/validate.test.ts` -- cover every non-transport matrix row -- these are the
      rules Epic 2's scoring rests on.
- [x] `app/api/dialogue/route.ts` -- JSON response schema, rewritten prompt, validate, retry
      **once** with violations fed back, then 422 -- constraints become enforced, not merely requested.
- [x] `lib/gemini.ts` -- return `DialogueScript`; leave `highlightWords` alone.
- [x] `lib/history.ts` -- add `script` + `legacyDialogue`, normalize on read -- old entries survive.
- [x] `components/DialogueDisplay.tsx` -- render from `turns`; keep the markdown path for legacy
      entries; drop the unused `highlightedHtml`.
- [x] `app/deck/[deckName]/page.tsx` + `components/DialogueGenerator.tsx` -- consume the script;
      derive used words from data.
- [x] `components/VoicePractice.tsx` -- compile and don't crash. No improvements, no teardown.
- [x] `AGENTS.md` -- document `lib/dialogue/` and that the script is now schema'd JSON.
- [x] `app/api/dialogue/route.test.ts` (**added, beyond the task list**) -- stubs `fetch` the way
      `anki.test.ts` stubs the proxy, to pin the two transport matrix rows and the retry policy
      itself: exactly two successful generation calls, same model on the repair, violations fed
      back, 422 after. The "exactly one retry" AC is otherwise unverifiable without a live key.
- [x] `lib/dialogue/words.ts` + `words.test.ts` (**added in review**) -- one home for "what counts
      as this word appearing in this text": `containsWord`, `wordPattern`, `escapeHtml`, and
      `renderHighlightedHtml`, the single escape-and-highlight helper every
      `dangerouslySetInnerHTML` site on a live path now calls.
- [x] `lib/dialogue/types.test.ts` (**added in review**) -- `scriptToMarkdown` is the bridge to the
      Live system prompt and the clipboard, and `scriptTargetWords` now drives VoicePractice's
      highlighting; neither had any coverage, so swapping `SPEAKER_LABELS` failed nothing.
- [x] `lib/history.test.ts` (**added, beyond the task list**) -- the legacy-history matrix row:
      a stored markdown entry normalizes to `script: null` + `legacyDialogue`, and a delete leaves
      untouched entries byte-identical. Story 1.1 left this as a manual check; it is the riskiest
      edit here, so it is now pinned.

**Acceptance Criteria:**
- Given a deck, topic and level, when a script is generated, then each turn carries its speaker,
  text, and own target-word list, and target words come from data rather than substring search.
- Given a generated script, when the validator runs, then every constraint above is enforced,
  and a first-attempt violation triggers exactly one retry before the user sees an error.
- Given a history entry stored as markdown before this change, when it is opened, then it renders
  and the app does not break.
- Given generation fails, then the cause is stated in Vietnamese, retry is possible, and the
  loaded vocabulary is not lost.
- Given the branch, when typecheck and build run, then both are clean and lint has not regressed
  past its 3 pre-existing errors.

## Spec Change Log

**2026-08-21 — implementation decisions** (no intent renegotiated):

- **`-ed` clashes with both `d` and `t`.** The constraint says "that same consonant", but `-ed`
  is realised /t/ after a voiceless stem and /d/ otherwise — and the spec's own example,
  `walked to`, is the /t/ case. The rule therefore treats `-ed` as clashing with a following
  `d` *or* `t`; `-s`→`s`, `-d`→`d`, `-t`→`t`. Only whitespace may separate the two words:
  punctuation is a pause, which releases the ending, so `cold, dark` is allowed.
- **`targetWords` must be a subset of the requested words.** Not spelled out in the matrix, but
  without it "target words come from data" is unenforceable — the model could invent labels.
- **`index` is assigned by the route, not the model.** It is absent from `responseSchema`; the
  route sets it from array position, so the whole class of index violations cannot occur. The
  validator still checks the invariant, because it also guards scripts read back from storage.
- **Unparseable JSON falls through the `models` array**, matching the matrix row, and does not
  consume the single repair attempt — a body that will not parse is a malfunction, not a
  misunderstanding.
- **Target words are snapped to the requested spelling** when they match case-insensitively, so
  `turns[].targetWords` joins cleanly against `cards[].word` downstream.
- **`historyStorage.save` cannot express a legacy entry.** Its parameter type requires a
  `DialogueScript`, making "version 1 is never produced again" a compile-time fact.
- **Turn text is HTML-escaped before highlighting.** The legacy path injected raw model output
  into `dangerouslySetInnerHTML`; the new path does not. Three lines, no behavior change for
  ordinary text.
- **`DialogueGenerator` still POSTs to `/api/dialogue` itself** rather than calling
  `generateDialogue`, which stays unused — pre-existing duplication, left alone per the Code Map.

**2026-08-21 — review round 1** (13 patches applied; no intent renegotiated):

- **Only a validated rejection may produce a 422.** A transport failure on the repair call was
  reporting the *first* attempt's violations, so a quota error or a 30s timeout told the user to
  change topic. It now returns 500 with the transport error.
- **One escape-and-highlight helper** (`renderHighlightedHtml` in `lib/dialogue/words.ts`) for
  every `dangerouslySetInnerHTML` site on a live path. `VoicePractice` was rendering the same
  Gemini text — and the user transcript — unescaped. The original order,
  `highlightWords(escapeHtml(text))`, was also wrong in both directions: a target containing `&`
  (`R&D`) could never match inside `R&amp;D`, and a target `amp` matched *inside* the entity and
  corrupted it. Matching now runs on raw text with escaping applied per segment.
- **Word boundaries are applied per side.** `\b` next to a target that starts or ends with a
  non-word character (`etc.`, `5%`, `école`) can never match, making the word unprovable and the
  422 unclearable. `wordPattern` adds each boundary only where the target has a word character.
- **`DialogueGenerator` validates the 200 body** with `isDialogueScript` before handing it to the
  parent, where a malformed script would have thrown inside render, past the error state.
- **The clash regex uses `\s+`**, so a clash across a line break no longer slips through.
- **Hallucinated words no longer inflate the ≤20 script cap** — `claimed.add` moved after the
  requested-word check, so one bad word yields one violation, not two.
- **The prompt is built from the same filtered list the validator sees.** A card with a blank
  `word` and a real `meaning` produced a prompt line `- : <meaning>`, asking for a word outside
  the requested set. Filtering also happens before the 20-word slice, so a blank card cannot eat
  a slot.
- **`level` and the request body are guarded.** `level` is client-supplied and was indexing
  `levelGuide` unchecked, injecting the literal `undefined` into the prompt; it now falls back to
  `B1`. `await req.json()` on an unparseable body threw past the Vietnamese error handling; it now
  returns 400.
- **A 400 no longer kills the model fallback.** With `responseSchema` / `propertyOrdering` /
  `thinkingConfig` in the request, a 400 as likely means "this model rejects this generation
  config" as "bad key", and one picky model was taking the other three down with it. Only
  401/403 are fatal now.
- **Turn count is in the schema** (`minItems`/`maxItems`), not just the prose — it removes one of
  the likeliest repair triggers and stops an empty `turns` array being schema-valid.
- **`getAll()` skips unpresentable stored elements.** A `null` or garbage array element
  normalized into an object with no `id` that TypeScript believed complete, reaching
  `key={entry.id}` and `/practice?id=undefined`. Skipped on read only — `readRaw` stays raw, so
  nothing unrecognised is rewritten or dropped from disk.
- **`VoicePractice` highlights from `scriptTargetWords`**, not a scan of the whole card list —
  the very thing this story exists to remove. The card list is now the legacy-entry fallback only.

Two review findings were triaged as non-issues and deliberately not changed: the consonant rule
firing on uninflected words (`cold drink` is epics.md's own example and `cold` is uninflected —
the rule is about an unreleased final consonant, not inflection), and the colour difference
between the legacy and new speaker labels (the legacy branch is unreachable).

## Design Notes

Two speakers, not two names. DESIGN.md renders system turns left and learner turns right and
says the bubble shape alone distinguishes them, so `speaker: "system" | "learner"` is the honest
axis; `DialogueDisplay` can still print "Alex"/"Sam" from a constant.

`version: 2` on the script marks the schema generation. Version 1 is the old markdown string and
exists only inside `localStorage` — it is never produced again.

Retry policy: at most **two** successful generation calls. The free Gemini tier allows one
concurrent request and a call runs 5–15s, so an unbounded repair loop would strand the user on a
spinner. Model fallback still applies to transport failures only — a validation failure means the
model understood and got it wrong, so trying a different model is not the fix; feeding back the
specific violations is.

## Verification

**Commands:**
- `npm test` -- expected: all pass, including the new validator suite.
- `npx tsc --noEmit` -- expected: no errors.
- `npm run build` -- expected: succeeds.
- `npm run lint` -- expected: **exactly 3 errors** (`app/page.tsx:15`, `app/practice/page.tsx:18`,
  `components/HistoryPanel.tsx:19`). A 4th means this story regressed something.

**Manual checks** (needs Anki + AnkiConnect on :8765, `GEMINI_API_KEY`, `npm run dev`):
- Generate a script → turns render with correct speakers and highlighted target words.
- Count target words in any single turn → never more than 2.
- Open a history entry created **before** this story → still renders, no blank screen.
- Trigger a failure (e.g. temporarily empty the key) → Vietnamese error, retry works, the loaded
  flashcard list is still there.

## Suggested Review Order

**The schema**

- Start here: two roles, not two names — everything downstream keys off this.
  [`types.ts:26`](../../lib/dialogue/types.ts#L26)

- Display names are presentation only. Sam = AI, Alex = learner, matching `VoicePractice`.
  [`types.ts:21`](../../lib/dialogue/types.ts#L21)

**The rules — where this story's value actually lives**

- The single definition of a valid script. Every constraint Epic 2 rests on is enforced here.
  [`validate.ts:89`](../../lib/dialogue/validate.ts#L89)

- The measured constraint. `-ed` yields both `d` and `t` because its realisation varies by stem.
  [`validate.ts:33`](../../lib/dialogue/validate.ts#L33)

- Whole-word matching — this is what stops `cold` matching inside `colder`.
  [`words.ts:30`](../../lib/dialogue/words.ts#L30)

**Rendering model output safely**

- Security control. Matches raw, escapes per segment, so neither step can break the other.
  [`words.ts:64`](../../lib/dialogue/words.ts#L64)

- Every live `dangerouslySetInnerHTML` site now routes through it.
  [`DialogueDisplay.tsx:161`](../../components/DialogueDisplay.tsx#L161)

**Generation and repair**

- Exactly one repair on the same model; a transport failure here is a 500, not a 422.
  [`route.ts:304`](../../app/api/dialogue/route.ts#L304)

- A 400 is deliberately non-fatal — a picky model must not take the other three down.
  [`route.ts:106`](../../app/api/dialogue/route.ts#L106)

- Turn bounds enforced structurally, removing the likeliest repair trigger.
  [`route.ts:20`](../../app/api/dialogue/route.ts#L20)

**Consumers**

- The substring bug is gone: used words come from turn data, not a text scan.
  [`page.tsx:56`](../../app/deck/%5BdeckName%5D/page.tsx#L56)

- A 200 body is no longer trusted blindly.
  [`DialogueGenerator.tsx:51`](../../components/DialogueGenerator.tsx#L51)

**Persistence — the riskiest edit**

- Unrecognised stored elements are hidden on read, never rewritten or dropped from disk.
  [`history.ts:116`](../../lib/history.ts#L116)

- Legacy markdown entries normalize to `legacyDialogue`; v2 entries to `script`.
  [`history.ts:85`](../../lib/history.ts#L85)
