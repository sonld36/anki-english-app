// English function words, and the content-word view of a piece of text that
// depends on them.
//
// Two hint rules are unenforceable without this list: "at most 2 other content
// words" has to know which words are content, and "the hint borrows N
// consecutive content words of the line" has to skip the glue between them.
//
// This is NOT a second word-boundary matcher — `lib/dialogue/words.ts` still
// owns "does this word appear in this text" for target words. What lives here
// is a sequence view: text reduced to an ordered list of normalized tokens, so
// two pieces of text can be compared as sequences rather than as strings.

/**
 * Function words: articles, pronouns, determiners, prepositions,
 * conjunctions, auxiliaries and their contractions. Deliberately small and
 * closed-class, because anything listed here is invisible to both hint rules
 * and could be smuggled into a hint for free.
 *
 * The list cannot be perfect: `like`, `right`, `well`, `much`, `near` and
 * friends are function words in one sentence and vocabulary in the next, and
 * an A2/B1 deck ships exactly those as target words. So the guarantee that
 * matters is structural rather than lexical — `contentWords` takes the words
 * that must count as content (the turn's own target words) and subtracts them
 * from this set before filtering. A target word is never a stopword, whatever
 * this list says.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  // articles & determiners
  "a", "an", "the", "this", "that", "these", "those", "some", "any", "each",
  "every", "another", "other", "such", "no", "all", "both", "either",
  "neither", "much", "many", "more", "most", "few", "little", "own", "same",
  // pronouns & possessives
  "i", "me", "my", "mine", "myself", "you", "your", "yours", "yourself",
  "he", "him", "his", "himself", "she", "her", "hers", "herself",
  "it", "its", "itself", "we", "us", "our", "ours", "ourselves",
  "they", "them", "their", "theirs", "themselves", "one", "ones", "there",
  "here", "who", "whom", "whose", "which", "what", "where", "when", "why",
  "how", "something", "anything", "nothing", "everything", "someone",
  "anyone", "everyone", "nobody", "somebody", "anybody", "everybody",
  // auxiliaries, modals, copulas
  "am", "is", "are", "was", "were", "be", "been", "being", "do", "does",
  "did", "done", "have", "has", "had", "having", "will", "would", "shall",
  "should", "can", "could", "may", "might", "must", "let", "lets",
  // contractions (tokenized with the apostrophe kept)
  "i'm", "i've", "i'll", "i'd", "you're", "you've", "you'll", "you'd",
  "he's", "she's", "it's", "we're", "we've", "we'll", "we'd", "they're",
  "they've", "they'll", "they'd", "that's", "there's", "here's", "what's",
  "who's", "let's", "isn't", "aren't", "wasn't", "weren't", "don't",
  "doesn't", "didn't", "haven't", "hasn't", "hadn't", "won't", "wouldn't",
  "can't", "cannot", "couldn't", "shouldn't", "mustn't", "ain't",
  // prepositions & particles
  "about", "above", "across", "after", "against", "along", "among", "around",
  "as", "at", "before", "behind", "below", "beside", "between", "beyond",
  "by", "down", "during", "except", "for", "from", "in", "inside", "into",
  "like", "near", "of", "off", "on", "onto", "out", "outside", "over",
  "past", "per", "since", "than", "through", "throughout", "to", "toward",
  "towards", "under", "until", "up", "upon", "with", "within", "without",
  // conjunctions & sentence glue
  "and", "or", "but", "so", "if", "then", "because", "though", "although",
  "while", "whether", "unless", "yet", "nor", "also", "too", "very", "just",
  "really", "quite", "still", "even", "again", "ever", "never", "always",
  "not", "only", "well", "okay", "ok", "yes", "yeah", "yep", "nope", "oh",
  "hey", "hi", "hello", "please", "thanks", "thank", "sure", "right",
]);

/**
 * Lowercase word tokens. Apostrophes stay inside a word so `don't` is one
 * token and can be recognised as a function word; everything else —
 * punctuation, whitespace, line breaks — is a separator, which is exactly the
 * "normalise case, punctuation and whitespace" the leakage rules call for.
 */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu) ?? []).map(
    (token) => token.replace(/’/g, "'")
  );
}

const EMPTY: ReadonlySet<string> = new Set<string>();

/**
 * Is this token a function word?
 *
 * `alwaysContent` wins: tokens named there are content whatever the list says.
 * Pass the turn's target words, so a deck teaching `like` or `right` cannot
 * have its own vocabulary treated as glue.
 */
export function isStopword(
  token: string,
  alwaysContent: ReadonlySet<string> = EMPTY
): boolean {
  const normalized = token.toLowerCase().replace(/’/g, "'");
  return !alwaysContent.has(normalized) && STOPWORDS.has(normalized);
}

/**
 * The tokens of `text` that carry meaning, in order, duplicates kept.
 *
 * `alwaysContent` is the caller's list of tokens that must survive the filter
 * — in practice the tokens of the turn's target words.
 */
export function contentWords(
  text: string,
  alwaysContent: ReadonlySet<string> = EMPTY
): string[] {
  return tokenize(text).filter((token) => !isStopword(token, alwaysContent));
}

/**
 * Does `sequence` contain `window` as a run of consecutive elements?
 *
 * An empty `window` is never "contained" — a line with nothing but function
 * words must not make every hint a leak.
 */
export function containsSequence(sequence: string[], window: string[]): boolean {
  if (window.length === 0 || window.length > sequence.length) return false;
  for (let i = 0; i + window.length <= sequence.length; i++) {
    let hit = true;
    for (let j = 0; j < window.length; j++) {
      if (sequence[i + j] !== window[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}
