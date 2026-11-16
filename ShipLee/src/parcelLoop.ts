/**
 * The road the home band's parcels go round, worked out from where the words
 * are. Pure, so the one rule that matters can be tested: a parcel never
 * crosses the headline, the lead or the tracking card.
 *
 * The road is a loop round all of that: a lane in the strip above the
 * headline, a lane in the strip under the card, and a leg down each side —
 * in the margin when there is room for a parcel there, past the band's edge
 * when there is not, so on a phone the parcels leave at one end of a lane and
 * come back along the other. Parcels go along the bottom lane in the reading
 * direction (left to right in English, right to left in Arabic) and back
 * along the top. The lanes undulate a little, with no bend where they meet a
 * corner, so the road reads as a road and not a conveyor belt.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LoopInput {
  /** The band's size, in its own pixels. */
  width: number;
  height: number;
  /** Everything in the band with words on it (and the parcel drawing), in the band's pixels. */
  content: Box;
  /** A parcel's size in pixels: its box is this wide and this tall. */
  parcel: number;
  /** Arabic: the bottom lane runs right to left. */
  rtl: boolean;
}

export interface LoopPoint {
  x: number;
  y: number;
  /** How far round the loop this point is, from 0 to 1. */
  at: number;
}

export interface Loop {
  /** The road, as an SVG path in the band's pixels. */
  d: string;
  /** The loop's length in pixels. */
  length: number;
  /** Points round the loop at even distances (closed: the last is the first again, at 1). */
  points: LoopPoint[];
}

/** The space kept between a parcel and the words, in pixels. */
export const GAP = 6;
/** A parcel sits on the road: this much of it is above the line, the rest below. */
export const ABOVE = 0.75;
const MAX_RADIUS = 72;
const LANE_STEP = 8;
const ARC_STEP = 4;

/** Where a parcel drawn at (x, y) on the road covers. */
export function parcelBox(x: number, y: number, size: number): Box {
  return { left: x - size / 2, top: y - size * ABOVE, right: x + size / 2, bottom: y + size * (1 - ABOVE) };
}

/** Whether a parcel at (x, y) stays clear of the words, by `GAP` at least. */
export function clearOf(content: Box, x: number, y: number, size: number): boolean {
  const box = parcelBox(x, y, size);
  return box.right <= content.left - GAP || box.left >= content.right + GAP || box.bottom <= content.top - GAP || box.top >= content.bottom + GAP;
}

interface Piece {
  /** Points along the piece, first to last; the first repeats the previous piece's last. */
  points: [number, number][];
}

/** A lane from x0 to x1 at y, undulating by `amp` with no slope at either end. */
function lane(x0: number, x1: number, y: number, amp: number): Piece {
  const span = Math.abs(x1 - x0);
  const steps = Math.max(1, Math.ceil(span / LANE_STEP));
  /* Whole waves of about 520px, at least one. */
  const waves = Math.max(1, Math.round(span / 520));
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    /* sin(2πkt)·sin(πt): flat where it meets each corner, so the road has no kink there. */
    const offset = amp ? amp * Math.sin(2 * Math.PI * waves * t) * Math.sin(Math.PI * t) : 0;
    points.push([x0 + (x1 - x0) * t, y + offset]);
  }
  return { points };
}

/** A quarter circle about (cx, cy) from angle a0 to a1 (radians, screen axes: y grows down). */
function arc(cx: number, cy: number, r: number, a0: number, a1: number): Piece {
  const steps = Math.max(2, Math.ceil((r * Math.abs(a1 - a0)) / ARC_STEP));
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps);
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return { points };
}

function line(x0: number, y0: number, x1: number, y1: number): Piece {
  return { points: [[x0, y0], [x1, y1]] };
}

const HALF_PI = Math.PI / 2;

/** The loop for a band laid out as `input` says, or null when no road fits clear of the words. */
export function parcelLoop(input: LoopInput): Loop | null {
  const { width: W, height: H, content: c, parcel: s } = input;
  if (W <= 0 || H <= 0 || s <= 0) return null;

  /* A strip holds a lane when a parcel fits in it with the gap on both sides. */
  const fits = (room: number) => room >= s + 2 * GAP;
  const topRoom = c.top;
  const bottomRoom = H - c.bottom;
  const leftRoom = c.left;
  const rightRoom = W - c.right;
  /* A loop with no part in sight would move parcels nobody can see. */
  if (![topRoom, bottomRoom, leftRoom, rightRoom].some(fits)) return null;
  /* The parcel's box centred in its strip: the road runs a quarter of a parcel below the middle. */
  const T = fits(topRoom) ? topRoom / 2 + s * (ABOVE - 0.5) : -2 * s;
  const B = fits(bottomRoom) ? c.bottom + bottomRoom / 2 + s * (ABOVE - 0.5) : H + 2 * s;
  const L = fits(leftRoom) ? leftRoom / 2 : -1.5 * s;
  const R = fits(rightRoom) ? W - rightRoom / 2 : W + 1.5 * s;
  /* How far a lane may wander and keep its parcels inside their strip. */
  const wander = (room: number) => (fits(room) ? Math.max(0, Math.min(8, room * 0.1, (room - s) / 2 - GAP)) : 0);
  const topAmp = wander(topRoom);
  const bottomAmp = wander(bottomRoom);

  const build = (r: number, ampScale: number): [number, number][] => {
    /* Left to right along the bottom, up the right, back along the top, down the left. */
    const pieces: Piece[] = [
      lane(L + r, R - r, B, bottomAmp * ampScale),
      arc(R - r, B - r, r, HALF_PI, 0),
      line(R, B - r, R, T + r),
      arc(R - r, T + r, r, 0, -HALF_PI),
      lane(R - r, L + r, T, topAmp * ampScale),
      arc(L + r, T + r, r, -HALF_PI, -Math.PI),
      line(L, T + r, L, B - r),
      arc(L + r, B - r, r, Math.PI, HALF_PI),
    ];
    const points: [number, number][] = [];
    for (const piece of pieces) {
      for (const point of piece.points) {
        const last = points[points.length - 1];
        if (last && Math.abs(last[0] - point[0]) < 0.01 && Math.abs(last[1] - point[1]) < 0.01) continue;
        points.push(point);
      }
    }
    /* Closed: end exactly where it began. */
    points[points.length - 1] = [points[0]![0], points[0]![1]];
    /* Arabic goes round the other way, so the bottom lane runs right to left. */
    return input.rtl ? points.reverse() : points;
  };

  const clear = (points: [number, number][]) => points.every(([x, y]) => clearOf(c, x, y, s));

  /* The widest corners that keep clear, then the same with the lanes held straight. */
  const largest = Math.min(MAX_RADIUS, (B - T) / 2, (R - L) / 2);
  let points: [number, number][] | null = null;
  for (const ampScale of [1, 0]) {
    for (let r = largest; r >= 8 && !points; r -= 8) {
      const candidate = build(r, ampScale);
      if (clear(candidate)) points = candidate;
    }
    if (points) break;
  }
  if (!points) return null;

  /* Distances round the loop, so a parcel moving from point to point keeps one speed. */
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    lengths.push(lengths[i - 1]! + Math.hypot(x1 - x0, y1 - y0));
  }
  const length = lengths[lengths.length - 1]!;
  if (!(length > 0)) return null;
  const loopPoints = points.map(([x, y], i) => ({ x, y, at: i === points!.length - 1 ? 1 : lengths[i]! / length }));
  const d = `M${loopPoints.map(p => `${round(p.x)} ${round(p.y)}`).join("L")}Z`;
  return { d, length, points: loopPoints };
}

function round(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

/** Where on the loop a parcel is when it has gone `fraction` of the way round. */
export function pointAt(loop: Loop, fraction: number): { x: number; y: number } {
  const f = ((fraction % 1) + 1) % 1;
  const points = loop.points;
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (points[mid]!.at <= f) low = mid;
    else high = mid;
  }
  const a = points[low]!;
  const b = points[high]!;
  const span = b.at - a.at;
  const t = span > 0 ? (f - a.at) / span : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** How fast the parcels go, in pixels a second: unhurried, a little quicker on a wide screen. */
export function speedFor(width: number): number {
  return Math.min(78, Math.max(48, width * 0.055));
}

/** How far apart the parcels travel, in pixels. */
export function spacingFor(width: number): number {
  return Math.min(320, Math.max(220, width * 0.24));
}

/** A small, fixed unevenness, so the parcels do not travel in lockstep like a belt. */
const JITTER = [0, 0.14, -0.1, 0.18, -0.06, 0.08, -0.16, 0.04, 0.12, -0.12, 0.02, -0.04];

/** How far round the loop each parcel starts, for `count` parcels. */
export function phasesFor(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (((i + (JITTER[i % JITTER.length] ?? 0) * 0.8) / count) % 1 + 1) % 1);
}

/** How many parcels go round a loop this long on a band this wide. */
export function countFor(length: number, width: number): number {
  return Math.max(3, Math.min(16, Math.round(length / spacingFor(width))));
}
