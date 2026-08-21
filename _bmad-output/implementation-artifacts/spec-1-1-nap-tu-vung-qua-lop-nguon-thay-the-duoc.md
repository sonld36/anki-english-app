---
title: 'Story 1.1: Nạp từ vựng qua lớp nguồn thay thế được'
type: 'refactor'
created: '2026-08-21'
status: 'done'
baseline_commit: '730bd9849b5d045d567fadbc06d1b05f97f6ac30'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Anki is hardcoded into every layer. `lib/anki.ts` mixes the vocabulary
data type (`ParsedCard`), the HTTP transport, and the field-parsing logic; `DeckSelector.tsx`
POSTs to `/api/anki` directly. Adding any second vocabulary source later means surgery
across the whole app — and the coupling is still shallow today (4-field type, 7 of 8
importers are type-only), so this is the cheap moment.

**Approach:** Introduce a neutral `VocabularySource` seam under `lib/vocabulary/`: a
transport-free types module, a source interface plus registry, and Anki as one
implementation behind it. Delete `lib/anki.ts`. Zero user-visible behavior change.

## Boundaries & Constraints

**Always:**
- Read-only against Anki; never write back.
- Preserve behavior exactly: field-name fallback, HTML stripping, malformed-card filtering,
  200-card cap / 100-card batching, the Vietnamese connection-error text, and the setup help
  panel with addon code `2055492159`.
- Keep persisted `localStorage` shapes intact — `HistoryEntry.cards` and item fields
  `id` / `word` / `meaning` keep their names; old entries must still render.
- Anki-specific fields on the neutral type are optional; no consumer may branch on them.
- Typecheck and lint clean.

**Ask First:** changing `ALLOWED_ACTIONS` in `app/api/anki/route.ts`; adding any dependency or
test framework; touching the Gemini Live path (teardown is Story 2.8).

**Never:** a second concrete source (CSV, manual entry) — the seam only; dialogue-schema work
(Story 1.2); Tailwind classes (styling stays inline + `app/globals.css`); surfacing Anki's
`interval` field; deleting `public/audio-processor.worklet.js`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List collections | AnkiConnect on :8765 | `VocabularyCollection[]`, one per deck, `id === name` | N/A |
| List collections, Anki down | Unreachable | Rejects | "Không thể kết nối Anki…" + setup steps + "Thử lại" |
| Fetch, standard fields | `Front`/`Back` deck | `VocabularyItem[]`, HTML stripped, `id` stringified | N/A |
| Fetch, unknown fields | Custom field names | Falls back to first two fields, in order | N/A |
| Fetch, malformed cards | Cards missing word or meaning | Those dropped, rest returned | Never fails whole load |
| Fetch, empty deck | Zero cards | `[]`, no batch request issued | N/A |
| Fetch, large deck | >200 cards | First 200 only, batches of 100 | N/A |
| Legacy history | Pre-refactor entry (numeric `id`) | Renders normally | N/A |

</frozen-after-approval>

## Code Map

- `lib/anki.ts` -- **source of the move, then deleted.** `AnkiCard` L2-13, `ParsedCard` L15-20,
  `callAnki` L23-35, `ankiApi` L37-51, `stripHtml` L54-63, `parseCard` L66-86 (field-name
  fallback L70-78), `fetchDeckCards` L89-104 (200-cap L94, batch 100 L95, filter L103).
- `components/DeckSelector.tsx` -- **real change.** Inline `fetch("/api/anki", …)` at L24-31;
  deck dropdown L88-100; hardcoded Anki help panel L104-124 (addon code at L119).
- `app/deck/[deckName]/page.tsx` -- **real change.** `fetchDeckCards` call at L34 inside
  `loadCards`; state at L17/L24; error + retry UI at L146-163.
- Type-only importers, one line each: `app/api/dialogue/route.ts` L2 (+usage L15),
  `lib/gemini.ts` L1 (+L17), `lib/history.ts` L1 (+L7), `components/DialogueGenerator.tsx` L5
  (+L8), `components/DialogueDisplay.tsx` L7 (+L12), `components/FlashcardList.tsx` L4
  (+L7, L11), `components/VoicePractice.tsx` L7.
- `app/api/anki/route.ts` -- **read-only reference.** Proxy + `ALLOWED_ACTIONS` whitelist and
  the Vietnamese connection-error string (L44). Do not modify.
- **Verified read-only evidence:** `modelName` is written at `lib/anki.ts:84` and read
  nowhere else in the repo. Item `id` is consumed only as a React key
  (`FlashcardList.tsx:189`, `FlashcardList.tsx:257`, `HistoryPanel.tsx:216`) — no comparison,
  no arithmetic. Only `word`, `meaning`, `id` are consumed by any component.

## Tasks & Acceptance

**Execution:**
- [x] `lib/vocabulary/types.ts` -- create `VocabularyItem` (`id: string`, `word`, `meaning`,
      `ankiModelName?`) and `VocabularyCollection` (`id`, `name`) -- transport-free, so the
      server route stops importing types from a client-fetch file.
- [x] `lib/vocabulary/source.ts` -- `VocabularySource` interface + registry with
      `getVocabularySource(id?)` defaulting to Anki -- the swap point.
- [x] `lib/vocabulary/sources/anki.ts` -- move `lib/anki.ts` internals here verbatim; keep
      `AnkiCard`, `callAnki`, `ankiApi`, `stripHtml` module-private, export only `ankiSource`
      -- shrinks the public surface to the interface.
- [x] `lib/anki.ts` -- delete.
- [x] `components/DeckSelector.tsx` -- call `source.listCollections()`; render help panel from
      `source.setupHint` -- removes the last hardcoded Anki path from the UI.
- [x] `app/deck/[deckName]/page.tsx` -- call `getVocabularySource().fetchItems(deckName)`.
- [x] Seven type-only importers -- swap import path, rename `ParsedCard` → `VocabularyItem` --
      mechanical, no logic change.
- [x] `AGENTS.md` -- repoint "Anki access: `lib/anki.ts`" at `lib/vocabulary/`, and record that
      a test suite now exists -- it is the agent onboarding map and currently says neither.
- [x] `package.json` + `vitest.config.mts` -- add `vitest` as a devDependency and a `test`
      script -- required to satisfy the I/O matrix audit; **approved by the human on
      2026-08-21**, clearing the "Ask First" gate on new dependencies. (`.mts`, not `.ts`:
      the CJS-loaded `.ts` form emits a Vite `configLoader` deprecation warning on every run.)
- [x] `lib/vocabulary/sources/anki.test.ts` -- cover the six non-UI matrix rows against a
      stubbed `/api/anki` transport: deck listing, standard fields, unknown-field fallback,
      malformed-card filtering, empty deck, and the 200-cap / 100-batch path -- these prove the
      "no behavior change" AC that manual clicking cannot.

**Matrix rows not unit-tested** (UI-level, verified manually — see Verification): "List
collections, Anki down" (error copy + retry affordance) and "Legacy history" (rendering a
pre-refactor `localStorage` entry).

**Acceptance Criteria:**
- Given the refactor is done, when inspecting the vocabulary type, then it lives in a neutral
  module, its name carries no Anki trace, and Anki-specific fields are optional.
- Given the refactor is done, when grepping for `ParsedCard` or `lib/anki`, then zero matches
  outside `node_modules`.
- Given Anki is running, when going from deck picker through dialogue generation, then behavior
  is identical to before.
- Given a pre-refactor history entry, when the history panel opens, then it renders normally.
- Given the branch, when typecheck and lint run, then both are clean.

## Spec Change Log

## Design Notes

The interface — deliberately two methods, no lifecycle, no config. It lives in
`lib/vocabulary/types.ts` alongside the other transport-free contracts (review moved it there:
declaring it in `source.ts` created a `source.ts` ↔ `sources/anki.ts` cycle that was inert only
because the back-edge was `import type`). `source.ts` re-exports it, so call sites are
unaffected and the registry is now a leaf module.

```ts
export interface VocabularySource {
  readonly id: string;
  readonly label: string;
  readonly setupHint?: { title: string; steps: string[] };
  listCollections(): Promise<VocabularyCollection[]>;
  fetchItems(collectionId: string): Promise<VocabularyItem[]>;
}
```

`setupHint` is data, not JSX, so `DeckSelector` renders connection help without naming Anki.
A step marks up `` `code` `` and `**bold**`; `lib/vocabulary/setup-hint.ts` parses those into
segments and `DeckSelector` maps segments onto elements. This preserves the original panel's
emphasis and the copyable `2055492159` chip without putting JSX in the source layer, and keeps
the parser testable under the node-env suite. Any future source gets the same affordance free.
A source with no `setupHint` still renders a generic recovery message rather than nothing.

**Lint deviation:** the AC asks for clean lint. `npm run lint` reports 3
`react-hooks/set-state-in-effect` errors in `app/page.tsx:15`, `app/practice/page.tsx:18`,
`components/HistoryPanel.tsx:19` — all pre-existing. Verified against baseline `730bd98` in a
clean worktree: baseline is 3 errors / 7 warnings, this branch is 3 errors / 6 warnings. No
regression; the one removed warning is an unused import in `VoicePractice.tsx`. Fixing the
three would mean restructuring effects in files outside this story's Code Map, which conflicts
with "preserve behavior exactly" — deliberately left for a separate change.

`id` moves `number` → `string` (`String(card.cardId)` in the adapter): it only feeds React
keys, and future sources shouldn't be forced to invent numeric ids. Legacy entries hold
numeric ids — harmless as keys.

`AnkiCard` keeps `interval` / `reps` / `lapses` (AnkiConnect returns them) but stays
module-private; none map onto `VocabularyItem`.

## Verification

**Commands:**
- `npm test` -- expected: all tests pass, and the run reports the six matrix-row tests as
  executed (not skipped or filtered out).
- `npx tsc --noEmit` -- expected: no errors.
- `npm run lint` -- expected: no errors.
- `npm run build` -- expected: succeeds; catches server/client boundary breaks.
- `grep -rn "ParsedCard\|lib/anki" --include="*.ts" --include="*.tsx" . | grep -v node_modules`
  -- expected: no output.

**Manual checks** (needs Anki Desktop + AnkiConnect on :8765, `GEMINI_API_KEY` in `.env.local`,
`npm run dev`):
- `/` shows "Đã kết nối Anki — N deck" with the same deck list as before.
- Pick a deck → `/deck/<name>` lists the same card count as before the refactor.
- Generate a dialogue → it renders and used words highlight in the flashcard list.
- Open the history panel → an entry created **before** the refactor still shows its words.
- Quit Anki, reload `/` → Vietnamese connection error + 3-step setup panel + working "Thử lại".

## Suggested Review Order

**The contract**

- Start here: the whole seam is this one interface — two methods, no lifecycle.
  [`types.ts:33`](../../lib/vocabulary/types.ts#L33)

- The neutral item. `ankiModelName` is optional and read by nobody, by design.
  [`types.ts:4`](../../lib/vocabulary/types.ts#L4)

- The swap point. `Object.hasOwn` keeps `"constructor"` from resolving up the prototype chain.
  [`source.ts:14`](../../lib/vocabulary/source.ts#L14)

**Anki demoted to one implementation**

- Everything Anki-shaped now ends at this object; the module exports nothing else.
  [`anki.ts:105`](../../lib/vocabulary/sources/anki.ts#L105)

- Deck names become collections — `id === name` is what keeps routing unchanged.
  [`anki.ts:117`](../../lib/vocabulary/sources/anki.ts#L117)

- Moved verbatim: field fallback, HTML strip, `String(cardId)`. Behavior must not shift here.
  [`anki.ts:65`](../../lib/vocabulary/sources/anki.ts#L65)

**Call sites**

- The last hardcoded Anki path in the UI, replaced. Source resolved per render, not at import.
  [`DeckSelector.tsx:38`](../../components/DeckSelector.tsx#L38)

- Recovery help is now data; a source without `setupHint` still gets a message, not a blank.
  [`DeckSelector.tsx:130`](../../components/DeckSelector.tsx#L130)

- The only other real call site — one line.
  [`page.tsx:35`](../../app/deck/%5BdeckName%5D/page.tsx#L35)

**Persistence — the riskiest edit**

- Normalizes legacy `id: number` / `modelName` on read, so the type stops lying about storage.
  [`history.ts:38`](../../lib/history.ts#L38)

- Mutators read raw so rewriting the list leaves untouched entries byte-identical on disk.
  [`history.ts:57`](../../lib/history.ts#L57)

**Supporting**

- Markup parser kept React-free so it runs under the node-env suite.
  [`setup-hint.ts:22`](../../lib/vocabulary/setup-hint.ts#L22)

- Guards the rule that matters most: never call AnkiConnect directly, always via the proxy.
  [`anki.test.ts:70`](../../lib/vocabulary/sources/anki.test.ts#L70)

- Pins the 200-cap and 100-batching that the refactor had to preserve exactly.
  [`anki.test.ts:228`](../../lib/vocabulary/sources/anki.test.ts#L228)

- Records that lint is expected to fail, so the next agent doesn't chase pre-existing errors.
  [`AGENTS.md:25`](../../AGENTS.md#L25)
