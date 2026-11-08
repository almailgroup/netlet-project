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
 * for the departments; a person in a circle; the cart with its two wheels.
 * The words stay each tab's name for a screen reader.
 *
 * **Deals is a red shopping bag, a little larger than the rest, on the
 * owner's word** — after a picture of a bag seen from three quarters, "an
 * outline of a shopping bag like this, in this perspective, with a
 * percentage icon in it, and its colour being red", then "slightly bigger
 * than the other icons". It is NetLet's own drawing, not the picture's (that
 * bag is somebody's mark): a front face and a narrower side going back to
 * the right, two handles with the back one passing behind, and a percent
 * sign on the front — dots and a stroke, rings being blobs at this size.
 * Chosen, the front is filled in `color.ink`, the side in `color.deep` so the
 * turn of the bag still shows, and the percent is cut clear (`knockout`). It
 * keeps its red whether chosen or not: the colour is the point, and the
 * filled form says which tab is current. Before this it was a percent sign
 * alone, a price tag before that, and a bag before that.
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

/** How large an icon is drawn, in CSS pixels on the web and points in the app. */
export const TAB_ICON_SIZE = 28;

/**
 * One path of an icon. `knockout` draws it clear rather than in the icon's
 * colour — a hole a one-colour fill could not otherwise show (the percent on
 * the chosen Deals bag). `deep` draws it in the icon's darker colour, for an
 * icon that has colours of its own.
 */
export type TabIconPath = { d: string; mode: "stroke" | "fill" | "both"; knockout?: boolean; deep?: boolean };
export type TabIconName = "home" | "categories" | "deals" | "profile" | "cart";
export type TabIconDrawing = {
  outline: TabIconPath[];
  filled: TabIconPath[];
  /** Drawn larger than `TAB_ICON_SIZE`. */
  size?: number;
  /**
   * The icon's own colours, kept whether its tab is chosen or not; without
   * them it takes the bar's ink (navy chosen, near-black otherwise, and the
   * system's tint in the app).
   */
  color?: { ink: string; deep: string };
};

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

/* A shopping bag from three quarters: its front, its side going back to the
   right (narrower at the top, as the bag widens to its foot), the front
   handle, and the back one starting behind it. A percent sign on the front:
   two dots and the stroke between them, from the bottom start to the top end. */
const BAG_FRONT = "M3.6 8.6 L14.4 7.4 L14.8 21.6 L2.4 20.4 Z";
const BAG_SIDE = "M14.4 7.4 L17.4 8.6 L21.6 19.6 L14.8 21.6 Z";
const BAG_HANDLE = "M5.4 8.4 C5.2 5 6.4 3 7.8 3 C9.3 3 10.4 4.9 10.2 7.9";
const BAG_HANDLE_BACK = "M10.2 4.7 C10.7 2.9 11.5 2 12.5 2 C13.8 2 14.6 4 14.4 7.4";
const BAG_PERCENT_DOTS = [circle(6.5, 12.6, 1.3), circle(10.9, 17.3, 1.3)];
const BAG_PERCENT_STROKE = "M6 18.5 L11.4 11.3";

/** Deals' red: 5.1:1 on white and 4.4:1 on the chosen tab's grey pill. */
const DEALS_RED = { ink: "#d6201f", deep: "#a3181b" };

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
      { d: BAG_SIDE, mode: "stroke" },
      { d: BAG_FRONT, mode: "stroke" },
      { d: BAG_HANDLE_BACK, mode: "stroke" },
      { d: BAG_HANDLE, mode: "stroke" },
      ...BAG_PERCENT_DOTS.map(d => ({ d, mode: "fill" as const })),
      { d: BAG_PERCENT_STROKE, mode: "stroke" },
    ],
    filled: [
      { d: BAG_SIDE, mode: "both", deep: true },
      { d: BAG_FRONT, mode: "both" },
      { d: BAG_HANDLE_BACK, mode: "stroke" },
      { d: BAG_HANDLE, mode: "stroke" },
      ...BAG_PERCENT_DOTS.map(d => ({ d, mode: "fill" as const, knockout: true })),
      { d: BAG_PERCENT_STROKE, mode: "stroke", knockout: true },
    ],
    size: 32,
    color: DEALS_RED,
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
