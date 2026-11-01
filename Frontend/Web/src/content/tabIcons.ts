/**
 * The phone's tab bar icons — Home, Profile, Cart and Categories — drawn once
 * for the web and the app, on the owner's word ("see if you can improve the
 * icon design for the menu at the bottom").
 *
 * They were four from four places: a home from a hand-drawn path, a person
 * and a cart from lucide at its own weight, a grid of our own, and in the app
 * SF Symbols, so the bar's two weights and two kinds of corner showed side by
 * side. Now one set, on one 24 grid, one line weight (`TAB_ICON_STROKE`),
 * round caps and joins throughout, each with an outline and a filled form:
 * the current tab is filled, the rest are outlines. **The house's roof is
 * NetLet's own** — the two bars meeting at a point that are the logo's roof —
 * with the door cut out of the filled form.
 *
 * Every path is absolute M, L, H, V, C and Z alone, so the app draws them
 * from `tabIcons.json` with a parser of a dozen lines (`TabIcon.swift`); the
 * circles and rounded squares are written as cubic curves for that reason.
 * `mode` says whether a path is drawn as a line, filled, or both — a filled
 * shape is stroked at the same weight too, so it is exactly the size of its
 * outline and the icon does not shrink when chosen.
 */

export const TAB_ICON_STROKE = 1.8;

export type TabIconPath = { d: string; mode: "stroke" | "fill" | "both" };
export type TabIconName = "home" | "profile" | "cart" | "categories";
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

/* The roof: two bars meeting at a point, the logo's own. */
const ROOF = "M2.75 11.5 L12 3.75 L21.25 11.5";

/* The grid's three squares and its circle. */
const SQUARES = [roundSquare(3.75, 3.75, 6.75, 1.75), roundSquare(13.5, 3.75, 6.75, 1.75), roundSquare(3.75, 13.5, 6.75, 1.75)];
const DOT = circle(16.875, 16.875, 3.375);

/* The cart's handle, its basket, and its two wheels. */
const HANDLE = "M2.75 3.75 H4.6 C5.05 3.75 5.45 4.05 5.55 4.5 L6.11 7.25";
const BASKET = "M6.11 7.25 H19.35 C19.85 7.25 20.25 7.7 20.15 8.2 L18.8 14.6 C18.65 15.25 18.05 15.75 17.35 15.75 H9.05 C8.35 15.75 7.75 15.3 7.6 14.6 Z";
const WHEELS = [circle(9.5, 19.75, 1.4), circle(17, 19.75, 1.4)];

export const TAB_ICONS: Record<TabIconName, TabIconDrawing> = {
  home: {
    outline: [
      { d: ROOF, mode: "stroke" },
      { d: "M5.5 9.4 V18.75 C5.5 19.85 6.4 20.75 7.5 20.75 H16.5 C17.6 20.75 18.5 19.85 18.5 18.75 V9.4", mode: "stroke" },
      { d: "M10 20.75 V16.25 C10 15.15 10.9 14.25 12 14.25 C13.1 14.25 14 15.15 14 16.25 V20.75", mode: "stroke" },
    ],
    filled: [
      { d: ROOF, mode: "stroke" },
      /* The walls under the roof, the door cut out of them. */
      /* The door is wider than the outline's, since the line round it takes
         its own width out of the opening. */
      { d: "M5.5 9.6 L12 4.25 L18.5 9.6 V18.75 C18.5 19.85 17.6 20.75 16.5 20.75 H14.6 V16.4 C14.6 14.96 13.44 13.8 12 13.8 C10.56 13.8 9.4 14.96 9.4 16.4 V20.75 H7.5 C6.4 20.75 5.5 19.85 5.5 18.75 Z", mode: "both" },
    ],
  },
  profile: {
    outline: [
      { d: circle(12, 8, 3.75), mode: "stroke" },
      { d: "M4.75 20.25 C4.75 16.6 8 14 12 14 C16 14 19.25 16.6 19.25 20.25", mode: "stroke" },
    ],
    filled: [
      { d: circle(12, 8, 3.75), mode: "both" },
      { d: "M4.75 20.25 C4.75 16.6 8 14 12 14 C16 14 19.25 16.6 19.25 20.25 Z", mode: "both" },
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
  categories: {
    outline: [...SQUARES, DOT].map(d => ({ d, mode: "stroke" as const })),
    filled: [...SQUARES, DOT].map(d => ({ d, mode: "both" as const })),
  },
};

/** Only these commands, so the app's parser has nothing else to read. */
export const TAB_ICON_COMMANDS = /^[MLHVCZ0-9.\s-]+$/;
