import { describe, expect, it } from "vitest";
import { ar, en, translate, type MessageKey } from "./dictionary";
import { PLURAL_FORMS, pluralCategory } from "./plurals";
import { RETURN_WINDOW_DAYS } from "../commerce/returns";
import { ASK_WINDOW_DAYS } from "../commerce/priceOffers";
import { DELIVERY_RATING_WINDOW_DAYS } from "../commerce/deliveryRatings";
import { CLAIM_WINDOW_DAYS } from "../commerce/damageClaims";
import { ATTRIBUTION_DAYS } from "../commerce/affiliate";

const placeholders = (text: string) => new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]));

describe("Arabic counts", () => {
  it("says each band in its own form", () => {
    const say = (count: number) => translate("ar", "browse.countMany", { count });
    expect(say(2)).toBe("منتجان");
    expect(say(3)).toBe("3 منتجات");
    expect(say(10)).toBe("10 منتجات");
    expect(say(11)).toBe("11 منتجاً");
    expect(say(99)).toBe("99 منتجاً");
    expect(say(100)).toBe("100 منتج");
    expect(say(103)).toBe("103 منتجات");
  });

  it("takes a number passed as text", () => {
    expect(translate("ar", "returns.openUntil", { date: "١ نوفمبر", days: "3" })).toContain("بقي 3 أيام");
    expect(translate("ar", "returns.openUntil", { date: "١ نوفمبر", days: "0" })).toContain("اليوم آخر يوم");
  });

  it("leaves English alone where it had the form already, and fixes the singular where it did not", () => {
    expect(translate("en", "browse.countMany", { count: 3 })).toBe("3 products");
    expect(translate("en", "wish.itemCount", { count: 1 })).toBe("1 item");
    expect(translate("en", "wish.itemCount", { count: 4 })).toBe("4 items");
  });

  it("leaves the string alone when the value is not a whole number", () => {
    expect(translate("ar", "browse.countMany", { count: "many" })).toBe("many منتج");
    expect(translate("ar", "browse.countMany")).toBe(ar["browse.countMany"]);
  });
});

describe("plural forms", () => {
  const entries = Object.entries(PLURAL_FORMS) as [MessageKey, NonNullable<(typeof PLURAL_FORMS)[MessageKey]>][];

  it("names a value the dictionary's own string carries", () => {
    for (const [key, entry] of entries) {
      expect(placeholders(en[key]), key).toContain(entry.param);
      expect(placeholders(ar[key]), key).toContain(entry.param);
    }
  });

  /* A form may drop the number itself (the dual says "منتجان", not "2
     منتجان"), but every other value the sentence carries has to survive, or
     a date or a name silently goes missing in one band. */
  it("keeps every other value in every form", () => {
    for (const [key, entry] of entries) {
      for (const locale of ["en", "ar"] as const) {
        const base = placeholders(locale === "en" ? en[key] : ar[key]);
        for (const [band, form] of Object.entries(entry[locale] ?? {})) {
          const own = placeholders(form);
          for (const name of base) if (name !== entry.param) expect(own, `${key} ${locale} ${band}`).toContain(name);
          for (const name of own) expect(base, `${key} ${locale} ${band}`).toContain(name);
        }
      }
    }
  });

  it("writes Arabic forms in Arabic", () => {
    for (const [key, entry] of entries) {
      for (const form of Object.values(entry.ar ?? {})) expect(form.replace(/\{\w+\}/g, ""), key).not.toMatch(/[A-Za-z]{3,}/);
    }
  });

  it("only uses the bands each language has", () => {
    const bands = { en: new Set(["one", "other", "zero"]), ar: new Set(["zero", "one", "two", "few", "many", "other"]) };
    for (const [key, entry] of entries) {
      for (const locale of ["en", "ar"] as const) {
        for (const band of Object.keys(entry[locale] ?? {})) expect(bands[locale].has(band), `${key} ${locale} ${band}`).toBe(true);
      }
    }
  });
});

/*
 * Sentences written for a constant are right for that constant only. Each
 * Arabic one below says its number in the band the constant is in today; when
 * a constant moves to another band this fails, and the sentence needs the
 * form for its new number — or an entry in `PLURAL_FORMS`.
 */
describe("sentences written for a constant", () => {
  it.each([
    ["returns.howTo", RETURN_WINDOW_DAYS, "many", "يوماً"],
    ["home.returnsWithin", RETURN_WINDOW_DAYS, "many", "يوماً"],
    ["returnsPage.intro", RETURN_WINDOW_DAYS, "many", "يومًا"],
    ["offers.sent", ASK_WINDOW_DAYS, "few", "أيام"],
    ["delivery.ratingClosed", DELIVERY_RATING_WINDOW_DAYS, "many", "يوماً"],
    ["claims.windowClosed", CLAIM_WINDOW_DAYS, "few", "أيام"],
    ["affiliate.pitch", ATTRIBUTION_DAYS, "many", "يوماً"],
  ] as const)("%s says %i in the right form", (key, value, band, word) => {
    expect(pluralCategory("ar", value)).toBe(band);
    expect(ar[key]).toContain(`{days} ${word}`);
  });
});
