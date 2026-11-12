import { describe, expect, it } from "vitest";
import {
  curatedKeys,
  curatedOn,
  curatedProducts,
  firstOccasionProblem,
  isOccasionSlug,
  occasionName,
  occasionProblems,
  occasionSeason,
  occasionSlug,
  replacedSlugs,
  statusAllowed,
  type CuratedOccasion,
  type OccasionContent,
} from "./occasionDesk";
import { en } from "../i18n/dictionary";

const content = (extra: Partial<OccasionContent> = {}): OccasionContent => ({
  slug: "white-friday",
  title: "White Friday",
  titleAr: "الجمعة البيضاء",
  imageUrl: null,
  startsOn: "2026-11-20",
  endsOn: "2026-11-30",
  includeTagged: true,
  ...extra,
});
const row = (extra: Partial<CuratedOccasion> = {}): CuratedOccasion => ({ ...content(), status: "published", ...extra });
/* Nine in the morning in Kuwait on the day named. */
const at = (day: string) => new Date(`${day}T06:00:00Z`);

describe("an occasion's address", () => {
  it("is lower-case letters, digits and single hyphens, as the page's address reads it", () => {
    for (const good of ["white-friday", "eid2027", "a", "back-to-school"]) expect(isOccasionSlug(good), good).toBe(true);
    for (const bad of ["", "White-Friday", "white friday", "-white", "white-", "white--friday", "عيد", "a".repeat(41)]) expect(isOccasionSlug(bad), bad).toBe(false);
  });

  it("is made from the English name", () => {
    expect(occasionSlug("White Friday 2026!")).toBe("white-friday-2026");
    expect(occasionSlug("  Mother's   Day ")).toBe("mother-s-day");
    expect(occasionSlug("الجمعة البيضاء")).toBe("occasion");
    expect(isOccasionSlug(occasionSlug("A very long name for an occasion that goes on and on and on"))).toBe(true);
  });
});

describe("what is wrong with an occasion", () => {
  it("is nothing for one written whole", () => {
    expect(occasionProblems(content())).toEqual({});
    expect(firstOccasionProblem({})).toBeNull();
  });

  it("names the box, and every problem is a sentence the dictionary has", () => {
    const problems = occasionProblems(content({ title: " ", titleAr: "", slug: "White Friday", imageUrl: "https://example.com/a.jpg", startsOn: "2026-11-30", endsOn: "2026-11-20" }));
    expect(problems).toEqual({
      title: "occasions.needTitle",
      titleAr: "occasions.needTitleAr",
      slug: "occasions.badSlug",
      imageUrl: "occasions.badPicture",
      endsOn: "occasions.endsBeforeStart",
    });
    for (const key of Object.values(problems)) expect(en[key], key).toBeTruthy();
    expect(firstOccasionProblem(problems)).toEqual({ field: "title", problem: "occasions.needTitle" });
  });

  it("holds a name to the column and to the contact rule", () => {
    expect(occasionProblems(content({ title: "x".repeat(81) })).title).toBe("occasions.titleTooLong");
    expect(occasionProblems(content({ titleAr: "اتصل 99887766" })).titleAr).toBe("occasions.contactDetails");
  });

  it("wants both days of one of NetLet's own, and lets a calendar occasion keep the calendar's", () => {
    expect(occasionProblems(content({ startsOn: null, endsOn: null }))).toEqual({ startsOn: "occasions.needDates" });
    expect(occasionProblems(content({ slug: "winter", startsOn: null, endsOn: null }))).toEqual({});
    expect(occasionProblems(content({ endsOn: null }))).toEqual({ endsOn: "occasions.needBothDates" });
    expect(occasionProblems(content({ startsOn: "" }))).toEqual({ startsOn: "occasions.needBothDates" });
  });

  it("refuses a day that is not one, and a run longer than a year", () => {
    expect(occasionProblems(content({ startsOn: "2026-02-30" })).startsOn).toBe("occasions.badDate");
    expect(occasionProblems(content({ endsOn: "soon" })).endsOn).toBe("occasions.badDate");
    expect(occasionProblems(content({ startsOn: "2026-01-01", endsOn: "2027-01-01" }))).toEqual({});
    expect(occasionProblems(content({ startsOn: "2026-01-01", endsOn: "2027-01-02" })).endsOn).toBe("occasions.tooLong");
    expect(occasionProblems(content({ startsOn: "2026-11-20", endsOn: "2026-11-20" }))).toEqual({});
  });

  it("takes one of NetLet's own uploads as the picture", () => {
    expect(occasionProblems(content({ imageUrl: "/media/abcdefghijklmnop.webp" }))).toEqual({});
  });
});

describe("where an occasion stands today", () => {
  it("is read from Kuwait's day, both days included", () => {
    expect(occasionSeason(content(), at("2026-11-19"))).toEqual({ state: "upcoming", days: 1 });
    expect(occasionSeason(content(), at("2026-11-20"))).toEqual({ state: "on", daysLeft: 10 });
    expect(occasionSeason(content(), at("2026-11-30"))).toEqual({ state: "on", daysLeft: 0 });
    expect(occasionSeason(content(), at("2026-12-02"))).toEqual({ state: "ended", days: 2 });
    /* Ten at night in London on the 19th is already the 20th in Kuwait. */
    expect(occasionSeason(content(), new Date("2026-11-19T22:00:00Z")).state).toBe("on");
  });

  it("is the calendar's when it has no days of its own", () => {
    const winter = content({ slug: "winter", startsOn: null, endsOn: null });
    expect(occasionSeason(winter, at("2026-11-12"))).toEqual({ state: "outOfSeason" });
    expect(occasionSeason(winter, at("2026-11-15"))).toEqual({ state: "on", daysLeft: null });
  });
});

describe("what the home page is told", () => {
  it("draws only what is published and running, in the order given", () => {
    const rows = [
      row({ slug: "a" }),
      row({ slug: "b", status: "draft" }),
      row({ slug: "c", startsOn: "2026-12-01", endsOn: "2026-12-05" }),
      row({ slug: "halloween", status: "hidden", startsOn: null, endsOn: null }),
      row({ slug: "winter", startsOn: null, endsOn: null }),
    ];
    expect(curatedOn(rows, at("2026-11-25")).map(one => one.slug)).toEqual(["a", "winter"]);
  });

  it("keeps the calendar from drawing an occasion NetLet took over or switched off, and never for a draft", () => {
    const rows = [
      row({ slug: "white-friday" }),
      row({ slug: "winter", status: "published" }),
      row({ slug: "halloween", status: "hidden" }),
      row({ slug: "ramadan", status: "draft" }),
    ];
    expect(replacedSlugs(rows)).toEqual(["winter", "halloween"]);
  });

  it("hides only what the calendar has", () => {
    expect(statusAllowed("halloween", "hidden")).toBe(true);
    expect(statusAllowed("white-friday", "hidden")).toBe(false);
    expect(statusAllowed("white-friday", "published")).toBe(true);
  });
});

describe("the products of one of NetLet's occasions", () => {
  const product = (id: string, tags: string[] = []) => ({ id, tags });
  const occasion = { slug: "white-friday", title: "White Friday", titleAr: "الجمعة البيضاء", imageUrl: null, includeTagged: true };

  it("counts a store's tag by its address or either name, folded", () => {
    const keys = curatedKeys(occasion);
    for (const tag of ["white-friday", "White Friday", "WHITEFRIDAY", "الجمعة البيضاء", "الجمعه البيضاء"]) {
      expect(curatedProducts(occasion, [], [product("1", [tag])]), tag).toHaveLength(1);
    }
    expect(keys.has("blackfriday")).toBe(false);
  });

  it("keeps the calendar's own words for an occasion taken over under another name", () => {
    const school = { slug: "back-to-school", title: "School season 2027", titleAr: "موسم المدارس", imageUrl: null, includeTagged: true };
    expect(curatedProducts(school, [], [product("1", ["Back to School"]), product("2", ["مدرسة"]), product("3", ["school season 2027"]), product("4", ["winter"])]).map(one => one.id)).toEqual(["1", "2", "3"]);
  });

  it("puts the chosen first in their order, then the tagged, each once", () => {
    const chosen = [product("9"), product("3", ["white friday"]), product("9")];
    const catalog = [product("1", ["white friday"]), product("3", ["white friday"]), product("2"), product("4", ["White-Friday"])];
    expect(curatedProducts(occasion, chosen, catalog).map(one => one.id)).toEqual(["9", "3", "1", "4"]);
    expect(curatedProducts({ ...occasion, includeTagged: false }, chosen, catalog).map(one => one.id)).toEqual(["9", "3"]);
  });

  it("is named in the page's language", () => {
    expect(occasionName(occasion, true)).toBe("الجمعة البيضاء");
    expect(occasionName(occasion, false)).toBe("White Friday");
    expect(occasionName({ title: "White Friday", titleAr: " " }, true)).toBe("White Friday");
  });
});
