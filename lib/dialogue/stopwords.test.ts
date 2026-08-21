import { describe, expect, it } from "vitest";
import { containsSequence, contentWords, isStopword, tokenize } from "./stopwords";

/**
 * These three functions decide two hint rules between them — how much of the
 * line a level-1 hint may borrow, and how many extra content words level 2 may
 * carry. A quiet change here loosens both rules with nothing failing.
 */

describe("tokenize", () => {
  it("lowercases and drops punctuation and line breaks", () => {
    expect(tokenize("Not yet, good coats\nare expensive!")).toEqual([
      "not",
      "yet",
      "good",
      "coats",
      "are",
      "expensive",
    ]);
  });

  it("keeps a contraction as one token, curly apostrophe included", () => {
    expect(tokenize("I don’t know")).toEqual(["i", "don't", "know"]);
  });

  it("keeps Vietnamese words whole", () => {
    expect(tokenize("Khi bạn muốn từ chối.")).toEqual(["khi", "bạn", "muốn", "từ", "chối"]);
  });
});

describe("isStopword", () => {
  it("knows function words from content words, whatever the casing", () => {
    expect(isStopword("The")).toBe(true);
    expect(isStopword("don’t")).toBe(true);
    expect(isStopword("weather")).toBe(false);
  });

  it("never calls a word in `alwaysContent` a stopword", () => {
    // The structural guarantee behind the hint rules: a deck teaching `like`
    // or `right` as vocabulary must not have its own target words treated as
    // glue, however the list feels about them.
    expect(isStopword("like")).toBe(true);
    expect(isStopword("like", new Set(["like"]))).toBe(false);
  });
});

describe("contentWords", () => {
  it("drops function words and their contractions", () => {
    expect(contentWords("I don't think it is really expensive.")).toEqual([
      "think",
      "expensive",
    ]);
  });

  it("keeps the words named in `alwaysContent`", () => {
    expect(contentWords("I like it right now", new Set(["like", "right"]))).toEqual([
      "like",
      "right",
      "now",
    ]);
  });

  it("keeps every word of a Vietnamese sentence", () => {
    // The stopword list is English only: a Vietnamese situation must not be
    // silently emptied out before the leakage check runs on it.
    expect(contentWords("Khi bạn muốn từ chối")).toHaveLength(5);
  });
});

describe("containsSequence", () => {
  it("finds a run of consecutive elements", () => {
    expect(containsSequence(["a", "b", "c", "d"], ["b", "c"])).toBe(true);
  });

  it("does not match elements that are present but not consecutive", () => {
    expect(containsSequence(["a", "b", "x", "c"], ["b", "c"])).toBe(false);
  });

  it("never reports an empty window", () => {
    // A line of nothing but function words has no content words; if that
    // counted as contained, every hint on it would be a leak.
    expect(containsSequence(["a", "b"], [])).toBe(false);
  });
});
