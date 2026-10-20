import { describe, expect, it } from "vitest";
import { MAX_ASKS, MAX_SEARCHES, chatPieces, nextQuestions } from "./chatText.js";

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

  it("reads follow-up questions beside the searches", () => {
    expect(chatPieces("It charges by USB-C.\n[[search: usb-c charger]]\n[[ask: How long does the battery last?]]\n[[ ASK : هل يأتي بضمان؟ ]]")).toEqual([
      { kind: "text", text: "It charges by USB-C." },
      { kind: "search", term: "usb-c charger" },
      { kind: "ask", question: "How long does the battery last?" },
      { kind: "ask", question: "هل يأتي بضمان؟" },
    ]);
  });

  it("drops a question that is not a plain question", () => {
    for (const bad of ["[[ask: Call 99887766?]]", "[[ask: Email noura@gmail.com?]]", "[[ask: <b>Is it</b>?]]", `[[ask: ${"why ".repeat(30)}?]]`, "[[ask: Is it at www.example.com?]]", "[[ask: ?]]"]) {
      expect(chatPieces(`Sure.\n${bad}`)).toEqual([{ kind: "text", text: "Sure." }]);
    }
  });

  it("draws at most three questions, each once, apart from the searches' count", () => {
    const answer = ["[[search: a]]", ...["One?", "Two?", "two?", "Three?", "Four?"].map(question => `[[ask: ${question}]]`)].join("\n");
    const pieces = chatPieces(answer);
    expect(pieces.filter(piece => piece.kind === "search")).toHaveLength(1);
    const asks = pieces.flatMap(piece => (piece.kind === "ask" ? [piece.question] : []));
    expect(asks).toHaveLength(MAX_ASKS);
    expect(asks).toEqual(["One?", "Two?", "Three?"]);
  });

  it("holds back a question still being written", () => {
    expect(chatPieces("Yes.\n[[ask: Does it", { streaming: true })).toEqual([{ kind: "text", text: "Yes." }]);
  });
});

describe("nextQuestions", () => {
  const starters = ["What is this?", "What comes in the box?", "Who is it for?", "Explain the specifications"];
  const answer = (text: string, state = "done") => ({ role: "assistant" as const, text, state });
  const asked = (text: string) => ({ role: "user" as const, text });

  it("offers the starters before anything is asked, all of them", () => {
    expect(nextQuestions([], starters)).toEqual({ questions: starters, followUps: false });
  });

  it("offers nothing while a question waits or an answer arrives", () => {
    expect(nextQuestions([asked("What is this?")], starters).questions).toEqual([]);
    expect(nextQuestions([asked("What is this?"), answer("A watch. [[ask: Is it", "streaming")], starters).questions).toEqual([]);
  });

  it("offers the answer's own questions once it is whole", () => {
    expect(nextQuestions([asked("What is this?"), answer("A watch.\n[[ask: Is it waterproof?]]\n[[ask: Does it work with an iPhone?]]")], starters))
      .toEqual({ questions: ["Is it waterproof?", "Does it work with an iPhone?"], followUps: true });
  });

  it("never offers a question already asked, in any case", () => {
    const turns = [asked("Is it waterproof?"), answer("Yes.\n[[ask: is it waterproof?]]\n[[ask: How long does the battery last?]]")];
    expect(nextQuestions(turns, starters).questions).toEqual(["How long does the battery last?"]);
  });

  it("falls back to the starters not yet asked, at most three, when the answer offers nothing new", () => {
    const turns = [asked("What is this?"), answer("A watch.\n[[ask: What is this?]]")];
    expect(nextQuestions(turns, starters)).toEqual({ questions: starters.slice(1, 1 + MAX_ASKS), followUps: false });
  });

  it("takes no follow-ups from an answer that was stopped, blocked or lost", () => {
    for (const state of ["stopped", "blocked", "failed"]) {
      const turns = [asked("What is this?"), answer("A watch.\n[[ask: Is it waterproof?]]", state)];
      expect(nextQuestions(turns, starters).followUps).toBe(false);
    }
  });
});
