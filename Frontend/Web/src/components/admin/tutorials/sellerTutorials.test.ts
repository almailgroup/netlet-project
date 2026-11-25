import { describe, expect, it } from "vitest";
import { DEPARTMENTS } from "@shared/commerce/departments";
import { addMessages, translate, type MessageKey } from "@shared/i18n/dictionary";
import { ar, en } from "@shared/i18n/everyMessage";
import { MAX_PHOTOS } from "@shared/inventory/productDraft";
import {
  MOTION_LIMIT_MS,
  PHOTO_LIMIT_SAID,
  SELLER_TUTORIALS,
  TUTORIAL_IDS,
  characters,
  msPerCharacter,
  progress,
  sceneEnd,
  statusAt,
  typedCount,
  wordsText,
  type TutorialPart,
  type Words,
} from "./sellerTutorials";

addMessages({ en, ar });

/** Every piece of text a part puts on screen. */
function wordsOf(part: TutorialPart): Words[] {
  switch (part.kind) {
    case "field":
    case "select":
      return [part.label, part.value];
    case "button":
      return [part.label];
    case "fix":
      return part.options.map(option => option.label);
    case "rows":
      return [...(part.head ?? []), ...part.rows.flatMap(row => row.cells)];
    case "bullets":
      return [part.title, ...part.items.map(item => item.text)];
    case "chips":
      return [part.label, ...part.items];
    case "status":
      return part.items.map(item => item.label);
    case "note":
      return [part.text];
    default:
      return [];
  }
}

const everyWords = SELLER_TUTORIALS.flatMap(tutorial => tutorial.scenes.flatMap(scene => [scene.caption, ...scene.parts.flatMap(wordsOf)]));

describe("the seller's tutorials", () => {
  it("are the ten the portal places, each a few short scenes", () => {
    expect(SELLER_TUTORIALS.map(tutorial => tutorial.id)).toEqual([...TUTORIAL_IDS]);
    for (const tutorial of SELLER_TUTORIALS) {
      expect(tutorial.scenes.length, tutorial.id).toBeGreaterThanOrEqual(1);
      expect(tutorial.scenes.length, tutorial.id).toBeLessThanOrEqual(4);
    }
  });

  it("say only words the dictionary has, in both languages, with every placeholder filled", () => {
    const keys = everyWords.flatMap(words => ("key" in words ? [words.key, ...Object.values(words.params ?? {}).flatMap(value => (typeof value === "object" ? [value.key] : []))] : []));
    for (const tutorial of SELLER_TUTORIALS) keys.push(tutorial.title);
    for (const key of keys) {
      expect(en[key as MessageKey], key).toBeTruthy();
      expect(ar[key as MessageKey], key).toBeTruthy();
    }
    for (const locale of ["en", "ar"] as const) {
      for (const words of everyWords) {
        const text = wordsText(words, (key, params) => translate(locale, key, params), slug => slug);
        expect(text, JSON.stringify(words)).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("name only departments NetLet has", () => {
    const slugs = new Set(DEPARTMENTS.map(department => department.slug));
    for (const words of everyWords) if ("dept" in words) expect(slugs.has(words.dept), words.dept).toBe(true);
  });

  it("say the photo limit the form holds", () => {
    expect(PHOTO_LIMIT_SAID).toBe(MAX_PHOTOS);
  });

  it("never move for more than five seconds, in either language (WCAG 2.2.2)", () => {
    for (const locale of ["en", "ar"] as const) {
      const name = (slug: string) => {
        const department = DEPARTMENTS.find(row => row.slug === slug)!;
        return locale === "ar" ? department.nameAr : department.name;
      };
      const length = (words: Words) => characters(wordsText(words, (key, params) => translate(locale, key, params), name));
      for (const tutorial of SELLER_TUTORIALS) {
        tutorial.scenes.forEach((scene, index) => {
          expect(sceneEnd(scene, length), `${locale} ${tutorial.id} ${index + 1}`).toBeLessThanOrEqual(MOTION_LIMIT_MS);
        });
      }
    }
  });
});

/* The clock's cases. `TutorialClockTests` in the app holds the same numbers. */
describe("the tutorials' clock", () => {
  it("types long text quickly and short text slowly, within its bounds", () => {
    expect(msPerCharacter(0)).toBe(60);
    expect(msPerCharacter(10)).toBe(60);
    expect(msPerCharacter(25)).toBe(60);
    expect(msPerCharacter(30)).toBe(50);
    expect(msPerCharacter(50)).toBe(30);
    expect(msPerCharacter(100)).toBe(18);
  });

  it("types a character at its start and the rest one step at a time", () => {
    expect(typedCount(16, 300, 0)).toBe(0);
    expect(typedCount(16, 300, 299)).toBe(0);
    expect(typedCount(16, 300, 300)).toBe(1);
    expect(typedCount(16, 300, 359)).toBe(1);
    expect(typedCount(16, 300, 360)).toBe(2);
    expect(typedCount(16, 300, 5000)).toBe(16);
    expect(typedCount(50, 0, 300)).toBe(11);
  });

  it("counts a settle from 0 to 1 and holds there", () => {
    expect(progress(1000, 900)).toBe(0);
    expect(progress(1000, 1000)).toBe(0);
    expect(progress(1000, 1200)).toBe(0.5);
    expect(progress(1000, 1400)).toBe(1);
    expect(progress(1000, 9000)).toBe(1);
    expect(progress(1000, 1250, 500)).toBe(0.5);
    expect(progress(1000, 999, 0)).toBe(0);
    expect(progress(1000, 1000, 0)).toBe(1);
  });

  it("shows the latest status that has arrived, the first before any has", () => {
    const items = [{ at: 0 }, { at: 1100 }, { at: 2600 }];
    expect(statusAt(items, 0)).toBe(0);
    expect(statusAt(items, 1099)).toBe(0);
    expect(statusAt(items, 1100)).toBe(1);
    expect(statusAt(items, 4000)).toBe(2);
    expect(statusAt([{ at: 1200 }], 0)).toBe(0);
  });

  it("ends a scene when its last part has settled", () => {
    const scene = {
      caption: { raw: "" },
      parts: [
        { kind: "field" as const, label: { raw: "" }, value: { raw: "abcdefghij" }, at: 300 },
        { kind: "button" as const, label: { raw: "" }, at: 1500, tone: "primary" as const },
      ],
    };
    const length = (words: Words) => ("raw" in words ? characters(words.raw) : 0);
    expect(sceneEnd(scene, length)).toBe(1900);
    expect(sceneEnd({ caption: { raw: "" }, parts: [{ kind: "photos", at: [900, 2100] }] }, length)).toBe(2500);
  });
});
