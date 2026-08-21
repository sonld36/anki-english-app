// Target-word matching and safe rendering. One module so that "what counts as
// this word appearing in this text" has a single answer, shared by the
// validator (which decides whether a script is acceptable) and the UI (which
// decides what to highlight).

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Escape text for insertion as HTML *element content*. Not sufficient for
 * attribute values — nothing here builds attributes from untrusted text.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Regex source matching `word` as a whole word.
 *
 * `\b` sits between a `\w` and a non-`\w` character, so it is only meaningful
 * on a side where the target itself starts or ends with a word character.
 * Applying it unconditionally makes some targets unmatchable forever — `etc.`
 * and `5%` end in a non-word character, `école` starts with one — and an
 * unmatchable target word is a 422 that no retry can clear.
 */
export function wordPattern(word: string): string {
  const needle = word.trim();
  const leading = /^\w/.test(needle) ? "\\b" : "";
  const trailing = /\w$/.test(needle) ? "\\b" : "";
  return `${leading}${escapeRegExp(needle)}${trailing}`;
}

/** Whole-word containment: `cold` must not match inside `colder`. */
export function containsWord(text: string, word: string): boolean {
  const needle = word.trim();
  if (!needle) return false;
  return new RegExp(wordPattern(needle), "i").test(text);
}

/** Longest target first, so a multi-word target wins over its own prefix. */
function wordsRegex(words: string[]): RegExp | null {
  const parts = [...new Set(words.map((w) => w.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map(wordPattern);
  if (parts.length === 0) return null;
  return new RegExp(`(?:${parts.join("|")})`, "gi");
}

/**
 * Render `text` as HTML with its target words wrapped in `<mark>`.
 *
 * This is a security control: every caller feeds it model-generated or
 * user-generated text destined for `dangerouslySetInnerHTML`.
 *
 * Matching runs on the *raw* text and escaping is applied per segment, so the
 * two steps cannot interfere. Escaping first would break both directions: a
 * target containing `&` (`R&D`) could never match inside `R&amp;D`, and a
 * target like `amp` would match *inside* an entity and corrupt it.
 */
export function renderHighlightedHtml(text: string, words: string[]): string {
  const regex = wordsRegex(words);
  if (!regex) return escapeHtml(text);

  let out = "";
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    out += escapeHtml(text.slice(last, match.index));
    out += `<mark class="word-highlight">${escapeHtml(match[0])}</mark>`;
    last = match.index + match[0].length;
  }
  return out + escapeHtml(text.slice(last));
}
