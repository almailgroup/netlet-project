/**
 * The seller's mini tutorials for adding products, on the owner's word ("Add
 * video/mini tutorials for adding products"): animated, drawn in the portal
 * rather than filmed, beside each step of Add a product, the editor's variants,
 * the AI draft and the spreadsheet import.
 *
 * A tutorial is a few short scenes, and a scene is the real form's parts acting
 * themselves out on a clock: a name typed into "Product name", a department
 * chosen, photos dropping in, a button pressed. Every label is the form's own
 * dictionary key, so renaming a box renames it in its tutorial too, and every
 * sentence is a key in both languages.
 *
 * **This file is data and one small clock, and draws nothing.** The website's
 * player (`TutorialPlayer.tsx`) and the app's (`SellerTutorials.swift`, from
 * `sellerTutorials.json`, which `pnpm ios:resources` writes from here) both read
 * it, so the two cannot show different steps. It imports nothing at runtime,
 * which is what lets the export script load it outside the web build.
 *
 * **No scene moves for more than five seconds** (`MOTION_LIMIT_MS`, WCAG
 * 2.2.2): each plays once and holds its last frame, and the seller moves on
 * with Next. `sellerTutorials.test.ts` holds that in both languages, since how
 * long a box takes to type depends on what it says.
 */
import type { MessageKey } from "@shared/i18n/dictionary";

/** A piece of text on screen: a dictionary key, a department by its slug, or a literal (a price, an SKU). */
export type Words =
  | { key: MessageKey; params?: Record<string, string | number | { key: MessageKey }> }
  | { dept: string }
  | { raw: string };

/** The few pictures a mock button carries. */
export type TutorialIcon = "sparkles" | "upload" | "plus" | "download" | "check" | "send";

/** How a mock photo looks: as taken (tilted, dim, off-centre), fixed, or made square on white. */
export type PhotoLook = "raw" | "fixed" | "square";

/** One part of a scene. Every `at` is milliseconds from the scene's start. */
export type TutorialPart =
  /** A box with its label, typed into from `at` (or filled at once with `fill`). */
  | { kind: "field"; label: Words; value: Words; at: number; lines?: number; dir?: "ltr" | "rtl"; fill?: boolean }
  /** A dropdown that is pressed at `at` and shows its value from then. */
  | { kind: "select"; label: Words; value: Words; at: number }
  /** A button pressed at `at`. */
  | { kind: "button"; label: Words; at: number; tone: "primary" | "secondary"; icon?: TutorialIcon }
  /** Photos dropping into a gallery, one per time; the first wears "Cover". */
  | { kind: "photos"; at: number[] }
  /** Versions of one photo side by side; the choice moves to `pick` at `at`. */
  | { kind: "fix"; options: { label: Words; look: PhotoLook }[]; pick: number; at: number }
  /** Rows appearing: a draft's fields (`list`), a variants table (`table`) or a spreadsheet (`sheet`). */
  | { kind: "rows"; style: "list" | "table" | "sheet"; head?: Words[]; rows: { cells: Words[]; at: number }[] }
  /** A list as the product page shows it, its points appearing in turn. */
  | { kind: "bullets"; title: Words; items: { text: Words; at: number }[] }
  /** Choices as buttons, the chosen one moving to `pick` at `at`. */
  | { kind: "chips"; label: Words; items: Words[]; pick: number; at: number }
  /** A product's state changing: Draft, then In review, then Live. */
  | { kind: "status"; items: { label: Words; at: number; tone: "muted" | "waiting" | "live" }[] }
  /** The product's card as shoppers see it, appearing at `at`. */
  | { kind: "card"; at: number; was?: boolean }
  /** The product as a search engine shows it, appearing at `at`. */
  | { kind: "search"; at: number }
  /** A line that appears at `at`: what happened, or what to know. */
  | { kind: "note"; text: Words; at: number; tone: "ok" | "info" };

export interface TutorialScene {
  caption: Words;
  parts: TutorialPart[];
}

export const TUTORIAL_IDS = ["generate", "basics", "photos", "price", "extras", "description", "search", "publish", "variants", "import"] as const;
export type TutorialId = (typeof TUTORIAL_IDS)[number];

export interface SellerTutorial {
  id: TutorialId;
  title: MessageKey;
  scenes: TutorialScene[];
}

const k = (key: MessageKey, params?: Record<string, string | number | { key: MessageKey }>): Words => (params ? { key, params } : { key });
const raw = (text: string): Words => ({ raw: text });

/* The example product every tutorial follows, so the steps read as one listing. */
const NAME = k("howTo.sample.title");
const ARABIC_NAME = raw("مصباح طاولة نحاسي");
const DEPARTMENT: Words = { dept: "home-and-kitchen" };
const PRICE = raw("12.500");
const WAS = raw("15.000");

/** The photos' limit, said in the first photo scene (the test holds it to `MAX_PHOTOS`). */
export const PHOTO_LIMIT_SAID = 12;

export const SELLER_TUTORIALS: SellerTutorial[] = [
  {
    id: "generate",
    title: "howTo.generate.title",
    scenes: [
      {
        caption: k("howTo.generate.notes"),
        parts: [
          { kind: "field", label: k("admin.genNotes"), value: k("howTo.sample.notes"), at: 300, lines: 2 },
          { kind: "photos", at: [2600] },
        ],
      },
      {
        caption: k("howTo.generate.press", { button: { key: "admin.genGenerate" } }),
        parts: [
          { kind: "button", label: k("admin.genGenerate"), at: 400, tone: "primary", icon: "sparkles" },
          {
            kind: "rows",
            style: "list",
            rows: [
              { cells: [k("admin.newTitle"), NAME], at: 1500 },
              { cells: [k("admin.fieldCategory"), DEPARTMENT], at: 1900 },
              { cells: [k("admin.fieldDescription"), k("howTo.sample.snippet")], at: 2300 },
            ],
          },
        ],
      },
      {
        caption: k("howTo.generate.use", { button: { key: "admin.genUse" } }),
        parts: [
          { kind: "button", label: k("admin.genUse"), at: 400, tone: "secondary", icon: "check" },
          { kind: "field", label: k("admin.newTitle"), value: NAME, at: 1100, fill: true },
          { kind: "select", label: k("admin.fieldCategory"), value: DEPARTMENT, at: 1400 },
        ],
      },
    ],
  },
  {
    id: "basics",
    title: "howTo.basics.title",
    scenes: [
      {
        caption: k("howTo.basics.name"),
        parts: [{ kind: "field", label: k("admin.newTitle"), value: NAME, at: 300 }],
      },
      {
        caption: k("howTo.basics.arabic"),
        parts: [
          { kind: "field", label: k("admin.newTitleAr"), value: ARABIC_NAME, at: 1200, fill: true, dir: "rtl" },
          { kind: "button", label: k("admin.arabicDraft"), at: 400, tone: "secondary", icon: "sparkles" },
        ],
      },
      {
        caption: k("howTo.basics.department"),
        parts: [{ kind: "select", label: k("admin.fieldCategory"), value: DEPARTMENT, at: 600 }],
      },
    ],
  },
  {
    id: "photos",
    title: "howTo.photos.title",
    scenes: [
      {
        caption: k("howTo.photos.add", { max: PHOTO_LIMIT_SAID }),
        parts: [
          { kind: "button", label: k("media.upload"), at: 300, tone: "secondary", icon: "upload" },
          { kind: "photos", at: [900, 1500, 2100] },
        ],
      },
      {
        caption: k("howTo.photos.fixed"),
        parts: [
          {
            kind: "fix",
            options: [{ label: k("media.useTaken"), look: "raw" }, { label: k("media.useFixed"), look: "fixed" }],
            pick: 1,
            at: 1600,
          },
          { kind: "note", text: k("media.fixedThese", { fixes: { key: "howTo.photos.fixList" } }), at: 2300, tone: "ok" },
        ],
      },
      {
        caption: k("howTo.photos.square"),
        parts: [
          {
            kind: "fix",
            options: [
              { label: k("media.useTaken"), look: "raw" },
              { label: k("media.useFixed"), look: "fixed" },
              { label: k("media.useAi"), look: "square" },
            ],
            pick: 2,
            at: 1200,
          },
          { kind: "button", label: k("media.add"), at: 2500, tone: "primary", icon: "check" },
        ],
      },
    ],
  },
  {
    id: "price",
    title: "howTo.price.title",
    scenes: [
      {
        caption: k("howTo.price.price"),
        parts: [{ kind: "field", label: k("admin.newPrice"), value: PRICE, at: 300, dir: "ltr" }],
      },
      {
        caption: k("howTo.price.was"),
        parts: [
          { kind: "field", label: k("admin.newWas"), value: WAS, at: 300, dir: "ltr" },
          { kind: "card", at: 1500, was: true },
        ],
      },
      {
        caption: k("howTo.price.stock"),
        parts: [
          { kind: "field", label: k("admin.newStock"), value: raw("8"), at: 300, dir: "ltr" },
          { kind: "field", label: k("admin.newSku"), value: raw("LAMP-45"), at: 1000, dir: "ltr" },
        ],
      },
    ],
  },
  {
    id: "extras",
    title: "howTo.extras.title",
    scenes: [
      {
        caption: k("howTo.extras.install"),
        parts: [
          { kind: "button", label: k("admin.installAdd"), at: 300, tone: "secondary", icon: "plus" },
          { kind: "field", label: k("admin.addonPrice"), value: raw("3.000"), at: 1100, dir: "ltr" },
        ],
      },
      {
        caption: k("howTo.extras.warranty"),
        parts: [
          { kind: "button", label: k("admin.warrantyAdd"), at: 300, tone: "secondary", icon: "plus" },
          { kind: "select", label: k("admin.warrantyLength"), value: k("addon.lengthYears", { count: 2 }), at: 1100 },
          { kind: "field", label: k("admin.addonPrice"), value: raw("5.000"), at: 1800, dir: "ltr" },
        ],
      },
    ],
  },
  {
    id: "description",
    title: "howTo.description.title",
    scenes: [
      {
        caption: k("howTo.description.write"),
        parts: [
          { kind: "field", label: k("admin.fieldDescription"), value: k("howTo.sample.description"), at: 300, lines: 3 },
          {
            kind: "bullets",
            title: k("howTo.onThePage"),
            items: [{ text: k("howTo.sample.bulb"), at: 3300 }, { text: k("howTo.sample.shade"), at: 3600 }],
          },
        ],
      },
      {
        caption: k("howTo.description.tags"),
        parts: [{ kind: "field", label: k("admin.fieldTags"), value: k("howTo.sample.tags"), at: 300 }],
      },
    ],
  },
  {
    id: "search",
    title: "howTo.search.title",
    scenes: [
      { caption: k("howTo.search.engine"), parts: [{ kind: "search", at: 300 }] },
      { caption: k("howTo.search.card"), parts: [{ kind: "card", at: 300 }] },
    ],
  },
  {
    id: "publish",
    title: "howTo.publish.title",
    scenes: [
      {
        caption: k("howTo.publish.now", { button: { key: "admin.newCreatePublish" } }),
        parts: [
          { kind: "button", label: k("admin.newCreatePublish"), at: 400, tone: "primary", icon: "send" },
          { kind: "status", items: [{ label: k("status.draft"), at: 0, tone: "muted" }, { label: k("status.published"), at: 1100, tone: "live" }] },
        ],
      },
      {
        caption: k("howTo.publish.review"),
        parts: [
          { kind: "button", label: k("admin.newCreateReview"), at: 400, tone: "primary", icon: "send" },
          {
            kind: "status",
            items: [
              { label: k("status.draft"), at: 0, tone: "muted" },
              { label: k("status.pending_review"), at: 1100, tone: "waiting" },
              { label: k("status.published"), at: 2600, tone: "live" },
            ],
          },
        ],
      },
      {
        caption: k("howTo.publish.draft", { button: { key: "admin.newCreateDraft" } }),
        parts: [
          { kind: "button", label: k("admin.newCreateDraft"), at: 400, tone: "secondary" },
          { kind: "status", items: [{ label: k("status.draft"), at: 0, tone: "muted" }] },
          { kind: "note", text: k("howTo.publish.later"), at: 1400, tone: "info" },
        ],
      },
    ],
  },
  {
    id: "variants",
    title: "howTo.variants.title",
    scenes: [
      {
        caption: k("howTo.variants.each"),
        parts: [
          { kind: "button", label: k("admin.addVariant"), at: 300, tone: "secondary", icon: "plus" },
          {
            kind: "rows",
            style: "table",
            head: [k("admin.variantTitle"), k("admin.variantPrice"), k("admin.variantStock")],
            rows: [
              { cells: [raw("M"), PRICE, raw("8")], at: 1000 },
              { cells: [raw("L"), raw("13.500"), raw("5")], at: 1700 },
            ],
          },
        ],
      },
      {
        caption: k("howTo.variants.options"),
        parts: [
          { kind: "field", label: k("admin.variantOptions"), value: k("howTo.sample.optionBlack"), at: 300 },
          { kind: "chips", label: k("howTo.sample.colour"), items: [k("howTo.sample.black"), k("howTo.sample.brass")], pick: 0, at: 2300 },
        ],
      },
    ],
  },
  {
    id: "import",
    title: "howTo.import.title",
    scenes: [
      {
        caption: k("howTo.import.template"),
        parts: [
          { kind: "button", label: k("admin.importTemplate"), at: 300, tone: "secondary", icon: "download" },
          {
            kind: "rows",
            style: "sheet",
            head: [k("admin.newTitle"), k("admin.newPrice"), k("admin.newStock")],
            rows: [
              { cells: [NAME, PRICE, raw("8")], at: 1000 },
              { cells: [k("howTo.sample.vase"), raw("6.750"), raw("12")], at: 1500 },
              { cells: [k("howTo.sample.cushion"), raw("4.250"), raw("20")], at: 2000 },
            ],
          },
        ],
      },
      {
        caption: k("howTo.import.check"),
        parts: [
          { kind: "button", label: k("admin.importChoose"), at: 300, tone: "primary", icon: "upload" },
          {
            kind: "rows",
            style: "list",
            rows: [
              { cells: [NAME, DEPARTMENT], at: 1100 },
              { cells: [k("howTo.sample.vase"), DEPARTMENT], at: 1500 },
              { cells: [k("howTo.sample.cushion"), DEPARTMENT], at: 1900 },
            ],
          },
        ],
      },
      {
        caption: k("howTo.import.create"),
        parts: [
          { kind: "button", label: k("admin.importCreate", { count: 3 }), at: 400, tone: "primary", icon: "upload" },
          { kind: "status", items: [{ label: k("status.draft"), at: 1200, tone: "muted" }] },
        ],
      },
    ],
  },
];

export const tutorialFor = (id: TutorialId): SellerTutorial => SELLER_TUTORIALS.find(tutorial => tutorial.id === id)!;

/** What a piece of text reads in the language shown: a key said, a department named, a literal as it is. */
export function wordsText(
  words: Words,
  say: (key: MessageKey, params?: Record<string, string | number>) => string,
  department: (slug: string) => string,
): string {
  if ("raw" in words) return words.raw;
  if ("dept" in words) return department(words.dept);
  if (!words.params) return say(words.key);
  const params = Object.fromEntries(Object.entries(words.params).map(([name, value]) => [name, typeof value === "object" ? say(value.key) : value]));
  return say(words.key, params);
}

/** Characters as a person sees them, so Arabic and an emoji count once each. */
export const characters = (text: string): number => Array.from(text).length;

/* ---------------------------------------------------------------------------
 * The clock. Pure and small, so the app's twin (`TutorialClock` in Swift) is
 * the same arithmetic, tested on these cases.
 * ------------------------------------------------------------------------- */

/** No scene moves for longer than this (WCAG 2.2.2's five seconds, with room). */
export const MOTION_LIMIT_MS = 4600;
/** How long a press, an appearance or a filled box takes to settle. */
export const SETTLE_MS = 400;

/** Milliseconds per character typed: quick for long text, never slower than 60 or faster than 18. */
export function msPerCharacter(length: number): number {
  return Math.min(60, Math.max(18, Math.round(1500 / Math.max(1, length))));
}

/** How many characters of `length` are typed at `t`, typing from `at`. */
export function typedCount(length: number, at: number, t: number): number {
  if (t < at) return 0;
  return Math.min(length, Math.floor((t - at) / msPerCharacter(length)) + 1);
}

/** How far through a `span` that starts at `at` the clock is, from 0 to 1. */
export function progress(at: number, t: number, span = SETTLE_MS): number {
  if (span <= 0) return t >= at ? 1 : 0;
  return Math.min(1, Math.max(0, (t - at) / span));
}

/** When a part has finished moving, given how long its typed text is in the language shown. */
export function partEnd(part: TutorialPart, typedLength: (words: Words) => number): number {
  switch (part.kind) {
    case "field":
      return part.fill ? part.at + SETTLE_MS : part.at + typedLength(part.value) * msPerCharacter(typedLength(part.value));
    case "photos":
      return Math.max(0, ...part.at) + SETTLE_MS;
    case "rows":
      return Math.max(0, ...part.rows.map(row => row.at)) + SETTLE_MS;
    case "bullets":
      return Math.max(0, ...part.items.map(item => item.at)) + SETTLE_MS;
    case "status":
      return Math.max(0, ...part.items.map(item => item.at)) + SETTLE_MS;
    default:
      return part.at + SETTLE_MS;
  }
}

/** When the whole scene has stopped moving: it then holds its last frame. */
export function sceneEnd(scene: TutorialScene, typedLength: (words: Words) => number): number {
  return Math.max(0, ...scene.parts.map(part => partEnd(part, typedLength)));
}

/** The status shown at `t`: the latest that has arrived, or the first before any has. */
export function statusAt(items: { at: number }[], t: number): number {
  let shown = 0;
  items.forEach((item, index) => { if (t >= item.at) shown = index; });
  return shown;
}
