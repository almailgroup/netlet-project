import { describe, expect, it } from "vitest";
import { MAX_PHOTO_CHARS, acceptablePhoto, queryFromModel } from "./photoSearch.js";

describe("what may be sent", () => {
  it("takes a small image as a data URL and nothing else", () => {
    expect(acceptablePhoto("data:image/jpeg;base64,/9j/4AAQSkZJRg==")).toBe(true);
    expect(acceptablePhoto("data:image/webp;base64,UklGRg==")).toBe(true);
    expect(acceptablePhoto("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(acceptablePhoto("https://example.com/photo.jpg")).toBe(false);
    expect(acceptablePhoto("data:image/jpeg;base64,abc<script>")).toBe(false);
    expect(acceptablePhoto(`data:image/jpeg;base64,${"A".repeat(MAX_PHOTO_CHARS)}`)).toBe(false);
  });
});

describe("what comes back", () => {
  it("reads the query out of the JSON asked for", () => {
    expect(queryFromModel('{"query": "brass table lamp"}')).toBe("brass table lamp");
    expect(queryFromModel('Sure! ```json\n{"query":"red kettle"}\n```')).toBe("red kettle");
  });

  it("takes plain text when the model ignored the format", () => {
    expect(queryFromModel("white running shoes")).toBe("white running shoes");
  });

  it("keeps Arabic and drops markup, punctuation and length", () => {
    expect(queryFromModel('{"query": "مصباح نحاسي"}')).toBe("مصباح نحاسي");
    expect(queryFromModel('{"query": "<b>lamp</b>; DROP TABLE"}')).toBe("b lamp b DROP TABLE");
    expect(queryFromModel("one two three four five six seven eight").split(" ")).toHaveLength(6);
  });

  it("answers nothing for nothing", () => {
    expect(queryFromModel('{"query": ""}')).toBe("");
    expect(queryFromModel('{"query": 42}')).toBe("");
    expect(queryFromModel("   ")).toBe("");
  });
});
