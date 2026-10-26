import { describe, expect, it } from "vitest";
import { standingCount, suspends, warningExpiry, warningReasonProblem, warningState } from "./warnings.js";

const at = (iso: string) => new Date(iso);
const issued = (iso: string, withdrawnAt: Date | null = null) => ({ createdAt: at(iso), expiresAt: warningExpiry(at(iso)), withdrawnAt });

describe("a store's warnings (3.3.18)", () => {
  const now = at("2026-10-26T12:00:00Z");

  it("stands for a year, unless withdrawn or issued before the count restarted", () => {
    expect(warningState(issued("2026-01-01T00:00:00Z"), null, now)).toBe("standing");
    expect(warningState(issued("2025-10-26T11:00:00Z"), null, now)).toBe("lapsed");
    expect(warningState(issued("2026-05-01T00:00:00Z", at("2026-05-02T00:00:00Z")), null, now)).toBe("withdrawn");
    expect(warningState(issued("2026-05-01T00:00:00Z"), at("2026-06-01T00:00:00Z"), now)).toBe("cleared");
  });

  it("suspends at three standing, and only standing ones count", () => {
    const list = [issued("2026-03-01T00:00:00Z"), issued("2026-04-01T00:00:00Z"), issued("2025-01-01T00:00:00Z"), issued("2026-05-01T00:00:00Z", now)];
    expect(standingCount(list, null, now)).toBe(2);
    expect(suspends(2)).toBe(false);
    expect(suspends(standingCount([...list, issued("2026-10-01T00:00:00Z")], null, now))).toBe(true);
    /* Reinstated in September: the three before no longer count. */
    expect(standingCount([...list, issued("2026-10-01T00:00:00Z")], at("2026-09-01T00:00:00Z"), now)).toBe(1);
  });

  it("needs a reason the store can read", () => {
    expect(warningReasonProblem("  ")).toBe("warnings.needsReason");
    expect(warningReasonProblem("x".repeat(401))).toBe("warnings.tooLong");
    expect(warningReasonProblem("Listed a counterfeit")).toBeNull();
  });
});
