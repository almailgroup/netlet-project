import { describe, expect, it } from "vitest";
import { describeError } from "./describeError.js";

describe("describeError", () => {
  // The case it exists for: drizzle says "Failed query", and the reason a
  // production database is unreachable is one level down.
  it("walks the cause chain rather than reporting only the wrapper", () => {
    const root = new Error("SASL authentication failed");
    const wrapper = new Error("Failed query: select 1", { cause: root });
    const described = describeError(wrapper);
    expect(described).toContain("Failed query");
    expect(described).toContain("SASL authentication failed");
  });

  it("includes the Postgres fields that live off the message", () => {
    const pgError = Object.assign(new Error("relation does not exist"), {
      code: "42P01",
      detail: "no such table",
    });
    const described = describeError(pgError);
    expect(described).toContain("42P01");
    expect(described).toContain("no such table");
  });

  it("stops rather than looping on a cycle", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as Error & { cause?: unknown }).cause = b;
    expect(() => describeError(a)).not.toThrow();
    expect(describeError(a).split("caused by").length).toBeLessThanOrEqual(4);
  });

  it("handles something thrown that is not an Error at all", () => {
    expect(describeError("just a string")).toBe("just a string");
  });
});
