import { describe, expect, it } from "vitest";
import { allOn, FEATURE_KEYS, FEATURES, featureForEntry, resolveStates } from "./features.js";

describe("feature switches", () => {
  it("treats a missing row as on", () => {
    expect(resolveStates([])).toEqual(allOn());
    expect(resolveStates([{ key: "chat", enabled: false }])).toMatchObject({ chat: false, returns: true });
  });

  it("reads past a row for a feature this build no longer has", () => {
    expect(resolveStates([{ key: "teleport", enabled: false }])).toEqual(allOn());
  });

  it("maps each entry back to its feature, and nothing else to anything", () => {
    expect(featureForEntry("chat.send")).toBe("chat");
    expect(featureForEntry("dispatch.claims.file")).toBe("damageClaims");
    expect(featureForEntry("chat.mine")).toBeNull();
    expect(featureForEntry("commerce.cart.get")).toBeNull();
  });

  it("never lets one procedure belong to two switches", () => {
    const entries = FEATURE_KEYS.flatMap(key => FEATURES[key].entries);
    expect(new Set(entries).size).toBe(entries.length);
  });
});
