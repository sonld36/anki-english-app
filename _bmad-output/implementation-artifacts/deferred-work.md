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

- source_spec: `spec-1-1-nap-tu-vung-qua-lop-nguon-thay-the-duoc.md`
  summary: The collection id interpolates unescaped into the AnkiConnect search query.
  evidence: `fetchDeckCards` builds `` `deck:"${deckName}"` `` from a `decodeURIComponent`'d URL segment. A name containing `"` breaks the query and a crafted URL can alter the search expression. Pre-existing and bounded by the read-only `ALLOWED_ACTIONS` whitelist, so it widens read scope rather than enabling writes.
