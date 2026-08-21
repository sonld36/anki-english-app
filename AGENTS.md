<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- bmad:context -->
<!-- Verified 2026-08-19 against 6d4c784289c1341d3e89fbf0a26536ce475fea1f. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## anki-english-app

Single-flow app (no auth, no database) that turns an Anki deck into an AI-generated dialogue, then a real-time spoken-practice session. All persistence is `localStorage` — there is no backend datastore. Flow: `/` (deck picker) → `/deck/[deckName]` (dialogue generation) → `/practice?id=...` (voice practice).

## Where things are

- Vocabulary loading: `lib/vocabulary/` — `types.ts` holds the neutral, transport-free `VocabularyItem` / `VocabularyCollection` types **and** the `VocabularySource` contract (import these, never source-specific ones); `source.ts` holds only the registry (`getVocabularySource()`, defaults to Anki) and re-exports the interface; `sources/anki.ts` is the one concrete implementation; `setup-hint.ts` parses a source's connection-help steps (`**bold**`, `` `code` ``) into React-free segments. Anki internals (`AnkiCard`, HTTP calls, field parsing) are module-private — add a new source as a sibling under `sources/`, don't widen the Anki module's exports. Concrete sources import the interface from `types.ts`, never from `source.ts`, so the registry stays a leaf.
- Anki access goes through `app/api/anki/route.ts` — never call `http://127.0.0.1:8765` (AnkiConnect) directly from client code, it has no CORS headers.
- Dialogue generation: `lib/gemini.ts` + `app/api/dialogue/route.ts`.
- Voice practice: `hooks/useGeminiLive.ts` + `public/audio-processor.worklet.js`.
- History/persistence: `lib/history.ts` — the only persistence layer in the app.

## Running and verifying

- Tests run with Vitest: `npm test` (`vitest run`, config in `vitest.config.mts` — the `.mts` extension is deliberate, `.ts` triggers a Vite `configLoader` deprecation warning). Specs are `*.test.ts` next to the code, under `lib/`, `app/`, `components/`, or `hooks/`. Coverage is thin and node-environment only — there is no jsdom, so no component or E2E testing setup; a `.test.tsx` will be collected and then fail for want of a DOM.
- `npm run lint` is **not** clean and isn't expected to be: 3 pre-existing `react-hooks/set-state-in-effect` errors at `app/page.tsx:15`, `app/practice/page.tsx:18`, `components/HistoryPanel.tsx:19`, plus assorted unused-var warnings. They predate the vocabulary-source refactor — don't go chasing them as if you broke something. `npx tsc --noEmit` and `npm run build` are clean, and should stay that way.
- Anki Desktop + the AnkiConnect add-on must be running locally on port 8765 for anything past the landing page to work; there's no way to tell this from the code alone.
- `GEMINI_API_KEY` must be set in `.env.local`; the literal placeholder `"your_gemini_api_key_here"` is treated as "not configured" by app code.

## Conventions that differ from defaults

- Styling is inline `style={{}}` plus global utility classes in `app/globals.css` — `tailwindcss` is a dependency but unused in components; don't introduce Tailwind classes.
- UI copy is in Vietnamese — keep new user-facing strings consistent with that.
- `app/api/anki/route.ts` enforces a hardcoded `ALLOWED_ACTIONS` whitelist (read-only) on AnkiConnect calls — extend it deliberately, never remove or bypass the check.
- `app/api/dialogue/route.ts` falls through a hardcoded list of Gemini model names on failure/quota errors — when changing models, edit the `models` array there, not the `ai`/`@ai-sdk/google` SDK deps (they're installed but unused; the route calls the Gemini REST endpoint directly).

## Known pitfalls

- `app/api/live-token/route.ts` returns the raw `GEMINI_API_KEY` to the browser — deliberate dev-only shortcut, not a bug to "fix"; production would need ephemeral tokens instead.
- If AnkiConnect isn't running, deck loading fails with a Vietnamese connection-error message that can look like a UI bug rather than a missing dependency.

<!-- /bmad:context -->
