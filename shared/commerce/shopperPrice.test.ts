import { describe, expect, it } from "vitest";
import { shopperPrice } from "./shopperPrice.js";

const offer = (offered: string) => ({ status: "offered" as const, offeredPrice: offered, expiresAt: new Date(Date.now() + 86_400_000), usedOnOrderId: null });

describe("what a shopper pays", () => {
  it("is the shelf when nothing lowers it", () => {
    expect(shopperPrice({ listPrice: "20.000" })).toEqual({ charged: "20.000", reason: "list" });
  });

  it("lets a bundle decide first, whatever else applies", () => {
    expect(shopperPrice({ listPrice: "20.000", bundlePrice: "19.000", memberPrice: "15.000" })).toEqual({ charged: "19.000", reason: "bundle" });
  });

  it("gives the lowest reduction and never stacks them", () => {
    expect(shopperPrice({ listPrice: "20.000", memberPrice: "17.000", subscriberPercent: 10, agreed: offer("16.000") }))
      .toEqual({ charged: "16.000", reason: "agreed" });
    expect(shopperPrice({ listPrice: "20.000", memberPrice: "15.000", subscriberPercent: 10, agreed: offer("16.000") }))
      .toEqual({ charged: "15.000", reason: "member" });
  });

  it("does not spend an agreed price on a figure the shopper had anyway", () => {
    expect(shopperPrice({ listPrice: "20.000", memberPrice: "16.000", agreed: offer("16.000") }).reason).toBe("member");
  });

  it("never charges more than the shelf because of an agreement", () => {
    expect(shopperPrice({ listPrice: "12.000", agreed: offer("16.000") })).toEqual({ charged: "12.000", reason: "list" });
  });
});
