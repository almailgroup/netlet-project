import { describe, expect, it } from "vitest";
import { catalogExample } from "./LiveSearch";
import { ar, en, type MessageKey } from "@shared/i18n/dictionary";
import type { Product } from "@shared/commerce/types";

const typed = (...types: (string | null)[]) => types.map(productType => ({ productType }) as Product);
const english = (key: MessageKey) => en[key];
const arabic = (key: MessageKey) => ar[key];

describe("the search placeholder's example", () => {
  it("names a department in the page's own language", () => {
    expect(catalogExample(typed("Electronics"), english, false)).toBe("electronics");
    expect(catalogExample(typed("Electronics"), arabic, true)).toBe(ar["category.electronics"]);
  });

  /* "ابحث عن electronics" was the bug: a seller's English word on the Arabic page. */
  it("never puts a seller's English word in the Arabic field", () => {
    expect(catalogExample(typed(null, "Garden tools"), english, false)).toBe("garden tools");
    expect(catalogExample(typed("Garden tools"), arabic, true)).toBeNull();
    expect(catalogExample(typed("Garden tools", "عطور"), arabic, true)).toBe("عطور");
  });

  it("asks plainly when the shelf has nothing to draw on", () => {
    expect(catalogExample([], english, false)).toBeNull();
  });
});
