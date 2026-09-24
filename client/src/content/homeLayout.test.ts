import { describe, expect, it } from "vitest";
import { categoryRail, editorialUpdates, footerGroups, homeRailDefinitions, railSupportCardContent } from "./homeLayout";
import { en, type MessageKey } from "@shared/i18n/dictionary";

describe("NetLet home layout content", () => {
  it("defines the requested marketplace rail hierarchy", () => {
    expect(homeRailDefinitions.map((rail) => en[rail.title])).toEqual(["Deals", "Bestsellers", "Most popular", "Newest"]);
  });

  it("keeps category, editorial, and support/footer sections available", () => {
    expect(categoryRail).toHaveLength(6);
    expect(editorialUpdates).toHaveLength(3);
    expect(footerGroups).toHaveLength(4);
    expect(railSupportCardContent).toHaveLength(3);
  });

  // Every string on the home page comes out of the dictionary, so a key that
  // is not in it renders as the key itself in both languages.
  it("references only keys the dictionary actually defines", () => {
    const keys: MessageKey[] = [
      ...categoryRail.map((category) => category.key),
      ...homeRailDefinitions.flatMap((rail) => [rail.title, rail.description]),
      ...editorialUpdates.flatMap((entry) => [entry.date, entry.title, entry.summary]),
      ...railSupportCardContent.flatMap((card) => [card.eyebrow, card.title]),
      ...footerGroups.flatMap((group) => [group.title, ...group.links.map((link) => link.key)]),
    ];
    expect(keys.filter((key) => !(key in en))).toEqual([]);
  });

  // A footer link with no destination raises a "coming soon" notice. That is
  // the right answer only for the sections that genuinely have no page yet, so
  // this pins the list: anything new added without a destination fails here.
  it("gives every footer link a destination except the sections still unbuilt", () => {
    const danglingLinks = footerGroups
      .flatMap((group) => group.links)
      .filter((link) => !("query" in link) && !("href" in link) && !("route" in link))
      .map((link) => link.key);
    // "Sell with us" left this list when self-registration landed (3.3.1) and
    // gave it `/sell` to point at.
    expect(danglingLinks).toEqual(["footer.returns", "footer.contact", "footer.ourStory"]);
  });
});
