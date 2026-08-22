import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ankiSource } from "./anki";

type AnkiRequest = {
  url: string;
  method?: string;
  action: string;
  params?: Record<string, unknown>;
};

type AnkiField = { value: string; order: number };

type StubCard = {
  cardId: number;
  fields: Record<string, AnkiField>;
  modelName?: string;
};

/** Handlers keyed by AnkiConnect action; returns the `result` payload. */
type Handlers = Partial<Record<string, (params?: Record<string, unknown>) => unknown>>;

let requests: AnkiRequest[] = [];

/**
 * Stub the `/api/anki` transport the way the real proxy answers:
 * `{ result }` on success, `{ error }` on failure.
 */
function stubTransport(handlers: Handlers) {
  const fetchMock = vi.fn(
    async (url: string, init?: { method?: string; body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as {
        action: string;
        params?: Record<string, unknown>;
      };
      requests.push({ url, method: init?.method, ...body });
      const handler = handlers[body.action];
      if (!handler) {
        return {
          ok: false,
          json: async () => ({ error: `Unhandled action: ${body.action}` }),
        };
      }
      return { ok: true, json: async () => ({ result: handler(body.params) }) };
    }
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function card(cardId: number, fields: Record<string, string>, modelName = "Basic"): StubCard {
  const entries = Object.entries(fields).map(
    ([name, value], order) => [name, { value, order }] as const
  );
  return { cardId, fields: Object.fromEntries(entries), modelName };
}

function requestsFor(action: string) {
  return requests.filter((r) => r.action === action);
}

beforeEach(() => {
  requests = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ankiSource transport", () => {
  it("goes through the /api/anki proxy with POST, never AnkiConnect directly", async () => {
    stubTransport({
      deckNames: () => ["Deck A"],
      findCards: () => [1],
      cardsInfo: () => [card(1, { Front: "a", Back: "b" })],
    });

    await ankiSource.listCollections();
    await ankiSource.fetchItems("Deck A");

    expect(requests).not.toHaveLength(0);
    for (const req of requests) {
      // AnkiConnect serves no CORS headers, so the browser must never
      // reach 127.0.0.1:8765 itself — everything goes via the Next proxy.
      expect(req.url).toBe("/api/anki");
      expect(req.method).toBe("POST");
    }
  });

  it("treats an HTTP 200 carrying an `error` field as a failure", async () => {
    // How AnkiConnect actually reports most errors: 200 OK, error in body.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ error: "deck was not found: Ghost" }),
      }))
    );

    await expect(ankiSource.fetchItems("Ghost")).rejects.toThrow(
      "deck was not found: Ghost"
    );
  });
});

describe("ankiSource.setupHint", () => {
  it("keeps the AnkiConnect addon code in the recovery steps", () => {
    const steps = ankiSource.setupHint?.steps ?? [];

    expect(ankiSource.setupHint?.title).toBeTruthy();
    expect(steps.join("\n")).toContain("`2055492159`");
    expect(steps.some((s) => s.includes("**AnkiConnect**"))).toBe(true);
  });
});

describe("ankiSource.listCollections", () => {
  it("returns one collection per deck with id === name", async () => {
    stubTransport({ deckNames: () => ["Deck A", "Tiếng Anh::Core 1000"] });

    const collections = await ankiSource.listCollections();

    expect(collections).toEqual([
      { id: "Deck A", name: "Deck A" },
      { id: "Tiếng Anh::Core 1000", name: "Tiếng Anh::Core 1000" },
    ]);
    expect(requestsFor("deckNames")).toHaveLength(1);
  });

  it("rejects with the proxy's error message when Anki is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({
          error:
            "Không thể kết nối Anki. Hãy chắc chắn Anki đang mở và AnkiConnect đã được cài.",
        }),
      }))
    );

    await expect(ankiSource.listCollections()).rejects.toThrow(
      "Không thể kết nối Anki. Hãy chắc chắn Anki đang mở và AnkiConnect đã được cài."
    );
  });
});

describe("ankiSource.fetchItems", () => {
  it("maps standard Front/Back fields, strips HTML, and stringifies the id", async () => {
    stubTransport({
      findCards: () => [11, 12],
      cardsInfo: () => [
        card(11, {
          Front: "<b>hello</b>&nbsp;there",
          Back: "xin ch&agrave;o",
        }),
        card(12, {
          Front: "  spaced   out  ",
          Back: "5 &lt; 7 &amp; 8 &gt; 6",
        }),
      ],
    });

    const items = await ankiSource.fetchItems("Deck A");

    expect(items).toEqual([
      {
        id: "11",
        word: "hello there",
        // NOTE: `&agrave;` stays encoded on purpose. `stripHtml` decodes
        // only &nbsp; &amp; &lt; &gt; — every other entity survives raw.
        // This pins today's behavior; it is a known gap, not the goal.
        meaning: "xin ch&agrave;o",
        ankiModelName: "Basic",
      },
      {
        id: "12",
        word: "spaced out",
        meaning: "5 < 7 & 8 > 6",
        ankiModelName: "Basic",
      },
    ]);
    expect(items.every((i) => typeof i.id === "string")).toBe(true);
    expect(requestsFor("findCards")[0].params).toEqual({ query: 'deck:"Deck A"' });
  });

  it("falls back to the first two fields, in order, for unknown field names", async () => {
    stubTransport({
      findCards: () => [21],
      cardsInfo: () => [
        card(21, { Term: "ubiquitous", Gloss: "phổ biến", Notes: "ignore me" }),
      ],
    });

    const items = await ankiSource.fetchItems("Custom");

    expect(items).toEqual([
      { id: "21", word: "ubiquitous", meaning: "phổ biến", ankiModelName: "Basic" },
    ]);
  });

  it("drops malformed cards without failing the whole load", async () => {
    stubTransport({
      findCards: () => [31, 32, 33, 34],
      cardsInfo: () => [
        card(31, { Front: "good", Back: "tốt" }),
        card(32, { Front: "", Back: "thiếu mặt trước" }),
        card(33, { Front: "missing meaning", Back: "   " }),
        card(34, { Front: "<br>", Back: "chỉ có thẻ HTML" }),
      ],
    });

    const items = await ankiSource.fetchItems("Messy");

    expect(items.map((i) => i.id)).toEqual(["31"]);
  });

  it("strips sound tags, IPA brackets and POS markers from a TOEIC-style front", async () => {
    stubTransport({
      findCards: () => [41],
      cardsInfo: () => [
        card(41, {
          Front: "favorable (a) [ ˈfeɪvərəbl ] [sound:favorable.mp3]",
          Back: "thuận lợi",
        }),
      ],
    });

    const items = await ankiSource.fetchItems("TOEIC");

    expect(items).toEqual([
      { id: "41", word: "favorable", meaning: "thuận lợi", ankiModelName: "Basic" },
    ]);
  });

  it("keeps a multi-word front intact as one phrase", async () => {
    stubTransport({
      findCards: () => [42],
      cardsInfo: () => [
        card(42, { Front: "reasonable delivery&nbsp;", Back: "giao hàng hợp lý" }),
      ],
    });

    const items = await ankiSource.fetchItems("TOEIC");

    expect(items[0].word).toBe("reasonable delivery");
  });

  it("falls back to Back's first <b> when the front is a Vietnamese instruction", async () => {
    stubTransport({
      findCards: () => [51],
      cardsInfo: () => [
        card(51, {
          Front: "Nghe và nhắc lại câu tiếng Anh sau đây",
          Back: "<b>I don't mean to interrupt.</b><div>Tôi không có ý ngắt lời.</div>",
        }),
      ],
    });

    const items = await ankiSource.fetchItems("Reactor");

    expect(items).toEqual([
      {
        id: "51",
        // Terminal punctuation stripped: the model uses these sentences
        // mid-line ("…, I don't mean to interrupt, but …"), and a unit that
        // keeps its "." can only match a line ending exactly there.
        word: "I don't mean to interrupt",
        meaning: "Tôi không có ý ngắt lời.",
        ankiModelName: "Basic",
      },
    ]);
  });

  it("uses the stripped front as meaning when the Back remainder is empty", async () => {
    stubTransport({
      findCards: () => [52],
      cardsInfo: () => [
        card(52, {
          Front: "Tôi không có ý ngắt lời.",
          Back: "<b>I don't mean to interrupt.</b>",
        }),
      ],
    });

    const items = await ankiSource.fetchItems("Reactor");

    expect(items[0].word).toBe("I don't mean to interrupt");
    expect(items[0].meaning).toBe("Tôi không có ý ngắt lời.");
  });

  it("extracts a Reactor vocab unit and drops the '=' separator from the meaning", async () => {
    stubTransport({
      findCards: () => [53],
      cardsInfo: () => [
        card(53, {
          Front: "Từ vựng trong bài",
          Back: "<b>night owl</b> = people who stay up late",
        }),
      ],
    });

    const items = await ankiSource.fetchItems("Reactor");

    expect(items[0].word).toBe("night owl");
    expect(items[0].meaning).toBe("people who stay up late");
  });

  it("strips trailing ellipsis and sentence punctuation, however stacked", async () => {
    stubTransport({
      findCards: () => [54, 55, 56],
      cardsInfo: () => [
        card(54, {
          Front: "Hoàn thành câu sau",
          Back: "<b>I'd like to introduce you to ...</b><div>Tôi muốn giới thiệu…</div>",
        }),
        card(55, {
          Front: "Hoàn thành câu sau nữa",
          Back: "<b>It's been a while since…</b><div>Đã lâu rồi kể từ khi…</div>",
        }),
        card(56, {
          Front: "Câu hỏi giới thiệu",
          Back: "<b>Have you met ...?</b><div>Anh đã gặp ... chưa?</div>",
        }),
      ],
    });

    const items = await ankiSource.fetchItems("Reactor");

    expect(items.map((i) => i.word)).toEqual([
      "I'd like to introduce you to",
      "It's been a while since",
      "Have you met",
    ]);
  });

  it("strips POS markers behind terminal punctuation, and stacked markers", async () => {
    stubTransport({
      findCards: () => [91, 92, 93],
      cardsInfo: () => [
        card(91, { Front: "favorable (a).", Back: "thuận lợi" }),
        card(92, { Front: "book (n) (v)", Back: "sách; đặt chỗ" }),
        card(93, { Front: "run (phr v)", Back: "chạy" }),
      ],
    });

    const items = await ankiSource.fetchItems("TOEIC");

    expect(items.map((i) => i.word)).toEqual(["favorable", "book", "run"]);
  });

  it("strips a leading ellipsis and edge quotes, keeping interior apostrophes", async () => {
    stubTransport({
      findCards: () => [94, 95, 96],
      cardsInfo: () => [
        card(94, { Front: "… since last year", Back: "kể từ năm ngoái" }),
        card(95, { Front: "“Have you met?”", Back: "gặp chưa" }),
        card(96, { Front: "'It's a deal.'", Back: "chốt nhé" }),
      ],
    });

    const items = await ankiSource.fetchItems("Quotes");

    expect(items.map((i) => i.word)).toEqual([
      "since last year",
      "Have you met",
      "It's a deal",
    ]);
  });

  it("removes an unclosed trailing IPA bracket fragment", async () => {
    stubTransport({
      findCards: () => [97],
      cardsInfo: () => [
        card(97, { Front: "favorable (a) [ ˈfeɪvərəbl", Back: "thuận lợi" }),
      ],
    });

    const items = await ankiSource.fetchItems("TOEIC");

    expect(items.map((i) => i.word)).toEqual(["favorable"]);
  });

  it("drops units with an interior ellipsis or fill-in blank — containsWord can never match them", async () => {
    stubTransport({
      findCards: () => [101, 102, 103, 104],
      cardsInfo: () => [
        card(101, { Front: "I'd like ... you", Back: "mẫu câu điền từ" }),
        card(102, { Front: "__ up late", Back: "điền vào chỗ trống" }),
        card(103, {
          Front: "Điền vào chỗ trống",
          Back: "<b>stay … late</b><div>thức khuya</div>",
        }),
        card(104, { Front: "good", Back: "tốt" }),
      ],
    });

    const items = await ankiSource.fetchItems("Blanks");

    expect(items.map((i) => i.id)).toEqual(["104"]);
  });

  it("keeps English loanwords with French accents, while Vietnamese still triggers the fallback", async () => {
    stubTransport({
      findCards: () => [111, 112],
      cardsInfo: () => [
        // é/è/à alone are not Vietnamese-specific — café must not be dropped.
        card(111, { Front: "café", Back: "quán cà phê" }),
        card(112, {
          Front: "Nghe và nhắc lại câu",
          Back: "<b>night owl</b> = cú đêm",
        }),
      ],
    });

    const items = await ankiSource.fetchItems("Loanwords");

    expect(items.map((i) => i.word)).toEqual(["café", "night owl"]);
  });

  it("drops a Vietnamese instruction whose only accents are ones French shares", async () => {
    // Regression, found live: narrowing the alphabet to rescue `café` let this
    // real BBC intro front through as a "word" — "Nghe toàn bài" carries only
    // `à`. The word-list signal is what catches it, with or without diacritics.
    stubTransport({
      findCards: () => [121, 122, 123],
      cardsInfo: () => [
        card(121, {
          Front: "<b>Nghe toàn bài</b><br>News Review: Late nights - Bad for health?",
          Back: "Nghe một lượt để bắt ý chính.",
        }),
        card(122, {
          Front: "Nghe toan bai roi tra loi",
          Back: "<b>stay up late</b> = thức khuya",
        }),
        card(123, { Front: "résumé", Back: "sơ yếu lý lịch" }),
      ],
    });

    const items = await ankiSource.fetchItems("Reactor");

    // 121 has no usable bold in Back either, so it is dropped entirely.
    expect(items.map((i) => i.word)).toEqual(["stay up late", "résumé"]);
  });

  it("strips [sound:] tags from the meaning on both extraction paths", async () => {
    stubTransport({
      findCards: () => [121, 122],
      cardsInfo: () => [
        card(121, { Front: "good", Back: "tốt [sound:good.mp3]" }),
        card(122, {
          Front: "Nghe và nhắc lại câu",
          Back: "<b>night owl</b>[sound:owl.mp3] cú đêm",
        }),
      ],
    });

    const items = await ankiSource.fetchItems("Sounds");

    expect(items.map((i) => i.meaning)).toEqual(["tốt", "cú đêm"]);
  });

  it("does not fuse the text around the extracted bold into one word", async () => {
    stubTransport({
      findCards: () => [131],
      cardsInfo: () => [
        card(131, {
          Front: "Cụm từ trong bài",
          Back: "Cụm từ<b>night owl</b>chỉ người thức khuya",
        }),
      ],
    });

    const items = await ankiSource.fetchItems("Reactor");

    expect(items[0].word).toBe("night owl");
    expect(items[0].meaning).toBe("Cụm từ chỉ người thức khuya");
  });

  it("accepts <strong> as well as <b>", async () => {
    stubTransport({
      findCards: () => [132],
      cardsInfo: () => [
        card(132, {
          Front: "Từ vựng trong bài",
          Back: "<strong>night owl</strong> = cú đêm",
        }),
      ],
    });

    const items = await ankiSource.fetchItems("Reactor");

    expect(items[0].word).toBe("night owl");
  });

  it("skips a bolded Vietnamese heading and takes the first usable bold", async () => {
    stubTransport({
      findCards: () => [133],
      cardsInfo: () => [
        card(133, {
          Front: "Từ vựng trong bài",
          Back: "<b>Từ vựng</b><b>night owl</b> = cú đêm",
        }),
      ],
    });

    const items = await ankiSource.fetchItems("Reactor");

    expect(items[0].word).toBe("night owl");
    expect(items[0].meaning).toBe("Từ vựng = cú đêm");
  });

  it("prefers a usable Front over a usable bold in the Back", async () => {
    stubTransport({
      findCards: () => [141],
      cardsInfo: () => [
        card(141, { Front: "seat (n)", Back: "<b>sit down</b> nghĩa là ngồi" }),
      ],
    });

    const items = await ankiSource.fetchItems("Precedence");

    expect(items[0].word).toBe("seat");
    expect(items[0].meaning).toBe("sit down nghĩa là ngồi");
  });

  it("drops cards with no usable English unit anywhere, keeping the rest", async () => {
    stubTransport({
      findCards: () => [61, 62],
      cardsInfo: () => [
        // Intro/full-lesson card: Vietnamese front, Back without any <b>.
        card(61, {
          Front: "Giới thiệu bài học",
          Back: "Trong bài này bạn sẽ học cách ngắt lời lịch sự.",
        }),
        card(62, { Front: "good", Back: "tốt" }),
      ],
    });

    const items = await ankiSource.fetchItems("Reactor");

    expect(items.map((i) => i.id)).toEqual(["62"]);
  });

  it("drops a card whose extracted unit exceeds 80 characters", async () => {
    const paragraph =
      "This entire English paragraph leaked out of a lesson note and is far too long " +
      "to ever be a target word in a dialogue.";
    stubTransport({
      findCards: () => [71, 72],
      cardsInfo: () => [
        card(71, { Front: paragraph, Back: "một đoạn văn" }),
        card(72, { Front: "short", Back: "ngắn" }),
      ],
    });

    const items = await ankiSource.fetchItems("Messy");

    expect(items.map((i) => i.id)).toEqual(["72"]);
  });

  it("dedupes items by word, case-insensitively, keeping the first", async () => {
    stubTransport({
      findCards: () => [81, 82, 83],
      cardsInfo: () => [
        card(81, { Front: "Weather", Back: "thời tiết" }),
        card(82, { Front: "weather", Back: "thời tiết (bản sao)" }),
        card(83, { Front: "cold", Back: "lạnh" }),
      ],
    });

    const items = await ankiSource.fetchItems("Dupes");

    expect(items.map((i) => i.id)).toEqual(["81", "83"]);
    expect(items[0].word).toBe("Weather");
  });

  it("returns [] for an empty deck without issuing a card-info request", async () => {
    stubTransport({
      findCards: () => [],
      cardsInfo: () => {
        throw new Error("cardsInfo must not be called for an empty deck");
      },
    });

    await expect(ankiSource.fetchItems("Empty")).resolves.toEqual([]);
    expect(requestsFor("cardsInfo")).toHaveLength(0);
  });

  it("caps a large deck at 200 cards fetched in batches of 100", async () => {
    const allIds = Array.from({ length: 250 }, (_, i) => 1000 + i);
    stubTransport({
      findCards: () => allIds,
      cardsInfo: (params) => {
        const ids = (params?.cards ?? []) as number[];
        return ids.map((id) => card(id, { Front: `w${id}`, Back: `m${id}` }));
      },
    });

    const items = await ankiSource.fetchItems("Big");

    expect(items).toHaveLength(200);
    const batches = requestsFor("cardsInfo").map(
      (r) => (r.params?.cards as number[]).length
    );
    expect(batches).toEqual([100, 100]);
    expect(items[0].id).toBe("1000");
    expect(items[199].id).toBe("1199");
  });
});
