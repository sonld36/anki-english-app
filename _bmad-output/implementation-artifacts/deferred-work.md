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

- source_spec: `spec-1-4-giong-mau-ban-ngu-sinh-mot-lan.md`
  summary: The story's central claim — reopening a script makes zero `/api/tts` calls — has no UI path in the product and cannot be checked by hand.
  evidence: All three review layers found this independently. `DialogueDisplay` is mounted from exactly one place (`app/deck/[deckName]/page.tsx`) and only for a script held in React state; a saved entry opens `/practice?id=…` → `VoicePractice`, which renders the script as one flattened markdown string with no per-turn control. A reload clears the state, so nothing re-renders a stored script. The claim is proven only by `pendingRequests` unit tests. Stored blobs are reused today only when a later generation happens to reproduce an identical line on the same role. Epic 2 builds the practice screen and should own the reopen path — decide there rather than bolting a reopen view onto Epic 1.

- source_spec: `spec-1-4-giong-mau-ban-ngu-sinh-mot-lan.md`
  summary: Per-entry audio cleanup is unsolved because blobs are content-keyed and deliberately shared between entries.
  evidence: Deleting one history entry's audio keys can silently mute another entry that reuses the same line on the same role — the dedupe that saves Azure calls is exactly what makes deletion unsafe. Needs reference counting, or an accepted policy of only ever clearing the whole namespace. Story 1.4 wires `clear()` to `deleteNamespace("tts")` and stops there.

- source_spec: `spec-1-4-giong-mau-ban-ngu-sinh-mot-lan.md`
  summary: A throttled line (Azure F0 429) is marked failed permanently — no backoff, no `Retry-After`, no per-turn retry.
  evidence: The free tier's rate limit is the stated reason generation is sequential, so on a 12-line script throttling is closer to the expected case than an edge case. The only recovery available to the user is regenerating the whole script, which also costs a Gemini call. Wants backoff plus a per-turn retry affordance.

- source_spec: `spec-1-4-giong-mau-ban-ngu-sinh-mot-lan.md`
  summary: "Generated once and kept" is not backed by a persistence request, and the hook/component layer has no automated tests.
  evidence: No `navigator.storage.persist()` and no `estimate()` pre-check before writing roughly a dozen MP3s — a non-persisted origin may have the whole database evicted, and (given the reopen gap above) nothing would regenerate it. Separately, `useSampleAudio` and `SampleAudioControl` are untested because the suite is node-only with no jsdom; that is where the wiring between decision, transport and render lives, so it is hand-verified only.

- source_spec: `spec-1-3-sinh-san-thang-goi-y-cung-kich-ban.md`
  summary: `SUPPORTED_SCRIPT_VERSIONS` grows on every schema change and there is no migration path — old entries are read as-is forever.
  evidence: Every consumer must branch on version indefinitely, and `hasHints` is the only affordance for doing so. Upgrading v2 entries in place on read (inside `normalizeEntry`) would let the array shrink back, but that means rewriting stored data — the one thing Stories 1.1–1.3 have deliberately never done. Worth an explicit decision before a version 4 exists.

- source_spec: `spec-1-3-sinh-san-thang-goi-y-cung-kich-ban.md`
  summary: `DialogueScript.version` is now the union `2 | 3`, so a v2 script type-checks everywhere a freshly generated one is expected.
  evidence: Widening the literal to a union removed the compiler's ability to distinguish "something we can read" from "something we may write". `buildScript` and `historyStorage.save` both happen to write the current constant, so nothing is wrong today, but a write-side type (`DialogueScript & { version: typeof DIALOGUE_SCRIPT_VERSION }`) is what would keep it that way.

- source_spec: `spec-1-2-kich-ban-thanh-du-lieu-co-cau-truc.md`
  summary: Trimming the deck to 20 target words is silent.
  evidence: `cards.slice(0, MAX_TARGET_WORDS_PER_SCRIPT)` drops everything past the twentieth card with no user-facing notice, so a learner who selected 35 words is never told that 15 of them are not in the script. Epic 3 replaces this selection logic with due-date logic, which is the natural place to fix it.

- source_spec: `spec-1-1-nap-tu-vung-qua-lop-nguon-thay-the-duoc.md`
  summary: The collection id interpolates unescaped into the AnkiConnect search query.
  evidence: `fetchDeckCards` builds `` `deck:"${deckName}"` `` from a `decodeURIComponent`'d URL segment. A name containing `"` breaks the query and a crafted URL can alter the search expression. Pre-existing and bounded by the read-only `ALLOWED_ACTIONS` whitelist, so it widens read scope rather than enabling writes.

- source_spec: `spec-fix-dialogue-422-vocab-parsing.md`
  summary: The Back-bold fallback only triggers when the Front fails the Vietnamese-letters test, so an English-language (or diacritic-free Vietnamese) instruction front is accepted as the learnable unit.
  evidence: `parseCard` strategy 1 checks `isUsableEnglish(frontUnit)` only; a shared deck with fronts like "Listen and repeat the sentence" passes as the word while the real unit sits in Back's bold. All of the user's current decks write instructions with diacritics, so this is a portability gap, not a live failure.

- source_spec: `spec-fix-dialogue-422-vocab-parsing.md`
  summary: Phrase-deck placeholders like "(sb)", "(sth)", "(one's)" survive cleaning and produce permanently unmatchable target words.
  evidence: `POS_TOKEN` covers grammatical abbreviations only; "look after (sb)" keeps the parenthetical, and a target word containing "(sb)" can never appear verbatim in dialogue text, so every generation from such a card burns the repair and 422s. Not present in the user's current decks.

- source_spec: `spec-fix-dialogue-422-vocab-parsing.md`
  summary: `stripHtml`'s four-entity decoding now affects the `word` field, where an undecoded entity is a fatal match failure rather than cosmetic noise.
  evidence: Extends the existing `&agrave;` deferred entry: a front containing `don&#39;t` yields a word with the literal entity, `containsWord` can never match it in generated text, and the target-word violation is fatal. Pre-existing decoder, newly consequential because words are now extracted from richer HTML.

- source_spec: `spec-fix-dialogue-422-vocab-parsing.md`
  summary: Long first-person sentence targets from shadowing decks still 422 sometimes, because the model naturally rewrites the person rather than quoting the line verbatim.
  evidence: Observed live after the fix: the card "I have chronic pain or a chronic backache" produced the line "Imagine if you had chronic pain or a chronic backache" — a fatal target-word violation that survived the repair. Extraction is correct here; the limit is that `validateScript` demands verbatim whole-phrase presence while the prompt asks for natural dialogue, and a first-person sentence assigned to the wrong speaker cannot be both. Affects sentence-shadowing decks only, and only some word selections; single words and short phrases are unaffected. Options: relax matching for long targets, prefer assigning such targets to the matching speaker, or let a long-target miss be a soft violation.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-dien-kich-ban-theo-luot-trong-khung-chat.md`
  summary: The ✕ delete button in `components/HistoryPanel.tsx` deletes an entry and simultaneously navigates to `/practice?id=` for the entry it just removed, when activated with the keyboard.
  evidence: The card is `role="button" tabIndex={0}` with `onKeyDown={(e) => e.key === "Enter" && handleViewEntry(entry)}` (components/HistoryPanel.tsx:176-178). `handleDelete` calls `stopPropagation()` on the MouseEvent only (`:23-24`, wired at `:204`), so Enter on the focused ✕ fires the button's synthesized click *and* bubbles the keydown to the card. Pre-existing — not introduced by Story 2.1, which hit the identical hole on its own new button and fixed it there (`:270`). Same one-line `onKeyDown={(e) => e.stopPropagation()}`.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-ghi-am-luot-cua-minh-va-nghe-lai-canh-giong-mau.md`
  summary: NFR-10's privacy disclosure — telling the learner their voice leaves the device for scoring — must land in Story 2.3, which is where audio first leaves the device.
  evidence: PRD §8.2 / NFR-10 require it, but no planning document says what to show or when, and Story 2.2 uploads nothing, so there was no honest moment to show it. Deferred at the human's direction during planning.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-ghi-am-luot-cua-minh-va-nghe-lai-canh-giong-mau.md`
  summary: Nothing caps the length of a single take — PCM chunks accumulate unbounded in memory and the resulting WAV can exhaust the IndexedDB quota.
  evidence: Review finding. The epic assigns the 30-second clip cap to Story 2.3 as a scoring-cost constraint, so it was out of scope here, but the memory-growth half of the problem is Story 2.2's and is currently unbounded.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-ghi-am-luot-cua-minh-va-nghe-lai-canh-giong-mau.md`
  summary: `replayTurn` in SessionView is cleared only by `stopPlayback`, never when playback ends on its own, so the reaper's exemption for that turn index stays armed indefinitely.
  evidence: Review finding. Harmless today because `audioTurnToPlay` can never yield a learner index, but Story 2.5's sanctioned reveal will play a learner line and would inherit a stale exemption.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-cham-diem-ngay-trong-luong-chat.md`
  summary: Offline scoring queue — hold a scoring request while the network is down and send it when connectivity returns.
  evidence: EXPERIENCE.md requires queue-then-send and it is an open Epic 2 action item, but the epics.md AC for Story 2.3 only requires "say clearly that scoring failed, the session still goes on". Deferred at the human's direction during planning; a lost connection is treated as one more scoring failure.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-cham-diem-ngay-trong-luong-chat.md`
  summary: No way to retry a failed assessment — a network/timeout/service failure ends the turn unscored, with re-recording as the only recourse.
  evidence: Review finding. The take is still in the `recordings` namespace, so a "chấm lại" action would cost nothing beyond the retried call and would make the "buổi luyện vẫn đi tiếp" copy less of a dead end. Out of scope here: Story 2.3's AC only requires the failure be reported clearly.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-cham-diem-ngay-trong-luong-chat.md`
  summary: There is no way to practise with scoring switched off — the privacy disclosure is notification-only, shown after the take is already captured.
  evidence: Review finding. NFR-10 requires telling the learner their voice leaves the device, which this story does, but offers no consent choice. A scoring-off mode is a product decision and touches the Settings surface that is itself an open Epic 2 action item.
