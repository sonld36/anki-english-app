---
title: 'Story 1.4: Giọng mẫu bản ngữ, sinh một lần và giữ lại'
type: 'feature'
created: '2026-08-21'
status: 'done'
baseline_commit: '3f66c9a3e0952b0621738f8ef32769b563c605f2'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-3-sinh-san-thang-goi-y-cung-kich-ban.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Without a native reference recording the script is only text. The learner has
nothing to compare against, and Epic 2 — replaying your own take beside the model's — cannot be
built at all. This is the last story in Epic 1; finishing it makes the epic independently
valuable: pick a deck, get a script, read **and hear** it.

**Approach:** A server-side Azure TTS proxy generates audio for every line of both roles, once,
into a shared IndexedDB blob layer keyed by content. Reopening a script plays from storage and
issues no request. Generation runs in the background so the script is readable immediately.

## Boundaries & Constraints

**Always:**
- Every line of **both** roles gets sample audio, generated **once** and kept.
- Reopening an existing script plays from storage and makes **no** network call.
- The Azure key stays server-side. `/api/live-token` returning `GEMINI_API_KEY` to the browser
  is the mistake this must not repeat.
- Model text is escaped before it enters SSML.
- Storage full or a write error: say so in Vietnamese once; **the script stays usable, only the
  audio is lost.**
- The script renders immediately; audio fills in per turn in the background.
- Azure requests are sequential — the free F0 tier is rate-limited.
- The blob layer is namespaced and general, because Epic 2 reuses it for learner recordings.
- Typecheck and build clean; lint stays at exactly its 3 pre-existing errors.

**Ask First:** adding any dependency (including `fake-indexeddb`); changing
`app/api/pronunciation/route.ts`; touching the Gemini Live path (Story 2.8).

**Never:** deleting `public/audio-processor.worklet.js` (shared recording infrastructure);
pronunciation scoring or recording UI (Epic 2); hint UI (Story 2.4); Tailwind classes; storing
audio in `localStorage`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh script | New script, nothing cached | Each turn fetched once, sequentially, and stored | N/A |
| Reopen script | Every line already stored | Audio plays from storage, **zero `/api/tts` calls** | N/A |
| Partial cache | Some lines stored, some not | Only the missing ones are fetched | N/A |
| Duplicate lines | Two turns with identical text and voice | One stored blob, one fetch — content-keyed | N/A |
| Same text, other role | Identical text, different voice | Two distinct keys, two blobs | N/A |
| Azure not configured | `AZURE_SPEECH_KEY`/`REGION` missing | 503 with the Vietnamese message | Script still readable |
| Azure request fails | Non-2xx or network error | That turn marked failed; others continue | Key never leaked in the body |
| Markup in the line | Text contains `&`, `<`, `>` | Escaped before SSML; audio still generated | Never malformed XML |
| Storage full | `QuotaExceededError` on write | Vietnamese notice once; generation stops cleanly | Script stays fully usable |

</frozen-after-approval>

## Code Map

- `app/api/pronunciation/route.ts` -- **read-only reference, do not modify.** L29-40 is the
  Azure key/region read plus the exact Vietnamese not-configured message to mirror. Same
  credentials, different endpoint (`*.tts.speech.microsoft.com` vs `*.stt.*`).
- `app/api/live-token/route.ts` -- **the anti-pattern.** It hands `GEMINI_API_KEY` to the
  browser. The TTS route must proxy, never expose.
- `lib/dialogue/types.ts` -- `SPEAKER_LABELS` L21 is where the per-role voice map belongs, next
  to the other presentation-level speaker data; `DialogueTurn` L49 supplies `speaker` and `text`.
- `components/DialogueDisplay.tsx` -- the turn render at L161 (`renderHighlightedHtml`) is where
  a per-turn play control attaches. The legacy branch below it is unreachable — leave it alone.
- `lib/dialogue/words.ts` -- `escapeHtml` L14 is the **precedent, not the tool**: SSML is XML, so
  write a small XML escape rather than reusing an HTML one.
- `lib/history.ts` -- `readRaw`/`normalizeEntry` show the house pattern for a storage layer:
  normalize on read, never rewrite what is already stored. The blob layer should feel the same.
- `vitest.config.mts` -- `environment: "node"`, so **there is no IndexedDB in tests**. This is
  why the pure logic must be separable (see Tasks).
- `public/audio-processor.worklet.js`, `lib/wav.ts` -- shared recording infrastructure for Epic
  2. Untouched here.

## Tasks & Acceptance

**Execution:**
- [x] `app/api/tts/route.ts` -- POST `{ text, voice }` → audio bytes via Azure TTS; mirror the
      not-configured message from the pronunciation route; escape text into SSML; request
      `audio-24khz-48kbitrate-mono-mp3` -- the key must never reach the browser.
- [x] `lib/blob-store.ts` -- namespaced IndexedDB blob layer (`putBlob`/`getBlob`/`hasBlob`/
      `deleteNamespace`), namespace `"tts"` here -- Epic 2 reuses it for recordings, so build it
      general now while the coupling is shallow.
- [x] `lib/sample-audio.ts` -- the **pure** part, separated deliberately: content key
      (`sha256(voice + text)`), which turns still need fetching, and how a failure or a quota
      error is classified -- the node-env test suite has no IndexedDB, so the decision logic must
      be testable without it.
- [x] `hooks/useSampleAudio.ts` -- drives generation sequentially in the background and exposes
      `idle | fetching | ready | failed` per turn -- sequential because the Azure F0 tier is
      rate-limited.
- [x] `lib/dialogue/types.ts` -- per-role voice map beside `SPEAKER_LABELS`; two distinct en-US
      neural voices -- one voice reading both parts is indistinguishable by ear, which defeats
      the point.
- [x] `components/DialogueDisplay.tsx` -- a play control per turn, shown when that turn is ready.
- [x] `AGENTS.md` -- document the blob layer, the TTS route, and that Epic 2 reuses the layer.
- [x] Tests -- every matrix row that does not require a real IndexedDB, in particular
      **reopen-a-script issues zero fetches**, content-key identity and voice separation, SSML
      escaping, the 503, and quota handling.

**On the IndexedDB test gap:** `vitest` runs in `node`, which has no IndexedDB. Do **not** add
`fake-indexeddb` — that is an Ask First dependency. Instead keep `lib/sample-audio.ts` free of
IndexedDB and inject the store, so the decision logic is covered and only the thin
IndexedDB-touching wrapper is verified by hand. If that proves impossible, stop and ask.

**Acceptance Criteria:**
- Given a freshly generated script, when it appears, then it is readable immediately and sample
  audio for both roles is produced in the background, once per distinct line and voice.
- Given a script whose audio is already stored, when it is reopened, then audio plays from
  storage and no request to `/api/tts` is made.
- Given the Azure credentials, when audio is generated, then the key is never present in any
  response reaching the browser.
- Given storage is full or a write fails, then the user is told once in Vietnamese and the
  script remains fully usable without audio.
- Given the branch, when typecheck and build run, then both are clean and lint has not regressed.

## Spec Change Log

**2026-08-21 — implementation decisions** (no intent renegotiated):

- **The voice is hashed, not prefixed.** The key is `sha256(voice + " " + text)` with a real
  separator: a bare concatenation would hash `("en-US-A", "vaNeuralhello")` and
  `("en-US-AvaNeural", "hello")` to the same digest. Cheap to get right, impossible to notice
  once wrong.
- **`ALLOWED_VOICES` is a whitelist, not an escape.** The voice name lands in an SSML *attribute*;
  the route checks it against the closed set exported from `lib/dialogue/types.ts` — the same
  reflex as `ALLOWED_ACTIONS` in the Anki route. It is written out **independently** of
  `SPEAKER_VOICES` rather than derived from it: derived, `types.test.ts`'s check that the two
  agree could never fail, while the failure it exists to catch (the app asking for a voice its own
  route rejects, so every line 400s) stays perfectly possible.
- **XML escaping covers `"` and `'` too.** `escapeHtml` was the precedent and deliberately not the
  tool, as the spec says. Control characters are *stripped* rather than escaped: XML 1.0 has no
  entity that makes them legal.
- **The store is a parameter, not an import.** `lib/sample-audio.ts` takes a `SampleAudioStore`
  (`has`/`get`/`put`), so every claim worth testing — reopen fetches nothing, one blob per
  distinct line and voice, sequential fetching, quota stops the loop — is covered in the node
  environment with a `Map`. No `fake-indexeddb`.
- **A fetch failure continues; a write failure stops.** Asymmetric on purpose: one bad line must
  not cost the other eleven, but the disk will not have got emptier by the next line, so the user
  hears about storage once rather than twelve times.
- **No cancellation check between fetch and write.** A React StrictMode remount cancels
  mid-flight; discarding a synthesis that Azure has already been paid for would buy it twice. The
  key is content-derived, so the write is idempotent.
- **`classifyStorageError` duck-types `name`/`message`.** The error that actually matters is the
  `DOMException` off an aborted IndexedDB transaction, and a `DOMException` is not an `Error` —
  `instanceof` would have missed exactly the case the rule exists for.
- **An unreadable store counts as empty.** If `has` throws (private browsing, a corrupt database)
  the line is treated as missing and fetched. Believing a broken store means offering play buttons
  that do nothing; failing on the write at least produces the notice.
- **The `idle` control keeps its slot.** The play button renders as an empty inline box before the
  audio arrives, so lines do not shift sideways as turns fill in behind the reader.

**2026-08-21 — review round 1** (18 patches applied; no intent renegotiated):

- **Both sides of the proxy now time out** (server 15s, client 20s so the server's message wins).
  A hung Azure connection previously stalled the sequential loop forever: that turn spun, every
  later turn stayed `idle`, and nothing errored. A timeout is a per-line failure.
- **A missing or rejected credential is a whole-script condition.** `/api/tts` returns 503 (not
  configured) or 401 (Azure rejected the key); the client raises `SampleAudioProviderError` and
  the driver stops the run with **one** Vietnamese notice, instead of twelve pointless round trips
  and twelve identical warnings that never named the cause. This is what the matrix row already
  claimed happened.
- **Stale statuses and stale content keys across a script change.** The effect learned the new
  script only after two `await`s, so "🔄 Sinh lại" left a window where turn *n* showed the old
  script's status and `play(n)` fetched the **old script's blob** — the learner heard the wrong
  line. State is now derived on script identity at render time (not reset in an effect, which
  would have cost a fourth lint error), and the key map is tagged with the script it came from so
  `play` no-ops rather than reaching backwards.
- **A 200 is not a promise of audio.** Azure answers some faults with an XML error page; cached
  under the content key that is permanent, because the key then looks populated and nothing ever
  refetches it. The route checks `content-type` starts with `audio/`.
- **`text` is length-capped.** `ALLOWED_VOICES` closed the voice field; nothing closed the one
  that is billed per character.
- **Lone surrogates are stripped** along with the control characters. No entity makes them legal
  and they break the request's own UTF-8, so that line simply never got audio.
- **Play is tokenised.** Two quick clicks could resolve out of order, leaving `playingTurn`
  pointing at a turn that is not sounding and revoking an object URL out from under a live
  `Audio`. A stale resolution now cleans up and returns. Clicking the sounding turn stops it, and
  a `ready` turn whose blob has vanished is marked `failed` rather than being a dead button.
- **Two unguarded async holes closed.** `sampleAudioRequests` rejects when `crypto.subtle` is
  absent (an insecure origin) — an unhandled rejection that left every turn `idle` with no
  explanation; and `play()` could resolve after unmount and start audio nothing would stop.
- **The connection cache can recover.** `db.onversionchange` (close and forget, so another tab's
  upgrade is not blocked) and `db.onclose`. Without them one version change made every later
  operation throw `InvalidStateError` for the life of the page, shown as a generic write error.
- **A halt marks the turns it never reached `failed`.** `idle` means "still queued"; a control
  stuck there forever promises audio that is not coming.
- **StrictMode no longer pays Azure twice.** The second mount runs `pendingRequests` before the
  first mount's `put` commits, so line one was fetched — and billed — twice, concurrently, which
  also broke the one-at-a-time property the driver's own test asserts. A module-level in-flight
  map shares the promise.
- **`ALLOWED_VOICES` is an independent literal** (see above), so its test can fail.
- **The `{ text, voice }` payload is crossed end to end.** `sampleAudioPayload` moved into
  `lib/sample-audio.ts` and `route.test.ts` feeds its output straight into `POST`. Renaming a
  field used to 400 every line in the browser while the whole suite and `tsc` stayed green.
- **`initialStatuses` extracted and tested** — same move as the injected store. Iterating
  `pending` instead of `requests` would have left a *reopened* script with no play controls at
  all, and nothing would have failed.
- **Read/write key symmetry is pinned** by a recorder stub (not an IndexedDB simulation, and not
  a new dependency). Dropping the namespace from one side makes `hasBlob` false forever and
  silently re-bills Azure on every reopen.
- **Blob storage no longer only grows.** `deleteBlob` added and `historyStorage.clear()` drops the
  `"tts"` namespace. Per-entry cleanup is deliberately *not* attempted: blobs are content-keyed
  and shared between entries, so deleting one entry's keys can mute another's lines.
- **Accessibility.** Every control names its line ("câu 3 của Sam") instead of twelve identical
  labels; `fetching` and `failed` carry `role`/`aria-label` rather than a `title` alone.
- Also: `Cache-Control: no-store` and the exact `"Thiếu câu cần đọc."` message are asserted, and
  error-string punctuation is consistent.

Deferred by the reviewer, deliberately untouched: the reopen path being unreachable in the product
(Epic 2 owns it), `navigator.storage.persist()`, 429 backoff, per-entry blob cleanup, and the
absence of hook/component tests (no jsdom).

## Design Notes

**Content keys, not entry ids.** Audio is generated before the user clicks save, so there is no
`HistoryEntry.id` to key on yet. `sha256(voice + " " + text)` is available immediately, is stable
across reopening, and deduplicates identical lines across scripts for free. `crypto.subtle` is
already available in the browser.

**Two voices.** The script has two roles and Epic 2 asks the learner to take one of them. One
voice reading both parts removes the only cue that separates them by ear.

**Background, not blocking.** The AC says audio is generated when the script is generated; it
does not say the user must wait. Gemini already costs 5–15s, and 5–12 sequential Azure calls on
top would push a generation past 30s. The script renders first; play controls appear per turn.

## Verification

**Commands:**
- `npm test` -- expected: all pass, including the zero-fetch-on-reopen case.
- `npx tsc --noEmit` -- expected: no errors.
- `npm run build` -- expected: succeeds.
- `npm run lint` -- expected: **exactly 3 errors** (`app/page.tsx:15`, `app/practice/page.tsx:18`,
  `components/HistoryPanel.tsx:19`). A 4th means this story regressed something.

**Manual checks** (needs Anki + AnkiConnect on :8765, `GEMINI_API_KEY`, Azure key, `npm run dev`):
- Generate a script → it renders immediately; play controls appear turn by turn.
- Play a few → native audio, and the two roles are audibly different voices.
- **DevTools › Network filtered to `tts`: reload, reopen that same script → zero requests.** This
  is the story's central claim; check it explicitly.
- DevTools › Application › IndexedDB → blobs present under the `tts` namespace.

## Suggested Review Order

**The claim the story rests on**

- Start here: which lines still need a call. Reopening returns `[]`, so nothing downstream can fetch.
  [`sample-audio.ts:119`](../../lib/sample-audio.ts#L119)

- Content key, not entry id — audio exists before the user saves, and identical lines dedupe.
  [`sample-audio.ts:43`](../../lib/sample-audio.ts#L43)

- Per-turn UI state, extracted pure so the mapping is testable without a DOM.
  [`sample-audio.ts:145`](../../lib/sample-audio.ts#L145)

- Sequential, and asymmetric on purpose: a bad line costs one line, a bad disk stops the run.
  [`sample-audio.ts:283`](../../lib/sample-audio.ts#L283)

**Keeping the key server-side**

- The proxy. Compare against `/api/live-token`, which is the mistake this must not repeat.
  [`route.ts:104`](../../app/api/tts/route.ts#L104)

- A rejected key is a whole-script condition, not twelve unlucky lines.
  [`route.ts:170`](../../app/api/tts/route.ts#L170)

- A 200 carrying an XML error page would be cached as MP3 forever — content-type is the guard.
  [`route.ts:185`](../../app/api/tts/route.ts#L185)

- Billed per character, so the text field is capped.
  [`route.ts:130`](../../app/api/tts/route.ts#L130)

**Storage**

- Namespaced, general on purpose: Epic 2 reuses this for learner recordings.
  [`blob-store.ts:32`](../../lib/blob-store.ts#L32)

- Without this a single version change poisons every later write for the life of the page.
  [`blob-store.ts:71`](../../lib/blob-store.ts#L71)

**Contract**

- Two roles, two voices, written out independently so the test can actually fail.
  [`types.ts:53`](../../lib/dialogue/types.ts#L53)

- The payload the client posts, shared with the route test so a rename cannot pass silently.
  [`sample-audio.ts:92`](../../lib/sample-audio.ts#L92)
