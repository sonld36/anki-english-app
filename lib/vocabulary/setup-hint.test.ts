import { describe, expect, it } from "vitest";
import { parseSetupHintStep } from "./setup-hint";
import { ankiSource } from "./sources/anki";

describe("parseSetupHintStep", () => {
  it("returns a plain step as one unmarked segment", () => {
    expect(parseSetupHintStep("Restart Anki và thử lại")).toEqual([
      { text: "Restart Anki và thử lại" },
    ]);
  });

  it("marks **text** as emphasised and keeps the surrounding text", () => {
    expect(parseSetupHintStep("Mở ứng dụng **Anki** trên máy tính")).toEqual([
      { text: "Mở ứng dụng " },
      { text: "Anki", strong: true },
      { text: " trên máy tính" },
    ]);
  });

  it("marks `text` as a code chip", () => {
    expect(parseSetupHintStep("code: `2055492159`")).toEqual([
      { text: "code: " },
      { text: "2055492159", code: true },
    ]);
  });

  it("handles both markers in one step, in order", () => {
    expect(
      parseSetupHintStep("Cài addon **AnkiConnect** (code: `2055492159`)")
    ).toEqual([
      { text: "Cài addon " },
      { text: "AnkiConnect", strong: true },
      { text: " (code: " },
      { text: "2055492159", code: true },
      { text: ")" },
    ]);
  });

  it("leaves unmatched or empty markers as literal text", () => {
    expect(parseSetupHintStep("2 ** 3 và `` rỗng")).toEqual([
      { text: "2 ** 3 và `` rỗng" },
    ]);
  });

  it("drops the empty leading segment when a step opens with a marker", () => {
    expect(parseSetupHintStep("**Anki** trước")).toEqual([
      { text: "Anki", strong: true },
      { text: " trước" },
    ]);
  });
});

describe("ankiSource.setupHint parses into renderable segments", () => {
  it("recovers the emphasised names and the addon code chip", () => {
    const segments = (ankiSource.setupHint?.steps ?? []).flatMap(parseSetupHintStep);

    expect(segments.filter((s) => s.strong).map((s) => s.text)).toEqual([
      "Anki",
      "AnkiConnect",
    ]);
    expect(segments.filter((s) => s.code).map((s) => s.text)).toEqual([
      "2055492159",
    ]);
    // The rendered text must still read exactly as the authored step.
    expect(segments.map((s) => s.text).join("")).toContain(
      "Cài addon AnkiConnect (code: 2055492159)"
    );
  });
});
