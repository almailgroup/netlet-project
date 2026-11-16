import { describe, expect, it } from "vitest";
import { sameDayOffered, sampleRate } from "./rates.js";

describe("the rate calculator's sample prices", () => {
  it("adds a line for each thing that costs more, and the lines make the total", () => {
    const quote = sampleRate({ from: "hawalli", to: "jahra", size: "medium", speed: "nextDay", pieces: 3, cod: true });
    expect(quote.lines.map(line => line.label)).toEqual(["rates.base", "rates.across", "rates.extraPieces", "rates.codFee"]);
    expect(quote.totalFils).toBe(2500 + 500 + 1000 + 250);
  });

  it("charges same day only where it is offered", () => {
    expect(sameDayOffered("capital", "hawalli")).toBe(true);
    expect(sameDayOffered("capital", "ahmadi")).toBe(false);
    expect(sampleRate({ from: "capital", to: "capital", size: "small", speed: "sameDay", pieces: 1, cod: false }).totalFils).toBe(3000);
    expect(sampleRate({ from: "capital", to: "ahmadi", size: "small", speed: "sameDay", pieces: 1, cod: false }).totalFils).toBe(2000);
  });

  it("holds the pieces to 1–99", () => {
    expect(sampleRate({ from: "capital", to: "capital", size: "small", speed: "nextDay", pieces: 0, cod: false }).totalFils).toBe(1500);
  });
});
