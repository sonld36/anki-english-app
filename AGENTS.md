<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- bmad:context -->
<!-- Verified 2026-08-19 against 6d4c784289c1341d3e89fbf0a26536ce475fea1f. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## anki-english-app

Single-flow app (no auth, no database) that turns an Anki deck into an AI-generated dialogue, then a real-time spoken-practice session. All persistence is `localStorage` — there is no backend datastore. Flow: `/` (deck picker) → `/deck/[deckName]` (dialogue generation) → `/practice?id=...` (voice practice).

## Where things are

- Anki access: `lib/anki.ts`, proxied through `app/api/anki/route.ts` — never call `http://127.0.0.1:8765` (AnkiConnect) directly from client code, it has no CORS headers.
- Dialogue generation: `lib/gemini.ts` + `app/api/dialogue/route.ts`.
- Voice practice: `hooks/useGeminiLive.ts` + `public/audio-processor.worklet.js`.
- History/persistence: `lib/history.ts` — the only persistence layer in the app.

## Running and verifying

- No test suite exists in this repo — don't assume one.
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
