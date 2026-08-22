import type {
  VocabularyCollection,
  VocabularyItem,
  VocabularySource,
} from "../types";

// AnkiConnect API types — module-private, none of it leaks past `ankiSource`.
interface AnkiCard {
  cardId: number;
  fields: Record<string, { value: string; order: number }>;
  modelName: string;
  deckName: string;
  question: string;
  answer: string;
  interval: number;
  reps: number;
  lapses: number;
  type: number; // 0=new, 1=learning, 2=review
}

// Call Next.js API proxy for AnkiConnect (avoids CORS)
async function callAnki(action: string, params?: object): Promise<unknown> {
  const res = await fetch("/api/anki", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, params }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error ?? "AnkiConnect error");
  }
  return data.result;
}

const ankiApi = {
  // Get list of all deck names
  getDeckNames: (): Promise<string[]> =>
    callAnki("deckNames") as Promise<string[]>,

  // Find card IDs in a deck
  findCards: (deckName: string): Promise<number[]> =>
    callAnki("findCards", {
      query: `deck:"${deckName}"`,
    }) as Promise<number[]>,

  // Get full card info
  getCardsInfo: (cardIds: number[]): Promise<AnkiCard[]> =>
    callAnki("cardsInfo", { cards: cardIds }) as Promise<AnkiCard[]>,
};

// Strip HTML tags from Anki field values
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Letters genuinely specific to Vietnamese. Same idea as `VIETNAMESE_LETTERS`
 * in `lib/dialogue/validate.ts` (duplicated locally on purpose: the vocabulary
 * layer must not import validator internals) but deliberately *narrower*: the
 * validator asks "is this Vietnamese?", this asks "could this be English?",
 * and English loanwords carry French acute/grave accents — `café`, `résumé`,
 * `cliché` must not be dropped. So the plain accented forms of a/e/i/o/u/y
 * that French and Spanish share are excluded; what remains is the specific
 * bases (ă â đ ê ô ơ ư), the hook-above/tilde/underdot diacritics, all
 * tone-marked forms of the specific bases, and `ỳ`.
 */
const VIETNAMESE_LETTERS =
  /[ăâđêôơưảãạẻẽẹỉĩịỏõọủũụỷỹỵằắẳẵặầấẩẫậềếểễệồốổỗộờớởỡợừứửữựỳ]/i;

/**
 * Common Vietnamese words, written without diacritics so the check survives
 * both `"Nghe toàn bài"` and a deck that typed it `"Nghe toan bai"`.
 *
 * The alphabet test alone is not enough and a real deck proves it: the front
 * `"Nghe toàn bài News Review: …"` carries only `à`, a letter French shares,
 * so narrowing the alphabet to save `café` let a whole Vietnamese instruction
 * through as a "learnable unit" — the exact 422 this module exists to prevent.
 * Two orthogonal signals, either sufficient.
 *
 * Every entry is deliberately a token that is **not** an English word: `do`,
 * `can`, `them`, `sang`, `tap` and friends are all Vietnamese too, and listing
 * them would reject ordinary English fronts.
 */
const VIETNAMESE_WORDS = new Set([
  "nghe", "toan", "bai", "cua", "cau", "muon", "voi", "mot", "trong", "noi",
  "tieng", "roi", "duoc", "nay", "cac", "nhung", "hoac", "nhac", "lai", "vung",
  "nguoi", "minh", "chua", "luot", "huong", "dap", "xem", "khong", "cung",
  "phai", "biet", "ngay", "dem", "hoc", "viet", "luyen", "giup", "theo",
  "tren", "duoi", "vao", "moi", "nhat", "hon", "lan", "tra", "loi",
  "hay", "tinh", "truoc",
]);

/** Lowercase `text` with its diacritics removed, so `"bài"` becomes `"bai"`. */
function withoutDiacritics(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");
}

/** Does `unit` contain a word only a Vietnamese sentence would carry? */
function hasVietnameseWord(unit: string): boolean {
  return withoutDiacritics(unit)
    .split(/[^a-z]+/)
    .some((token) => VIETNAMESE_WORDS.has(token));
}

/** A unit longer than this is paragraph leakage, not a learnable word/phrase. */
const MAX_UNIT_LENGTH = 80;

/** POS abbreviations decks append to a front: "favorable (a)", "run (phr v)". */
const POS_TOKEN =
  /^(?:a|adj|adv|n|v|prep|conj|pron|det|aux|int|interj|phr|phrase|idiom|exp|abbr)\.?$/i;

/**
 * Strip a unit's edge noise until stable: a leading ellipsis (completion cards
 * ship `"… since last year"`), terminal punctuation — ellipsis (`...`/`…`) and
 * sentence-final `.` `?` `!` alike, however stacked ("...?" unwinds fully) —
 * and quote characters on either edge (`"Have you met?"`). Never parentheses
 * or square brackets: those carry structure the caller handles itself. A unit
 * that keeps terminal punctuation can only match a dialogue line that ends
 * exactly there; the model uses these sentences mid-line ("Excuse me, I don't
 * mean to interrupt, but…"), and `containsWord` must still find them.
 */
function stripEdges(text: string): string {
  let out = text.trim();
  let prev: string;
  do {
    prev = out;
    out = out
      .replace(/^(?:\.{3,}|…)+\s*/, "")
      .replace(/(?:[.?!…]|\s)+$/, "")
      .replace(/^["'“”‘’„]+|["'“”‘’„]+$/g, "")
      .trim();
  } while (out !== prev);
  return out;
}

/**
 * Clean a candidate learnable unit: drop `[sound:…]` tags, HTML, `[…]` bracket
 * groups (IPA — a truncated field can leave the last one unclosed), trailing
 * parenthesised POS markers, and edge punctuation (see `stripEdges`). The POS
 * strip and the edge strip interleave until stable, because either can expose
 * the other: `"favorable (a)."` sheds the `.` and only then the `(a)`.
 */
function cleanUnit(raw: string): string {
  let out = raw.replace(/\[sound:[^\]]*\]/gi, " ");
  out = stripHtml(out);
  out = out
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\[[^\]]*$/, " ")
    .replace(/\s+/g, " ")
    .trim();

  out = stripEdges(out);

  // Trailing POS markers, possibly stacked: "book (n) (v)".
  let prev: string;
  do {
    prev = out;
    out = out
      .replace(/\(([^)]*)\)$/, (match, inner: string) => {
        const tokens = inner.split(/[\s,/]+/).filter(Boolean);
        const isPos = tokens.length > 0 && tokens.every((t) => POS_TOKEN.test(t));
        return isPos ? "" : match;
      })
      .trim();
    out = stripEdges(out);
  } while (out !== prev);

  return out;
}

/**
 * Is this a unit an English dialogue could actually contain? Non-empty, short
 * enough not to be a leaked paragraph, holds at least one Latin letter, shows
 * neither a Vietnamese-specific letter nor a Vietnamese word (an instruction
 * or gloss is never the learnable unit; the two signals are orthogonal because
 * a phrase like "Nghe toàn bài" carries only French-shared accents), and
 * carries no interior ellipsis or fill-in blank —
 * `"I'd like ... you"` and `"__ up late"` can never be matched by
 * `containsWord`, so keeping them ships a guaranteed 422.
 */
function isUsableEnglish(unit: string): boolean {
  return (
    unit.length > 0 &&
    unit.length <= MAX_UNIT_LENGTH &&
    /[a-z]/i.test(unit) &&
    !/\.{3}|…|__/.test(unit) &&
    !VIETNAMESE_LETTERS.test(unit) &&
    !hasVietnameseWord(unit)
  );
}

const BOLD_ELEMENT = /<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi;

/**
 * The first `<b>`/`<strong>` element of `html` whose cleaned text is usable
 * English, with the html around that one element (joined with a space, so
 * text on either side does not fuse). Iterating matters: a Reactor Back can
 * open with a bolded Vietnamese heading before the bolded English unit.
 */
function usableBoldUnit(
  html: string
): { unit: string; remainder: string } | null {
  for (const match of html.matchAll(BOLD_ELEMENT)) {
    const unit = cleanUnit(match[2]);
    if (!isUsableEnglish(unit)) continue;
    return {
      unit,
      remainder:
        html.slice(0, match.index) +
        " " +
        html.slice(match.index + match[0].length),
    };
  }
  return null;
}

/**
 * Parse a raw AnkiCard into a neutral VocabularyItem.
 *
 * Strategy order is content-driven, not note-type-driven:
 * 1. Clean `Front`; if the result is usable English, that is the unit
 *    (Basic/TOEIC shapes — unchanged behavior minus the noise).
 * 2. Otherwise take `Back`'s first usable `<b>`/`<strong>` element
 *    (BBC-Reactor shapes put the English unit there under a Vietnamese
 *    instruction front); the meaning is the rest of `Back`, or the stripped
 *    `Front` when nothing remains.
 * 3. Otherwise the card has no learnable unit — return an empty `word` so
 *    `fetchDeckCards` drops it without failing the deck.
 */
function parseCard(card: AnkiCard): VocabularyItem {
  const fields = card.fields;

  // Try common field name patterns
  const frontKey =
    Object.keys(fields).find((k) =>
      ["Front", "front", "Word", "word", "English", "Expression"].includes(k)
    ) ?? Object.keys(fields)[0];

  const backKey =
    Object.keys(fields).find((k) =>
      ["Back", "back", "Meaning", "meaning", "Vietnamese", "Reading", "Definition"].includes(k)
    ) ?? Object.keys(fields)[1];

  const front = fields[frontKey]?.value ?? "";
  const back = fields[backKey]?.value ?? "";
  const item = (word: string, meaning: string): VocabularyItem => ({
    id: String(card.cardId),
    word,
    meaning,
    ankiModelName: card.modelName,
  });

  // Meanings keep their prose but not `[sound:…]` tags — those would ship
  // straight into the Gemini prompt and the UI. Only sound tags: bracketed
  // text in a meaning can be legitimate.
  const meaningOf = (value: string) =>
    stripHtml(value.replace(/\[sound:[^\]]*\]/gi, " "));

  const frontUnit = cleanUnit(front);
  if (isUsableEnglish(frontUnit)) {
    return item(frontUnit, meaningOf(back));
  }

  const bold = usableBoldUnit(back);
  if (bold) {
    const remainder = meaningOf(bold.remainder)
      .replace(/^[=:\-–—]\s*/, "")
      .trim();
    return item(bold.unit, remainder || meaningOf(front));
  }

  return item("", "");
}

// Batch fetch cards from a deck (max 200 at a time)
async function fetchDeckCards(deckName: string): Promise<VocabularyItem[]> {
  const cardIds = await ankiApi.findCards(deckName);
  if (cardIds.length === 0) return [];

  // Limit to 200 cards for MVP performance
  const ids = cardIds.slice(0, 200);
  const batchSize = 100;
  const batches: AnkiCard[] = [];

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = await ankiApi.getCardsInfo(ids.slice(i, i + batchSize));
    batches.push(...batch);
  }

  // Dedupe by word (case-insensitive), keeping the first: two cards teaching
  // the same unit would make the dialogue prompt ask for it twice.
  const seen = new Set<string>();
  return batches
    .map(parseCard)
    .filter((c) => c.word && c.meaning)
    .filter((c) => {
      const key = c.word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export const ankiSource: VocabularySource = {
  id: "anki",
  label: "Anki",
  setupHint: {
    title: "Hướng dẫn kết nối Anki",
    steps: [
      "Mở ứng dụng **Anki** trên máy tính",
      "Cài addon **AnkiConnect** (code: `2055492159`)",
      "Restart Anki và thử lại",
    ],
  },

  async listCollections(): Promise<VocabularyCollection[]> {
    const names = await ankiApi.getDeckNames();
    return names.map((name) => ({ id: name, name }));
  },

  fetchItems(collectionId: string): Promise<VocabularyItem[]> {
    return fetchDeckCards(collectionId);
  },
};
