import { describe, expect, it } from "vitest";
import { defaultStates, FEATURE_KEYS, FEATURES, featureForEntry, resolveStates } from "./features.js";

describe("feature switches", () => {
  it("treats a missing row as the feature's default — on, except the few with nothing behind them yet", () => {
    expect(resolveStates([])).toEqual(defaultStates());
    expect(resolveStates([{ key: "chat", enabled: false }])).toMatchObject({ chat: false, returns: true });
    expect(FEATURE_KEYS.filter(key => !FEATURES[key].defaultOn).sort()).toEqual(["affiliates", "appBanner", "articles", "photoSearch", "subscriptions", "voiceSearch"]);
    expect(resolveStates([{ key: "voiceSearch", enabled: true }])).toMatchObject({ voiceSearch: true, photoSearch: false });
  });

  it("reads past a row for a feature this build no longer has", () => {
    expect(resolveStates([{ key: "teleport", enabled: false }])).toEqual(defaultStates());
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
