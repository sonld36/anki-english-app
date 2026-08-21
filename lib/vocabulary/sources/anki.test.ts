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
