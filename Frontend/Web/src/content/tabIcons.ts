/**
 * The phone's tab bar icons — Home, Categories, Deals, Profile and Cart —
 * drawn once for the web and the app.
 *
 * **Bold icons and no words, on the owner's word**, after the picture they
 * sent of a shop's bar: "see if you can improve the icon design for the menu
 * at the bottom", then — the first redraw being too close to the old set to
 * read as a change — the picture's style chosen from two drawn for them, and
 * a Deals tab added in the picture's order. One 24 grid, one line weight
 * (`TAB_ICON_STROKE`, 2, heavier than before), round caps and joins, each
 * with an outline and a filled form: the current tab is filled, the rest
 * are outlines. A rounded house with its door; three squares and a sparkle
 * for the departments; a percent sign for the deals, and nothing else, on
 * the owner's word ("change the icon of deals to %. Percentage icon only") —
 * it was a price tag after a picture they sent, and a bag before that; a
 * person in a circle; the cart with its two wheels. The words stay each
 * tab's name for a screen reader.
 *
 * Every path is absolute M, L, H, V, C and Z alone, so the app draws them
 * from `tabIcons.json` with a parser of a dozen lines (`TabIcon.swift`); the
 * circles and rounded squares are written as cubic curves for that reason.
 * `mode` says whether a path is drawn as a line, filled, or both — a filled
 * shape is stroked at the same weight too, so it is exactly the size of its
 * outline and the icon does not shrink when chosen. A filled shape cannot
 * have a hole cut in it (one colour, nonzero fill), so the chosen forms keep
 * their inner lines — the person — as their own pieces.
 */

export const TAB_ICON_STROKE = 2;

/**
 * One path of an icon. `knockout` draws it clear rather than in the icon's
 * colour — a hole a one-colour fill could not otherwise show. No icon cuts
 * one now (the Deals tag's hole went with the tag); both clients still read it.
 */
export type TabIconPath = { d: string; mode: "stroke" | "fill" | "both"; knockout?: boolean };
export type TabIconName = "home" | "categories" | "deals" | "profile" | "cart";
export type TabIconDrawing = { outline: TabIconPath[]; filled: TabIconPath[] };

/* How far a cubic's handle reaches to draw a quarter circle. */
const K = 0.5523;
const n = (value: number) => String(Math.round(value * 1000) / 1000);

/** A circle as four cubic quarters, clockwise from the top. */
function circle(cx: number, cy: number, r: number): string {
  const k = r * K;
  return [
    `M${n(cx)} ${n(cy - r)}`,
    `C${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)}`,
    `C${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)}`,
    `C${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)}`,
    `C${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)}`,
    "Z",
  ].join(" ");
}

/** A square of side `s` with corners of radius `r`, from its top start corner. */
function roundSquare(x: number, y: number, s: number, r: number): string {
  const k = r * K;
  const right = x + s;
  const bottom = y + s;
  return [
    `M${n(x + r)} ${n(y)}`,
    `H${n(right - r)}`,
    `C${n(right - r + k)} ${n(y)} ${n(right)} ${n(y + r - k)} ${n(right)} ${n(y + r)}`,
    `V${n(bottom - r)}`,
    `C${n(right)} ${n(bottom - r + k)} ${n(right - r + k)} ${n(bottom)} ${n(right - r)} ${n(bottom)}`,
    `H${n(x + r)}`,
    `C${n(x + r - k)} ${n(bottom)} ${n(x)} ${n(bottom - r + k)} ${n(x)} ${n(bottom - r)}`,
    `V${n(y + r)}`,
    `C${n(x)} ${n(y + r - k)} ${n(x + r - k)} ${n(y)} ${n(x + r)} ${n(y)}`,
    "Z",
  ].join(" ");
}

/* A rounded house, its door a notch in the outline so the filled form keeps it. */
const HOUSE = "M3.6 10.4 L12 3.6 L20.4 10.4 V19.2 C20.4 20.2 19.6 21 18.6 21 H14.6 V16 C14.6 15.2 14 14.6 13.2 14.6 H10.8 C10 14.6 9.4 15.2 9.4 16 V21 H5.4 C4.4 21 3.6 20.2 3.6 19.2 Z";

/* Three squares and a four-pointed sparkle where the fourth would be. */
const SQUARES = [roundSquare(3.2, 3.2, 7.4, 2), roundSquare(13.4, 3.2, 7.4, 2), roundSquare(3.2, 13.4, 7.4, 2)];
const SPARKLE = "M17.2 12.6 C17.6 15 18.8 16.2 21.2 16.6 C18.8 17 17.6 18.2 17.2 20.6 C16.8 18.2 15.6 17 13.2 16.6 C15.6 16.2 16.8 15 17.2 12.6 Z";

/* A percent sign: two rings and the stroke between them, leaning as the
   glyph does, from the bottom start to the top end. Chosen, the rings fill. */
const PERCENT_RINGS = [circle(7.2, 7.2, 2.9), circle(16.8, 16.8, 2.9)];
const PERCENT_STROKE = "M5.2 18.8 L18.8 5.2";

/* A person in a circle. */
const RING = circle(12, 12, 9.2);
const HEAD = circle(12, 9.6, 3.3);
const SHOULDERS = "M5.9 18.6 C7.3 16.4 9.4 15.3 12 15.3 C14.6 15.3 16.7 16.4 18.1 18.6";
const SHOULDERS_FILLED = "M5.9 18.6 C7.3 16.4 9.4 15.3 12 15.3 C14.6 15.3 16.7 16.4 18.1 18.6 C16.5 20.1 14.4 21.2 12 21.2 C9.6 21.2 7.5 20.1 5.9 18.6 Z";

/* The cart's handle, its basket, and its two wheels. */
const HANDLE = "M2.4 3.4 H4.4 C4.9 3.4 5.3 3.7 5.4 4.2 L6 7";
const BASKET = "M6 7 H20.2 C20.8 7 21.2 7.6 21 8.2 L19.4 14.6 C19.2 15.3 18.6 15.8 17.9 15.8 H8.9 C8.2 15.8 7.6 15.3 7.4 14.6 Z";
const WHEELS = [circle(9.4, 19.6, 1.6), circle(17.2, 19.6, 1.6)];

export const TAB_ICONS: Record<TabIconName, TabIconDrawing> = {
  home: {
    outline: [{ d: HOUSE, mode: "stroke" }],
    filled: [{ d: HOUSE, mode: "both" }],
  },
  categories: {
    outline: [...SQUARES.map(d => ({ d, mode: "stroke" as const })), { d: SPARKLE, mode: "both" }],
    filled: [...SQUARES.map(d => ({ d, mode: "both" as const })), { d: SPARKLE, mode: "both" }],
  },
  deals: {
    outline: [
      ...PERCENT_RINGS.map(d => ({ d, mode: "stroke" as const })),
      { d: PERCENT_STROKE, mode: "stroke" },
    ],
    filled: [
      ...PERCENT_RINGS.map(d => ({ d, mode: "both" as const })),
      { d: PERCENT_STROKE, mode: "stroke" },
    ],
  },
  profile: {
    outline: [
      { d: RING, mode: "stroke" },
      { d: HEAD, mode: "stroke" },
      { d: SHOULDERS, mode: "stroke" },
    ],
    filled: [
      { d: RING, mode: "stroke" },
      { d: HEAD, mode: "both" },
      { d: SHOULDERS_FILLED, mode: "both" },
    ],
  },
  cart: {
    outline: [
      { d: HANDLE, mode: "stroke" },
      { d: BASKET, mode: "stroke" },
      ...WHEELS.map(d => ({ d, mode: "fill" as const })),
    ],
    filled: [
      { d: HANDLE, mode: "stroke" },
      { d: BASKET, mode: "both" },
      ...WHEELS.map(d => ({ d, mode: "fill" as const })),
    ],
  },
};

/** Only these commands, so the app's parser has nothing else to read. */
export const TAB_ICON_COMMANDS = /^[MLHVCZ0-9.\s-]+$/;
