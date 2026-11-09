import { describe, expect, it } from "vitest";
import { portalRecordings, stalePortalRecordings } from "./portalRecordings.js";

describe("the portal's demo recordings", () => {
  it("are what the shop's own rules make of the demo store, and committed as such", () => {
    expect(stalePortalRecordings(), "run pnpm ios:portal-recordings").toEqual([]);
  });

  it("give the store a month to compare and a shelf with something to do", () => {
    const recordings = portalRecordings() as Record<string, any>;
    const board = recordings["inventory.dashboard"];
    expect(board.days).toHaveLength(30);
    expect(board.forecast).toHaveLength(7);
    expect(board.newAccounts).toBeNull();
    expect(recordings["inventory.dashboard.admin"].newAccounts).toHaveLength(30);
    const insights = recordings["inventory.copilot.brief"].insights;
    expect(insights.some((insight: { action?: { kind: string } }) => insight.action?.kind === "reorder")).toBe(true);
    expect(recordings["inventory.overview"].outOfStock).toBe(recordings["inventory.stockHealth"].out);
  });
});
