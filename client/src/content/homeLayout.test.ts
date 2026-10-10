import { describe, expect, it } from "vitest";
import { categoryRail, editorialUpdates, homeRailDefinitions } from "./homeLayout";
import { en, type MessageKey } from "@shared/i18n/dictionary";

describe("NetLet home layout content", () => {
  it("defines the requested marketplace rail hierarchy", () => {
    expect(homeRailDefinitions.map((rail) => en[rail.title])).toEqual(["Deals", "Bestsellers", "Most popular", "Newest"]);
  });

  it("keeps category and editorial sections available", () => {
    expect(categoryRail).toHaveLength(6);
    expect(editorialUpdates).toHaveLength(3);
  });

  // Every string on the home page comes out of the dictionary, so a key that
  // is not in it renders as the key itself in both languages.
  it("references only keys the dictionary actually defines", () => {
    const keys: MessageKey[] = [
      ...categoryRail.map((category) => category.key),
      ...homeRailDefinitions.flatMap((rail) => [rail.title, rail.description]),
      ...editorialUpdates.flatMap((entry) => [entry.date, entry.title, entry.summary]),
    ];
    expect(keys.filter((key) => !(key in en))).toEqual([]);
  });
});
