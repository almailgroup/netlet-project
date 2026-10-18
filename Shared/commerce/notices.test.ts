import { describe, expect, it } from "vitest";
import { en, ar } from "../i18n/dictionary.js";
import { translate } from "../i18n/dictionary.js";
import { defaultNotificationPreferences, type NotificationKind } from "../customer.js";
import {
  NOTICE_KINDS,
  NOTICE_RULES,
  cameBack,
  dedupe,
  emailed,
  isSiteLink,
  isoWeek,
  noticeValues,
  priceFell,
  retryAfterMs,
  silenced,
} from "./notices.js";

describe("the rules", () => {
  it("has a rule, and a sentence in both languages, for every kind", () => {
    for (const kind of NOTICE_KINDS) {
      const rule = NOTICE_RULES[kind];
      expect(en[rule.key], kind).toBeTruthy();
      expect(ar[rule.key], kind).toBeTruthy();
    }
  });

  it("never silences money", () => {
    for (const kind of ["order_placed", "line_cancelled", "return_approved", "return_declined", "refund_done"] as const) {
      expect(NOTICE_RULES[kind].preference).toBeNull();
    }
  });

  it("lets a preference silence only what it names, and reads a missing row as the default", () => {
    const off = new Map<NotificationKind, boolean>([["price_drop", false]]);
    expect(silenced("price_drop", off, defaultNotificationPreferences)).toBe(true);
    expect(silenced("back_in_stock", off, defaultNotificationPreferences)).toBe(false);
    /* Cart reminders are off until somebody turns them on. */
    expect(silenced("bag_reminder", new Map(), defaultNotificationPreferences)).toBe(!defaultNotificationPreferences.bag_reminder);
    expect(silenced("order_placed", new Map([["delivery_update", false]]), defaultNotificationPreferences)).toBe(false);
  });

  it("emails nothing to somebody who said no, and never emails a new arrival", () => {
    expect(emailed("order_placed", true)).toBe(true);
    expect(emailed("order_placed", false)).toBe(false);
    expect(emailed("new_arrival", true)).toBe(false);
  });

  it("backs off between email attempts", () => {
    expect(retryAfterMs(1)).toBe(60_000);
    expect(retryAfterMs(2)).toBe(240_000);
    expect(retryAfterMs(4)).toBeGreaterThan(retryAfterMs(3));
  });
});

describe("links", () => {
  it("keeps a notice's link on this site", () => {
    expect(isSiteLink("/account/orders?order=NL-1")).toBe(true);
    expect(isSiteLink("/products/lamp")).toBe(true);
    expect(isSiteLink("https://elsewhere.example/")).toBe(false);
    expect(isSiteLink("//elsewhere.example/")).toBe(false);
    expect(isSiteLink("/\\elsewhere.example")).toBe(false);
    expect(isSiteLink("javascript:alert(1)")).toBe(false);
    expect(isSiteLink(null)).toBe(false);
  });
});

describe("what a follower hears", () => {
  const gone = { available: false, lowestFils: 20_000n };
  const here = { available: true, lowestFils: 20_000n };
  it("hears a product came back only when it could not be bought before", () => {
    expect(cameBack(gone, here)).toBe(true);
    expect(cameBack(here, here)).toBe(false);
    expect(cameBack(here, gone)).toBe(false);
  });

  it("hears a lower price only on something they can buy", () => {
    expect(priceFell(here, { available: true, lowestFils: 18_000n })).toBe(true);
    expect(priceFell(here, { available: false, lowestFils: 18_000n })).toBe(false);
    expect(priceFell(here, { available: true, lowestFils: 21_000n })).toBe(false);
    expect(priceFell({ available: true, lowestFils: null }, here)).toBe(false);
  });

  it("names the new price and never the old one", () => {
    const sentence = translate("en", NOTICE_RULES.price_drop.key, { product: "Lamp", price: "KWD 18.000" });
    expect(sentence).toBe("Lamp now costs KWD 18.000.");
    expect(en[NOTICE_RULES.price_drop.key]).not.toMatch(/was|from|down/i);
  });
});

describe("the same event is one notice", () => {
  it("names events by what they are, so a repeat collides", () => {
    const at = new Date("2026-10-18T09:00:00Z");
    expect(dedupe.order("NL-1", "shipped")).toBe(dedupe.order("NL-1", "shipped"));
    expect(dedupe.backInStock(7, at)).toBe(dedupe.backInStock(7, new Date("2026-10-18T19:00:00Z")));
    /* A day in Kuwait: 21:30 UTC is already the next morning there. */
    expect(dedupe.backInStock(7, at)).not.toBe(dedupe.backInStock(7, new Date("2026-10-18T21:30:00Z")));
    expect(dedupe.priceDrop(7, 18_000n, at)).not.toBe(dedupe.priceDrop(7, 17_000n, at));
    expect(dedupe.bag("c1", at)).not.toBe(dedupe.bag("c1", new Date(at.getTime() + 1)));
  });

  it("counts weeks the ISO way", () => {
    expect(isoWeek(new Date("2026-10-18T09:00:00Z"))).toBe("2026-W42");
    expect(isoWeek(new Date("2026-01-01T09:00:00Z"))).toBe("2026-W01");
    expect(isoWeek(new Date("2027-01-01T09:00:00Z"))).toBe("2026-W53");
  });
});

describe("drawing a notice", () => {
  it("uses the Arabic twin on the Arabic page when there is one, and formats amounts", () => {
    const params = { product: "Lamp", productAr: "مصباح", store: "Acme", storeAr: "", price: "18.000" };
    const format = (amount: string) => `KWD ${amount}`;
    expect(noticeValues(params, true, format)).toEqual({ product: "مصباح", store: "Acme", price: "KWD 18.000" });
    expect(noticeValues(params, false, format)).toEqual({ product: "Lamp", store: "Acme", price: "KWD 18.000" });
  });

  it("says a basket's count in the form its number needs", () => {
    expect(translate("en", "notice.bagReminder", { count: 1 })).toBe("You left an item in your cart.");
    expect(translate("en", "notice.bagReminder", { count: 3 })).toBe("You left 3 items in your cart.");
    expect(translate("ar", "notice.bagReminder", { count: 2 })).toBe("تركت منتجين في سلتك.");
    expect(translate("ar", "notice.bagReminder", { count: 5 })).toBe("تركت 5 منتجات في سلتك.");
    expect(translate("ar", "notice.bagReminder", { count: 12 })).toBe("تركت 12 منتجاً في سلتك.");
  });
});
