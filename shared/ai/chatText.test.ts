import { describe, expect, it } from "vitest";
import { MAX_SEARCHES, chatPieces } from "./chatText.js";

describe("chatPieces", () => {
  it("turns search markers into buttons and keeps the words around them", () => {
    expect(chatPieces("Look in Electronics.\n[[search: wireless earbuds]]\n[[ search : سماعات بلوتوث ]]\nCompare battery life.")).toEqual([
      { kind: "text", text: "Look in Electronics." },
      { kind: "search", term: "wireless earbuds" },
      { kind: "search", term: "سماعات بلوتوث" },
      { kind: "text", text: "Compare battery life." },
    ]);
  });

  it("is plain text when there is no marker", () => {
    expect(chatPieces("Returns are free within 14 days.")).toEqual([{ kind: "text", text: "Returns are free within 14 days." }]);
  });

  it("drops a marker that is not a plain search, rather than showing it", () => {
    for (const bad of ["[[search: call 99887766]]", "[[search: noura@gmail.com]]", "[[search: <script>]]", `[[search: ${"x".repeat(80)}]]`, "[[search: https://evil.example]]"]) {
      expect(chatPieces(`Try this.\n${bad}`)).toEqual([{ kind: "text", text: "Try this." }]);
    }
  });

  it("draws at most three, and each term once", () => {
    const answer = ["a", "b", "b", "c", "d"].map(term => `[[search: ${term}]]`).join("\n");
    const searches = chatPieces(answer).filter(piece => piece.kind === "search");
    expect(searches).toHaveLength(MAX_SEARCHES);
    expect(searches.map(piece => piece.kind === "search" && piece.term)).toEqual(["a", "b", "c"]);
  });

  it("holds back a marker still being written while the answer streams", () => {
    expect(chatPieces("Try these:\n[[sea", { streaming: true })).toEqual([{ kind: "text", text: "Try these:" }]);
    expect(chatPieces("Try these:\n[[search: ear", { streaming: true })).toEqual([{ kind: "text", text: "Try these:" }]);
    expect(chatPieces("Try these:\n[[search: earbuds]]", { streaming: true })).toEqual([
      { kind: "text", text: "Try these:" },
      { kind: "search", term: "earbuds" },
    ]);
  });
});
