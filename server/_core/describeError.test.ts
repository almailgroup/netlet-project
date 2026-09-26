import { describe, expect, it } from "vitest";
import { describeError, rootCauseOf } from "./describeError.js";

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

describe("rootCauseOf", () => {
  /*
   * The shape a broken deploy actually throws: Drizzle's wrapper is a hundred
   * characters of `select`, and the one line worth reading is underneath it.
   */
  it("digs past the failed-query wrapper to the database's own words", () => {
    const pg = Object.assign(new Error('column products.size_class does not exist'), { code: "42703" });
    const drizzle = new Error('Failed query: select "products"."id", "products"."size_class" from "products"', { cause: pg });
    expect(rootCauseOf(drizzle)).toBe("column products.size_class does not exist");
  });

  it("keeps the outermost message when nothing is wrapped", () => {
    expect(rootCauseOf(new Error("Database is not configured"))).toBe("Database is not configured");
  });

  it("survives a cycle and a non-error", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(() => rootCauseOf(a)).not.toThrow();
    expect(rootCauseOf("just a string")).toBe("just a string");
  });

  /* Never an empty bubble: a page showing nothing at all is the failure mode
     this whole gate exists to stop. */
  it("says something even when the error says nothing", () => {
    expect(rootCauseOf(new Error(""))).toBe("Unknown error");
    expect(rootCauseOf(undefined)).toBe("Unknown error");
  });
});
