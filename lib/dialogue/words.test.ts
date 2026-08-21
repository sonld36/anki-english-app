import { describe, expect, it } from "vitest";
import { containsWord, escapeHtml, renderHighlightedHtml } from "./words";

describe("containsWord", () => {
  it("matches whole words only, ignoring case", () => {
    expect(containsWord("It is much colder outside.", "cold")).toBe(false);
    expect(containsWord("It is Cold outside.", "cold")).toBe(true);
    expect(containsWord("Uncold is not a word.", "cold")).toBe(false);
    expect(containsWord("The cold, dark night.", "cold")).toBe(true);
  });

  it("matches a target that ends in punctuation", () => {
    // A trailing \b after "." can never be satisfied, which would make the
    // word unprovable and the deck permanently ungeneratable.
    expect(containsWord("Bring a pen, paper, etc. before class.", "etc.")).toBe(true);
    expect(containsWord("It costs 5% more this year.", "5%")).toBe(true);
    expect(containsWord("Is it done? Yes.", "done?")).toBe(true);
  });

  it("matches a target that starts with a non-word character", () => {
    expect(containsWord("The price is $5 today.", "$5")).toBe(true);
    expect(containsWord("Use the ¥ symbol here.", "¥")).toBe(true);
  });

  it("matches non-ASCII targets", () => {
    expect(containsWord("Je vais à l'école demain.", "école")).toBe(true);
    expect(containsWord("Uống cà phê buổi sáng.", "cà phê")).toBe(true);
    expect(containsWord("Das ist schön heute.", "schön")).toBe(true);
  });

  it("matches a multi-word target", () => {
    expect(containsWord("Let us check in at the hotel.", "check in")).toBe(true);
    expect(containsWord("Let us check the hotel.", "check in")).toBe(false);
  });

  it("treats regex metacharacters in a target literally", () => {
    expect(containsWord("The a.c is broken.", "a.c")).toBe(true);
    expect(containsWord("The abc is broken.", "a.c")).toBe(false);
  });

  it("is false for an empty or whitespace-only target", () => {
    expect(containsWord("anything", "")).toBe(false);
    expect(containsWord("anything", "   ")).toBe(false);
  });
});

describe("escapeHtml", () => {
  it("neutralises the characters that start markup", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror="alert(1)"&gt;'
    );
    expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });
});

describe("renderHighlightedHtml", () => {
  it("wraps target words and leaves the rest of the text alone", () => {
    expect(renderHighlightedHtml("It is cold today.", ["cold"])).toBe(
      'It is <mark class="word-highlight">cold</mark> today.'
    );
  });

  it("preserves the casing found in the text", () => {
    expect(renderHighlightedHtml("Cold weather.", ["cold"])).toBe(
      '<mark class="word-highlight">Cold</mark> weather.'
    );
  });

  it("does not highlight an inflected form", () => {
    expect(renderHighlightedHtml("It is colder today.", ["cold"])).toBe(
      "It is colder today."
    );
  });

  it("escapes markup in the surrounding text", () => {
    // The security control: model and user text reach dangerouslySetInnerHTML.
    expect(
      renderHighlightedHtml('cold <script>alert("x")</script>', ["cold"])
    ).toBe(
      '<mark class="word-highlight">cold</mark> &lt;script&gt;alert("x")&lt;/script&gt;'
    );
  });

  it("escapes markup inside a matched target word too", () => {
    expect(renderHighlightedHtml("say <b> now", ["<b>"])).toBe(
      'say <mark class="word-highlight">&lt;b&gt;</mark> now'
    );
  });

  it("matches a target containing an ampersand", () => {
    // Escaping before matching would turn this into R&amp;D, which the
    // target "R&D" could never match.
    expect(renderHighlightedHtml("I work in R&D here.", ["R&D"])).toBe(
      'I work in <mark class="word-highlight">R&amp;D</mark> here.'
    );
  });

  it("does not let a target match inside an HTML entity", () => {
    // Escaping first would produce "Tom &amp; Jerry" and let "amp" match
    // inside the entity, corrupting it.
    const html = renderHighlightedHtml("Tom & Jerry sang amp songs.", ["amp"]);
    expect(html).toBe(
      'Tom &amp; Jerry sang <mark class="word-highlight">amp</mark> songs.'
    );
    expect(html).toContain("&amp;");
    expect(html).not.toContain("&<mark");
  });

  it("prefers the longest target when two overlap", () => {
    expect(renderHighlightedHtml("Please check in now.", ["check", "check in"])).toBe(
      'Please <mark class="word-highlight">check in</mark> now.'
    );
  });

  it("highlights every occurrence", () => {
    expect(renderHighlightedHtml("cold, very cold.", ["cold"])).toBe(
      '<mark class="word-highlight">cold</mark>, very <mark class="word-highlight">cold</mark>.'
    );
  });

  it("escapes everything when there are no target words", () => {
    expect(renderHighlightedHtml("<b>hi</b>", [])).toBe("&lt;b&gt;hi&lt;/b&gt;");
    expect(renderHighlightedHtml("<b>hi</b>", ["  "])).toBe("&lt;b&gt;hi&lt;/b&gt;");
  });
});
