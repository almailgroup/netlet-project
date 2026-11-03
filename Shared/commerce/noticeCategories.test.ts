import { describe, expect, it } from "vitest";
import { notificationKinds } from "../customer.js";
import { NOTICE_CATEGORIES } from "./noticeCategories.js";
import { NOTICE_KINDS, NOTICE_RULES } from "./notices.js";

describe("notification categories", () => {
  it("puts every notice a shopper can be sent in exactly one group", () => {
    const shopper = NOTICE_KINDS.filter(kind => NOTICE_RULES[kind].audience === "shopper");
    const placed = NOTICE_CATEGORIES.flatMap(category => [...category.switched, ...category.always]);
    expect([...placed].sort()).toEqual([...shopper].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("switches exactly what its preference silences, and never what nothing silences", () => {
    for (const category of NOTICE_CATEGORIES) {
      for (const kind of category.switched) expect(NOTICE_RULES[kind].preference).toBe(category.preference);
      for (const kind of category.always) expect(NOTICE_RULES[kind].preference).toBeNull();
    }
  });

  it("uses each of the account's four switches once", () => {
    const used = NOTICE_CATEGORIES.map(category => category.preference).filter(Boolean);
    expect([...used].sort()).toEqual([...notificationKinds].sort());
  });
});
