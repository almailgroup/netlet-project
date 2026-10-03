import { describe, expect, it } from "vitest";
import { kuwaitDeliveryZones } from "../customer.js";
import { GOVERNORATE_CENTRES, KUWAIT_CENTRE, centreFor, cleanPin, formatPin, mapsLink, pinProblem, storedPin } from "./geo.js";

describe("pins", () => {
  it("accepts a pin in Kuwait City, on Failaka and on Bubiyan", () => {
    expect(pinProblem(KUWAIT_CENTRE)).toBeNull();
    expect(pinProblem({ lat: 29.4356, lng: 48.3311 })).toBeNull();
    expect(pinProblem({ lat: 29.8000, lng: 48.2500 })).toBeNull();
  });

  it("refuses a pin outside the country rather than dispatching to it", () => {
    expect(pinProblem({ lat: 30.5085, lng: 47.7804 })).toBe("address.pinOutsideKuwait"); // Basra
    expect(pinProblem({ lat: 24.7136, lng: 46.6753 })).toBe("address.pinOutsideKuwait"); // Riyadh
    expect(pinProblem({ lat: 0, lng: 0 })).toBe("address.pinOutsideKuwait");
  });

  it("refuses a value that is not a number at all", () => {
    expect(pinProblem({ lat: Number.NaN, lng: 47.9 })).toBe("address.badPin");
    expect(pinProblem({ lat: 29.3, lng: Number.POSITIVE_INFINITY })).toBe("address.badPin");
  });

  it("keeps five decimal places, about a metre", () => {
    expect(cleanPin({ lat: 29.375912345, lng: 47.977449999 })).toEqual({ lat: 29.37591, lng: 47.97745 });
  });

  it("stores a usable pin and nothing for an unusable one", () => {
    expect(storedPin(null)).toBeNull();
    expect(storedPin(undefined)).toBeNull();
    expect(storedPin({ lat: 51.5, lng: -0.12 })).toBeNull();
    expect(storedPin({ lat: 29.3759123, lng: 47.9774 })).toEqual({ lat: 29.37591, lng: 47.9774 });
  });

  it("links to the pin in a maps app", () => {
    expect(mapsLink({ lat: 29.3759123, lng: 47.9774 })).toBe("https://www.google.com/maps/search/?api=1&query=29.37591,47.9774");
  });

  it("formats a pin in Latin digits to five places", () => {
    expect(formatPin({ lat: 29.3759, lng: 47.9774 })).toBe("29.37590, 47.97740");
  });

  it("has a centre for every governorate the shop delivers to, each inside the box", () => {
    for (const zone of kuwaitDeliveryZones) {
      expect(GOVERNORATE_CENTRES[zone.id], zone.id).toBeDefined();
      expect(pinProblem(GOVERNORATE_CENTRES[zone.id])).toBeNull();
    }
    expect(centreFor("jahra")).toEqual(GOVERNORATE_CENTRES.jahra);
    expect(centreFor(null)).toEqual(KUWAIT_CENTRE);
    expect(centreFor("atlantis")).toEqual(KUWAIT_CENTRE);
  });
});
