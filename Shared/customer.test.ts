import { describe, expect, it } from "vitest";
import { defaultNotificationPreferences, kuwaitDeliveryZones, notificationKinds } from "./customer.js";

describe("NetLet customer foundation contracts", () => {
  it("offers the six Kuwaiti governorates without inventing delivery operations", () => {
    expect(kuwaitDeliveryZones.map(zone => zone.id)).toEqual([
      "capital",
      "hawalli",
      "farwaniya",
      "ahmadi",
      "jahra",
      "mubarak-al-kabeer",
    ]);
    expect(kuwaitDeliveryZones.every(zone => zone.configured === false)).toBe(true);
    expect(kuwaitDeliveryZones.every(zone => zone.estimateLabel === "Estimate awaiting setup")).toBe(true);
  });

  it("defines each shopper notification preference with a deliberate default", () => {
    expect(Object.keys(defaultNotificationPreferences).sort()).toEqual([...notificationKinds].sort());
    expect(defaultNotificationPreferences.delivery_update).toBe(true);
    expect(defaultNotificationPreferences.bag_reminder).toBe(false);
  });
});
