import { describe, expect, it } from "vitest";
import { ACCOUNT_PLACES, accountPlacesMatching } from "./accountSearch";
import { isMessageKey } from "../i18n/dictionary";

const everything = () => true;
const ids = (term: string, has: (part: string) => boolean = everything) => accountPlacesMatching(term, has).map(place => place.id);

describe("the account's own search", () => {
  it("finds a row of Your profile by its own name, in either language", () => {
    /* The password first, then Your profile, whose hint mentions it. */
    expect(ids("password")).toEqual(["password", "profile"]);
    expect(ids("كلمة المرور")[0]).toBe("password");
    expect(ids("birthday")).toEqual(["about"]);
  });

  it("finds what a page holds by the page's name too", () => {
    /* "profile" is Your profile and every row under it. */
    expect(ids("profile")).toEqual(expect.arrayContaining(["profile", "name", "email", "phone", "password", "about", "photo", "deleteAccount"]));
    expect(ids("wallet")).toEqual(["wallet", "points", "cards"]);
  });

  it("finds a section by the words of its hint", () => {
    expect(ids("track")).toContain("orders");
    expect(ids("refund")).toEqual([]);
    expect(ids("returns")).toContain("returns");
  });

  it("offers a part only to an account that has it", () => {
    expect(ids("price requests")).toEqual(["offers"]);
    expect(ids("price requests", part => part !== "offers")).toEqual([]);
    expect(ids("haptic", part => part !== "haptics")).toEqual([]);
  });

  it("names every place by dictionary keys, each place once", () => {
    for (const entry of ACCOUNT_PLACES) {
      for (const key of [entry.label, entry.within, ...entry.words]) if (key) expect(isMessageKey(key), key).toBe(true);
    }
    expect(new Set(ACCOUNT_PLACES.map(entry => entry.id)).size).toBe(ACCOUNT_PLACES.length);
  });
});
