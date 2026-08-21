# Deferred Work

Pre-existing issues surfaced incidentally by reviews. Not caused by the story that found them.

- source_spec: `spec-1-1-nap-tu-vung-qua-lop-nguon-thay-the-duoc.md`
  summary: `npm run lint` reports 3 pre-existing `react-hooks/set-state-in-effect` errors in `app/page.tsx:15`, `app/practice/page.tsx:18`, `components/HistoryPanel.tsx:19`.
  evidence: Verified against baseline `730bd98` in a clean worktree — baseline is 3 errors / 7 warnings, post-story is 3 errors / 6 warnings. No regression, but every story with a "lint clean" AC will keep tripping on it. Fixing means restructuring effects in files outside any current story's scope.

- source_spec: `spec-1-1-nap-tu-vung-qua-lop-nguon-thay-the-duoc.md`
  summary: The UI still speaks "deck" everywhere, so a non-Anki source would render "Chọn Deck CSV".
  evidence: `VocabularySource` is neutral, but the surrounding vocabulary is not — route `/deck/[deckName]`, props `onSelectDeck`/`selectedDeck`, copy "Chọn Deck {label}" and "— Chọn một deck —", and the persisted `HistoryEntry.deckName`. Renaming the persisted field would break stored history, so it needs its own migration story. Story 1.1 deliberately scoped to the data seam only.

- source_spec: `spec-1-1-nap-tu-vung-qua-lop-nguon-thay-the-duoc.md`
  summary: `VocabularyCollection.id` and `.name` are separated in the type but re-conflated downstream.
  evidence: `DeckSelector` passes `deck.id` to `onSelectDeck`; `app/page.tsx` and `app/deck/[deckName]/page.tsx` then render that same value as the human-readable label and persist it as `HistoryEntry.deckName`. Correct today only because `ankiSource.listCollections()` sets `id === name`. The second source the seam exists for would display raw ids, and no current test could catch it.

- source_spec: `spec-1-1-nap-tu-vung-qua-lop-nguon-thay-the-duoc.md`
  summary: The AnkiConnect adapter has no defence against malformed or partial proxy responses.
  evidence: Moved verbatim from `lib/anki.ts`, so pre-existing. `callAnki` assumes the body parses as JSON (an HTML 502 surfaces a raw `SyntaxError` to the user); `deckNames`/`findCards` results are assumed to be arrays; one failing batch mid-loop discards every batch already fetched. All are realistic AnkiConnect/proxy failure modes.

- source_spec: `spec-1-1-nap-tu-vung-qua-lop-nguon-thay-the-duoc.md`
  summary: The 200-card cap truncates silently and an all-filtered deck is indistinguishable from an empty one.
  evidence: `fetchDeckCards` slices to 200 with no signal, so a 500-card deck silently drops 300 words. Separately, a deck whose cards are all dropped by `.filter(c => c.word && c.meaning)` — e.g. single-field Cloze — renders an empty list identical to "deck not found", with no message either way. Both pre-existing; the seam is the natural place to distinguish the cases.

- source_spec: `spec-1-1-nap-tu-vung-qua-lop-nguon-thay-the-duoc.md`
  summary: `parseCard` ignores the `order` field it reads, falling back to JSON key order instead.
  evidence: Each Anki field carries an explicit `order`, but the unknown-field-name fallback uses `Object.keys(fields)[0]`/`[1]`. Pre-existing. The current test cannot catch a divergence because its `card()` helper derives `order` from `Object.entries` position — so code and test agree only by construction.

- source_spec: `spec-1-1-nap-tu-vung-qua-lop-nguon-thay-the-duoc.md`
  summary: `stripHtml` decodes only `&nbsp; &amp; &lt; &gt;`, leaving accented entities like `&agrave;` raw.
  evidence: Pre-existing, and now pinned by a passing assertion (`meaning: "xin ch&agrave;o"`) that deliberately preserves current behavior. Vietnamese Anki exports routinely contain accented entities, so this is a live data-quality bug for the app's actual users — it just is not Story 1.1's to fix.

- source_spec: `spec-1-2-kich-ban-thanh-du-lieu-co-cau-truc.md`
  summary: `generateDialogue` in `lib/gemini.ts` is dead code — `DialogueGenerator.tsx` does its own inline `fetch("/api/dialogue")`.
  evidence: Pre-existing duplication that Story 1.2 made worse by updating the dead function's signature to return `DialogueScript`. Two copies of the call contract now exist and the dead one is the one that cannot surface `violations`. Either route the component through the helper or delete it.

- source_spec: `spec-1-2-kich-ban-thanh-du-lieu-co-cau-truc.md`
  summary: A truncated or safety-blocked Gemini response is misclassified as a transport failure and burns the whole model fallback.
  evidence: `finishReason` is never inspected. A response cut off at `maxOutputTokens: 4096` yields a valid-prefix-but-incomplete JSON body, `JSON.parse` throws, and the route treats it as "unparseable" — so it retries all four models on a problem no model will solve. Structured JSON is bulkier than the old markdown, so truncation is likelier now than before this story.

- source_spec: `spec-1-2-kich-ban-thanh-du-lieu-co-cau-truc.md`
  summary: The dialogue route has no overall time budget — worst case is roughly 150 seconds.
  evidence: Four models plus one repair call, each with its own `AbortSignal.timeout(30000)`, run serially. There is no `maxDuration` on the route, no deadline shared across attempts, and the browser fetch has no timeout of its own. Story 1.2 added the fifth call; the underlying shape predates it.

- source_spec: `spec-1-2-kich-ban-thanh-du-lieu-co-cau-truc.md`
  summary: Constraint constants are duplicated in the UI and mutually constrained with nothing asserting it.
  evidence: `MAX_TARGET_WORDS_PER_SCRIPT` was introduced as "one definition, two readers", but `DialogueGenerator.tsx` still hardcodes `Math.min(cards.length, 20)` in two places and `app/deck/[deckName]/page.tsx` keeps an unrelated `cards.slice(0, 10)` fallback. Separately, 20 words at 2 per turn needs 10 of at most 12 turns, so lowering `MAX_TURNS` would make the cap unsatisfiable and produce a permanent 422 — nothing asserts `MAX_TARGET_WORDS_PER_SCRIPT <= MAX_TURNS * MAX_TARGET_WORDS_PER_TURN`.

- source_spec: `spec-1-2-kich-ban-thanh-du-lieu-co-cau-truc.md`
  summary: The validator does not enforce speaker alternation or a minimum number of learner turns, though the prompt asks for both.
  evidence: `validateScript` only checks that each speaker appears at least once, so four `system` turns followed by one `learner` turn passes. Learner turns are the entire point of Epic 2's practice loop, so a script that is 80% system turns is close to useless there. AGENTS.md tells future agents to change rules in the validator rather than the prompt, which makes this gap misleading as well as real.

- source_spec: `spec-1-2-kich-ban-thanh-du-lieu-co-cau-truc.md`
  summary: Trimming the deck to 20 target words is silent.
  evidence: `cards.slice(0, MAX_TARGET_WORDS_PER_SCRIPT)` drops everything past the twentieth card with no user-facing notice, so a learner who selected 35 words is never told that 15 of them are not in the script. Epic 3 replaces this selection logic with due-date logic, which is the natural place to fix it.

- source_spec: `spec-1-1-nap-tu-vung-qua-lop-nguon-thay-the-duoc.md`
  summary: The collection id interpolates unescaped into the AnkiConnect search query.
  evidence: `fetchDeckCards` builds `` `deck:"${deckName}"` `` from a `decodeURIComponent`'d URL segment. A name containing `"` breaks the query and a crafted URL can alter the search expression. Pre-existing and bounded by the read-only `ALLOWED_ACTIONS` whitelist, so it widens read scope rather than enabling writes.
