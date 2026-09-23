import { describe, expect, it } from "vitest";
import { vehicleFor, vehicleForDelivery, vehicleForQuantity } from "./vehicle.js";

describe("what one product needs", () => {
  it("takes the seller's declared size class", () => {
    expect(vehicleFor({ sizeClass: "small" })).toBe("bike");
    expect(vehicleFor({ sizeClass: "medium" })).toBe("car");
    expect(vehicleFor({ sizeClass: "large" })).toBe("van");
    expect(vehicleFor({ sizeClass: "oversize" })).toBe("truck");
  });

  /*
   * A mattress is light and needs a van: the class knows something about the
   * shape that a weight cannot.
   */
  it("prefers the declared class over the weight", () => {
    expect(vehicleFor({ sizeClass: "large", weightGrams: 900 })).toBe("van");
  });

  it("falls back to weight when there is no class", () => {
    expect(vehicleFor({ weightGrams: 900 })).toBe("bike");
    expect(vehicleFor({ weightGrams: 12_000 })).toBe("car");
    expect(vehicleFor({ weightGrams: 60_000 })).toBe("van");
    expect(vehicleFor({ weightGrams: 400_000 })).toBe("truck");
  });

  /* Guessing small is how a sofa is dispatched on a motorcycle. */
  it("answers null rather than guessing small", () => {
    expect(vehicleFor({})).toBeNull();
    expect(vehicleFor({ sizeClass: null, weightGrams: null })).toBeNull();
    expect(vehicleFor({ sizeClass: "enormous" })).toBeNull();
    expect(vehicleFor({ weightGrams: 0 })).toBeNull();
    expect(vehicleFor({ weightGrams: Number.NaN })).toBeNull();
  });
});

describe("what a whole delivery needs", () => {
  /* A phone case and a sofa in one van is a van. */
  it("is the largest any line needs", () => {
    expect(vehicleForDelivery([{ sizeClass: "small" }, { sizeClass: "large" }, { sizeClass: "small" }])).toBe("van");
  });

  /* One line nobody measured must not talk a dispatcher down from a van. */
  it("skips a line it knows nothing about rather than counting it small", () => {
    expect(vehicleForDelivery([{ sizeClass: "large" }, {}])).toBe("van");
    expect(vehicleForDelivery([{}, {}])).toBeNull();
  });
});

describe("quantity", () => {
  /* Ten of something a bike can carry is not a bike delivery. */
  it("lets weight push the answer up", () => {
    expect(vehicleForQuantity({ weightGrams: 4_000 }, 1)).toBe("bike");   // 4 kg
    expect(vehicleForQuantity({ weightGrams: 4_000 }, 5)).toBe("car");    // 20 kg
    expect(vehicleForQuantity({ weightGrams: 4_000 }, 10)).toBe("van");   // 40 kg
    expect(vehicleForQuantity({ weightGrams: 4_000 }, 100)).toBe("truck"); // 400 kg
  });

  it("keeps the declared class as a floor", () => {
    expect(vehicleForQuantity({ sizeClass: "large", weightGrams: 100 }, 50)).toBe("van");
    expect(vehicleForQuantity({ sizeClass: "small", weightGrams: 40_000 }, 5)).toBe("truck");
  });

  it("treats a nonsense quantity as one", () => {
    expect(vehicleForQuantity({ weightGrams: 4_000 }, 0)).toBe("bike");
    expect(vehicleForQuantity({ weightGrams: 4_000 }, -3)).toBe("bike");
  });
});
