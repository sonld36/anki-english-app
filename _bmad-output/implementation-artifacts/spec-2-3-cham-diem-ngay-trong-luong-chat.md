---
title: 'Story 2.3: Chấm điểm ngay trong luồng chat'
type: 'feature'
created: '2026-08-23'
status: 'done'
baseline_commit: '4ac2cf50216e8cdf8270e5bf971ff29975e7558d'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-2-ghi-am-luot-cua-minh-va-nghe-lai-canh-giong-mau.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 2.2 captures the learner's take and stops there. Nothing tells them which sound
they got wrong, so the take is a recording with no verdict — and Story 2.5 has no pass/fail signal
to hang its three-attempt limit on.

**Approach:** When a take is finished, send its trimmed WAV to the existing `/api/pronunciation`
Azure proxy with the turn's line as `ReferenceText`, decide **Đạt / Chưa đạt** purely from
**phoneme-level** scores on the turn's own target words, and render the verdict as a score card
stuck under the turn just spoken — without ever showing the line itself.

## Boundaries & Constraints

**Always:**
- The pass gate is **phoneme-level, on target words only**: every phoneme of every target word
  ≥ 30 ⇒ Đạt. Below 30 blocks Đạt; below 60 is a tier-2 warning that never blocks.
- **Never** decide from `PronScore`, word-level `AccuracyScore`, `ErrorType`, `FluencyScore`,
  `CompletenessScore` or `ProsodyScore` — measured to reward swallowed sounds and punish careful
  speech. They may be displayed for reference; they may not gate anything.
- Every decision worth a test lives in a pure `lib/` module — `vitest` is `environment: "node"`,
  no jsdom, no IndexedDB. The browser hook stays thin.
- The learner's line is still **never rendered as text**. The score card is a **fourth, separate
  projection** (after `TurnView`, `audioTurnToPlay`, `sampleReplayUnlocked`) and may name
  individual words only — never the line, and never enough of it in sequence to reconstruct it.
- Silence is trimmed before sending (Azure bills per second) and a take over **30 s** is not sent
  at all — the cost guard the epic assigns to this story.
- The learner is told, **before their audio first leaves the device**, that it goes to Microsoft
  Azure for scoring (NFR-10, deferred here from Story 2.2).
- A scoring failure never guesses a number, never blames the microphone, and never blocks the
  session — "Tiếp" stays open exactly as it is today.
- Every state carries a glyph **and** words: Đạt = `✓` + "Đạt", Chưa đạt = `✗` + "Chưa đạt",
  tier 2 = `!` + a dashed border. No state by colour alone; the verdict is screen-reader reachable.
- `/api/pronunciation` is the app's second Azure proxy and must match the first: bounded timeout,
  key redacted out of anything Azure echoes back, a 401 branch for a rejected credential.

**Ask First:**
- Persisting any score, or adding a per-turn attempt counter (Story 2.5 owns both).
- Showing the full recognised transcript (`DisplayText`) — scripted assessment can echo the
  reference text back, which would be a full reveal.

**Never:**
- The hint ladder, the three-attempt limit and its answer reveal, latency measurement, the
  end-of-session summary — Stories 2.4–2.7.
- An offline scoring queue: a lost connection is one more scoring failure (see `deferred-work.md`).
- Persisting scores to `localStorage` or IndexedDB. In-memory for one session, like 2.1 and 2.2.
- Generating the articulation-coaching text at runtime, or at all — Story 2.5's packaged library.
- Touching `app/lab/pronunciation/page.tsx` beyond importing shared logic out of it.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Take scores clean | every phoneme of every target word ≥ 60 | card: `✓ Đạt`, target-word chips, latency in seconds | N/A |
| Below the warn line | a target-word phoneme in 30–59 | still `✓ Đạt`, plus a `!` tier-2 finding naming that phoneme | N/A |
| Below the pass line | a target-word phoneme < 30 | `✗ Chưa đạt`, that phoneme marked; verdict is direct, no filler praise | N/A |
| Tier-2 pattern on any word | final consonant, an `-s`/`-ed` ending, or a cluster member scoring < 60 | prominent `!` finding; never blocks Đạt | N/A |
| Tier-3 detail | a stopword scoring low | hidden behind the card's details disclosure | N/A |
| Scoring in flight | request dispatched | card mounts at once in a worded pending state; "Tiếp" already usable | N/A |
| First upload of a session | before the first request leaves | one Vietnamese notice: voice goes to Azure to be scored, not kept there | shown once per session |
| Take over 30 s | `take.durationMs > 30_000` | nothing sent; worded notice; turn unscored, session unaffected | N/A |
| Scoring fails | 4xx/5xx/timeout/offline | card says scoring failed and why, in Vietnamese; **no score invented** | turn unscored, "Tiếp" open |
| Re-record | mic tapped on a scored turn | previous take **and** its score dropped together; card returns to empty | N/A |
| Credential rejected | Azure 401/403 | route returns 401 with a credential message, key redacted from the body | as scoring failure |

</frozen-after-approval>

## Code Map

- `app/api/pronunciation/route.ts:213-237` -- the POST handler. `multipart/form-data`: `audio` (Blob,
  `:214-226`), `referenceText` (`:216`), `provider` (`:217`, default `"azure"`, anything but the literal
  `"gemini"` goes to Azure at `:229-231`). Returns `{ provider, latencyMs, raw }` (`:93`) where `raw` is
  **verbatim Azure JSON**, unparsed. Config already correct and load-bearing: `Dimension: "Comprehensive"`
  `:46` (comment `:19-20` — without it Azure silently degrades to Basic), `Granularity: "Phoneme"` `:45`,
  `PhonemeAlphabet: "IPA"` `:51`, `EnableMiscue` `:49`, `NBestPhonemeCount: 5` `:52`. Statuses today:
  400 `:219-224`, 503 `:32-40`, 502 `:76-91`, 500 `:232-237`. **Three gaps to close:** no `signal`/timeout on
  the fetch at `:61-72`, no 401/403 branch, and `:78` + `:234` interpolate Azure's body and the thrown
  message with **no key redaction**. `app/api/tts/route.ts` has all three — `AZURE_TIMEOUT_MS = 15_000` `:56`,
  `signal` `:170`, 401 branch `:178-186`, `withoutKey` `:113-115` applied `:187`,`:235`, size cap `:45`,`:144-149`.
  Copy those shapes; the 503 wording is already deliberately identical across both routes (`tts:122-130`).
- `app/lab/pronunciation/page.tsx:51-68` -- the **only** place in the repo that types the Azure response,
  with the load-bearing comment at `:51-53`: the REST API for short audio returns scores **flat on
  `NBest[0]`** and on each word/phoneme, unlike the Speech SDK. Chain is `raw.NBest[0].Words[].Phonemes[]`
  with `{ Phoneme, AccuracyScore }`. Move `AzureWord`/`AzureNBest` and the `raw → words` extraction into
  `lib/pronunciation.ts` and import them back here. `:87-91` `scoreColor` is lab-only (80/60/else) — **not**
  this story's thresholds. Its own recording loop `:170-237` stays untouched.
- `lib/session.ts:95-138` `SessionState` (9 fields), `:86-93` `CompletedTurn`, `:77-83` `TurnTake`
  (`key`/`durationMs`/`peak`), `:67` `TurnPhase`. `:217-226` `startRecording` deletes `takes[cursor]` —
  a score must be dropped in the same place. `:228-244` `finishRecording` is the only writer of a take.
  `:289-335` `completeCurrentTurn` builds `CompletedTurn` `:304-312` and clears `takes` when done `:314-327`.
  `:481-491` `canContinue` — must stay independent of scoring. `:367-395` `TurnView` and `:697-721`
  `audioTurnToPlay` are the leak invariants that must not change; `:508` `sampleReplayUnlocked` is the
  precedent for adding a separate projection rather than a flag.
- `lib/session.test.ts:730-740` -- exhaustive `Object.keys(state)` list (9 keys) that **fails by design**
  when a field is added to `SessionState`; `:94-104` full-object `toEqual` on `createSession()` does too.
  Update both deliberately. `:382-415` and `:980-1023` are the two leak sweeps that serialise every
  projection and assert no learner line, target word or hint text appears — a new projection must be
  added to the `:1014-1023` set, which means the sweep's expectations need the target-word exemption
  reasoned about explicitly, not silently relaxed.
- `lib/recording.ts:47-51` `RecordingStore`, `:64-67` `RecordingNotice { glyph, text, tone }` — reuse this
  notice shape, do not define a parallel one. `:311-320` `loadTake(store, key)` is how the hook re-obtains
  the Blob: `hooks/useTurnRecorder.ts:274-312` `stop()` returns only `{ key, durationMs, peak }`, never the
  Blob, and discards the trimmed samples when it returns. `:28` `RECORDING_NAMESPACE`.
  `lib/recording.test.ts:293`,`:314` pin that no notice blames the mic and that `peakWarning` never mentions
  a score — the new copy must stay clear of both.
- `lib/wav.ts:19` `SAMPLE_RATE`, `:36` `durationMs`, `:104-111` `LOW_PEAK_THRESHOLD`/`isPeakTooLow` (comment
  `:104-106` says this story reads it), `:154` `trimSilence` (already applied before storage).
- `lib/dialogue/stopwords.ts:87` `isStopword`, `:72` `tokenize`, `:114` `containsSequence` +
  `lib/dialogue/types.ts:140` `MIN_LEAKED_CONTENT_WORDS = 4` -- reuse for tier 3 and for the leak test that
  the card's words never form a reconstructable run of the line. `lib/dialogue/words.ts:44` `containsWord` is
  the only sanctioned word matcher — target words are carried as data, never found by substring.
- `components/SessionView.tsx:768-811` play-controls row, `:816-823` the per-turn `session-note` (the closest
  precedent for a card-adjacent status), `:828-837` "Tiếp". **Insert the score card between `:811` and `:828`**,
  inside the per-turn column that closes at `:858`; the column is right-aligned for learner turns (`:705`) and
  sits inside the `role="log" aria-live="polite"` region (`:667-671`), so the card is announced on insert.
  `:609-627` the notice bar renders `{glyph, text, tone}` with a dismiss button. `:119-128` all three state
  slots; `:110` `useTurnRecorder`; `:443-470` the stop-and-store handler where scoring is kicked off.
- `app/globals.css:47-80` DESIGN tokens (`--success`/`--danger`/`--warning` `:56-58`, `--space-1..6` `:69-74`,
  `--radius-sm/md/lg` `:76-79`), `:66` `--font-phonetic` — declared, **zero consumers**, this story is its
  first. `:482-509` `.session-note--info/warning/danger`, `:447-467` `.session-chip`, `:513-559` notice bar.
  No `.session-score*` class exists. `color-mix()` is unsafe here; declare literal `rgba()` (AGENTS.md).
- `DESIGN.md:55,154-155` -- score card is `radius md`, hairline border, stuck under the turn just spoken;
  first line is the verdict plus the time, below it the target words as chips coloured by tier.
  `:89-93` binds the three colours to the 30/60 thresholds. `:112-114` the IPA font-stack rule and
  `:103-107` the one-family rule that bounds it. `:128-132` layer with background colour, never shadow.
  `:175` do not dramatise a failure. `EXPERIENCE.md:86-88` the three tiers, `:99-101` show the utterance
  first and let the card fill in below, `:113-114` scoring failure says so plainly and invents no number,
  `:139-148` the no-colour-alone rule and why, `:141-145` the mandated glyph+word table, `:155-156`
  the verdict must be readable by a screen reader, `:45-56` the coach voice and the hard rule that a
  genuinely bad result drops the encouragement entirely.

## Tasks & Acceptance

**Execution:**
- [x] `lib/pronunciation.ts` -- new pure module and the whole of this story's judgement: the Azure response
  types lifted from the lab page, `parseAssessment(raw)` down to per-phoneme scores, `PASS_THRESHOLD = 30` /
  `WARN_THRESHOLD = 60`, `MAX_CLIP_MS = 30_000`, the Đạt gate over the turn's target words, the tier-1/2/3
  classification (tier 2 = final consonant, an `-s`/`-ed` ending phoneme, or a consonant-cluster member
  below the warn line, on any word; tier 3 = stopwords), the score-card projection, and the Vietnamese copy
  for the verdict, the privacy disclosure and each failure — reusing `RecordingNotice`'s shape.
- [x] `lib/pronunciation.test.ts` -- new: every matrix row this module owns, plus the two invariants that
  matter most — the gate reads **only** phoneme scores (a response with `PronScore: 98` and a target
  phoneme at 0 is Chưa đạt), and the card's words never contain `MIN_LEAKED_CONTENT_WORDS` of the line's
  content words in sequence.
- [x] `lib/session.ts` -- add per-turn scores to the state machine: a score slot keyed by turn index, its
  pending/scored/failed lifecycle, dropped alongside the take in `startRecording` and carried onto
  `CompletedTurn`. `canContinue`, `TurnView` and `audioTurnToPlay` are unchanged.
- [x] `lib/session.test.ts` -- extend: update both exhaustive-shape tests deliberately, add the new
  projection to the leak sweep at `:1014-1023`, and pin that re-recording drops the score, that a failed
  score never blocks "Tiếp", and that scoring cannot make `audioTurnToPlay` yield a learner turn.
- [x] `app/api/pronunciation/route.ts` -- harden the proxy to match `/api/tts`: bounded timeout → 504,
  401/403 branch, `withoutKey` redaction on every error path, and an audio size cap consistent with
  `MAX_CLIP_MS`. No change to the assessment config.
- [x] `hooks/useTurnScorer.ts` -- new thin browser wrapper: `loadTake` → `FormData` → `fetch` with a client
  timeout looser than the server's → `parseAssessment`; owns the one-per-session disclosure, the in-flight
  state, and abort on unmount or re-record.
- [x] `components/SessionView.tsx` -- kick scoring off where the take is stored (`:443-470`) and render the
  card between `:811` and `:828`: verdict line with glyph + words + `tabular-nums` seconds, target-word
  chips by tier, tier-2 findings, a `<details>` for tier 3, and the failure and over-30s states.
- [x] `app/globals.css` -- `.session-score*` on the DESIGN tokens and the 4px scale, scoped under
  `.session-screen`; first consumer of `--font-phonetic` for IPA symbols; literal `rgba()`, never `color-mix()`.
- [x] `app/lab/pronunciation/page.tsx` -- import the response types and the extraction from
  `lib/pronunciation.ts` instead of its local copies. Behaviour unchanged; nothing else touched.
- [x] `AGENTS.md` -- document `lib/pronunciation.ts`, the phoneme-only gate and why word-level scores are
  forbidden, the score card as the fourth projection and what it may name, and the now-hardened
  `/api/pronunciation` alongside `/api/tts`.

**Acceptance Criteria:**
- Given a learner turn whose take has been stored, when scoring completes, then the verdict appears under
  that turn without any navigation, and the turn's own line is nowhere in the DOM.
- Given a response where every word-level and utterance-level score is high but one target phoneme is
  below 30, when the verdict is computed, then the turn is Chưa đạt.
- Given scoring fails for any reason, when the card renders, then it states that scoring failed, shows no
  number, and "Tiếp" advances the session exactly as before.
- Given the branch, when `npm test`, `npx tsc --noEmit` and `npm run build` run, then all pass cleanly and
  `npm run lint` has not gained a new error.

## Spec Change Log

## Design Notes

**Why the gate is phoneme-only.** Measured on this project: `walked` scored 97 at word level while its
final `/t/` was **0**, with `ErrorType: "None"`. Careless reading beat careful reading on `PronScore` in
2 of 3 sentences, because care costs fluency and prosody. Any gate above the phoneme is a gate that
rewards swallowing sounds — the exact failure this product exists to fix.

**Why the card is a fourth projection.** `TurnView` keeps `text: null` and `targetWords: []` because a
target word is a literal substring of the line. The card must name target words to be useful, so it gets
its own projection rather than a flag — the same move Story 2.2 made for `sampleReplayUnlocked`, and for
the same reason: the existing leak tests keep meaning exactly what they say. The card's disclosure is
bounded to the target words plus the specific words that scored badly, and pinned by a test built on
`containsSequence` + `MIN_LEAKED_CONTENT_WORDS` — the same rule the hint validator already enforces.

**Why the ~3-second two-stage reveal collapses to one.** `EXPERIENCE.md:99-101` wants the spoken sentence
shown immediately and the card filling in below. There is only one Azure call and it carries both, so the
staging is in the layout, not the network: the card mounts the instant the request leaves, in a worded
pending state, and fills in when the response lands. Rendering `DisplayText` would be the alternative and
is explicitly off the table — scripted assessment can echo the reference text back.

## Verification

**Commands:**
- `npm test` -- expected: all pass, including the new `lib/pronunciation.test.ts`.
- `npx tsc --noEmit` -- expected: clean.
- `npm run build` -- expected: clean.
- `npm run lint` -- expected: still exactly the 3 known `react-hooks/set-state-in-effect` errors
  (`app/page.tsx:15`, `app/practice/page.tsx:18`, `components/HistoryPanel.tsx:19`), no new error.

**Manual checks (if no CLI):**
- Run a session with `AZURE_SPEECH_KEY` set: record a turn, watch the card mount pending and fill in.
  Read a target word deliberately badly and confirm Chưa đạt; read it well and confirm Đạt.
- Search the rendered DOM for the learner turn's line — it must not appear in any state.
- Unset `AZURE_SPEECH_KEY` and re-run: the card reports scoring failed, shows no number, "Tiếp" still works.
- The privacy notice appears once per session, before the first request, not once per turn.
- `rm -rf .next` before judging any CSS change (Turbopack serves a stale `globals.css`).

## Suggested Review Order

**The verdict: what makes a turn Đạt**

- Start here — the whole gate in one function, and the only thing that decides Đạt.
  [`pronunciation.ts:449`](../../lib/pronunciation.ts#L449)
- The two thresholds, and the comment recording why nothing above the phoneme may gate.
  [`pronunciation.ts:62`](../../lib/pronunciation.ts#L62)
- Coverage is per target word: a word Azure never scored can never come back a pass.
  [`pronunciation.ts:162`](../../lib/pronunciation.ts#L162)
- Tier 2 is decided structurally, from position in the word, never from the score.
  [`pronunciation.ts:300`](../../lib/pronunciation.ts#L300)

**The leak bound: the card names words without handing over the line**

- The fourth projection. It is given the line and never returns it.
  [`pronunciation.ts:1047`](../../lib/pronunciation.ts#L1047)
- Every word is claimed, targets included — a phrase target falls back to one token.
  [`pronunciation.ts:876`](../../lib/pronunciation.ts#L876)
- Makes the bound checkable from outside, walking every string the card carries.
  [`pronunciation.ts:1211`](../../lib/pronunciation.ts#L1211)

**Where the score lives in the session**

- One writer, so `scores` and `CompletedTurn.score` cannot drift apart.
  [`session.ts:345`](../../lib/session.ts#L345)
- The four transitions; a verdict routinely lands after the learner has moved on.
  [`session.ts:361`](../../lib/session.ts#L361)
- Unchanged on purpose: "Tiếp" reads no score, so nothing about scoring gates the session.
  [`session.ts:149`](../../lib/session.ts#L149)

**Transport, and what leaves the device**

- Clip guard runs before the disclosure is claimed, so a long first take cannot spend it.
  [`pronunciation.ts:755`](../../lib/pronunciation.ts#L755)
- The disclosure is claimed only once the take is known to exist, just before upload.
  [`useTurnScorer.ts:74`](../../hooks/useTurnScorer.ts#L74)
- A 200 that heard nothing is its own outcome, not a service fault and not a verdict.
  [`useTurnScorer.ts:235`](../../hooks/useTurnScorer.ts#L235)
- Now mirrors `/api/tts`: bounded timeout, key redaction, 401 branch, both size bounds.
  [`route.ts:33`](../../app/api/pronunciation/route.ts#L33)

**The card on screen**

- Kicks scoring off from the plan rather than inlining the ordering.
  [`SessionView.tsx:466`](../../components/SessionView.tsx#L466)
- The card is muted; one short summary node is the only thing that announces.
  [`SessionView.tsx:143`](../../components/SessionView.tsx#L143)
- Chip glyph and number are decoration; this is what a screen reader actually gets.
  [`SessionView.tsx:124`](../../components/SessionView.tsx#L124)
- Literal `rgba` in both themes — `color-mix()` silently drops the alpha here.
  [`globals.css:387`](../../app/globals.css#L387)

**Supporting**

- The leak sweep, now with the target-word exemption made explicit rather than relaxed.
  [`session.test.ts`](../../lib/session.test.ts)
- Route tests, including the Gemini branch's redaction and 401 that nothing covered before.
  [`route.test.ts`](../../app/api/pronunciation/route.test.ts)
- The lab page now imports the Azure types instead of owning a private copy.
  [`page.tsx:51`](../../app/lab/pronunciation/page.tsx#L51)
