/**
 * The shop's notification badges, drawn as pixel art — on the owner's word.
 *
 * A count is a little orange sprite: a stepped outline in navy, the brand
 * orange inside it, one pale pixel of shine and the number in a 3 × 5 pixel
 * font, all as one SVG of unit squares (`shapeRendering="crispEdges"`), so it
 * stays sharp at every zoom and needs no font file. Two pixels to a unit,
 * which keeps every edge on a whole CSS pixel. The digits are navy on the
 * orange, 4.65:1, the rule every badge here follows; the SVG is hidden from a
 * screen reader because the control it sits on already says the count.
 *
 * **It hops when it has news** — when it appears and whenever the number
 * changes: three stepped 8-bit hops with a spark of four pixels flying off,
 * about two and a half seconds, then still (`.pixel-badge` in `index.css`).
 * Every hop is a cut between held poses rather than a glide, which is what
 * makes it read as a sprite. It stops on its own inside five seconds, the line
 * WCAG 2.2.2 draws for motion nobody can pause, and nobody who asked for less
 * motion sees it move at all. Keyed by the number, so a new number restarts
 * it from the first hop.
 */
import type { CSSProperties } from "react";

/* Each glyph is five rows of three, top to bottom; "1" marks a lit pixel. */
const GLYPHS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "001", "001"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "+": ["000", "010", "111", "010", "000"],
};

/** CSS pixels to one sprite pixel. */
const UNIT = 2;
const NAVY = "#0a285a";
const ORANGE = "#f2683a";
const SHINE = "#ffc3a6";

const cell = (x: number, y: number) => `M${x} ${y}h1v1h-1z`;

/**
 * A rounded box in pixels, outlined one pixel thick. Its corners step in by
 * `steps` rows — two on a badge, the way a pixel-art circle does, so a
 * one-digit badge reads as round; one on the small dot.
 */
function sprite(width: number, height: number, steps: number) {
  const inset = (y: number) => Math.max(0, steps - Math.min(y, height - 1 - y));
  let outline = "";
  let body = "";
  for (let y = 0; y < height; y++) {
    const from = inset(y);
    const to = width - 1 - from;
    for (let x = from; x <= to; x++) {
      if (x === from || x === to || y === 0 || y === height - 1) outline += cell(x, y);
      else body += cell(x, y);
    }
  }
  return { outline, body };
}

function glyphs(text: string, left: number, top: number) {
  let lit = "";
  [...text].forEach((char, index) => {
    const rows = GLYPHS[char];
    if (!rows) return;
    rows.forEach((row, y) => [...row].forEach((on, x) => {
      if (on === "1") lit += cell(left + index * 4 + x, top + y);
    }));
  });
  return lit;
}

/** The four pixels that fly off a hop, one from each corner. */
function Spark() {
  return (
    <>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([dx, dy]) => (
        <span
          key={`${dx}${dy}`}
          aria-hidden
          className="pixel-spark"
          style={{ "--dx": dx, "--dy": dy } as CSSProperties}
        />
      ))}
    </>
  );
}

/**
 * A count on a control's shoulder, drawn only when there is something to
 * count. `className` places it — the caller knows where the shoulder is.
 */
export function PixelBadge({ value, className = "" }: { value: number; className?: string }) {
  if (!value) return null;
  const text = value > 99 ? "99+" : String(value);
  const chars = text.length;
  /* Outline, a unit of orange, the glyphs a unit apart, the same on the far
     side — and a second unit of orange either side, so one digit is square. */
  const width = 1 + 2 + chars * 4 - 1 + 2 + 1;
  const height = 9;
  const { outline, body } = sprite(width, height, 2);
  return (
    <span aria-hidden className={`pixel-badge pointer-events-none ${className}`}>
      <span key={text} className="pixel-badge-hop">
        <svg width={width * UNIT} height={height * UNIT} viewBox={`0 0 ${width} ${height}`} shapeRendering="crispEdges" className="block">
          <path d={outline} fill={NAVY} />
          <path d={body} fill={ORANGE} />
          <path d={cell(2, 1)} fill={SHINE} />
          <path d={glyphs(text, 3, 2)} fill={NAVY} />
        </svg>
        <Spark />
      </span>
    </span>
  );
}

/**
 * Something is waiting, without a number: the same sprite at six pixels
 * square, for the places that say how many in words beside it.
 */
export function PixelDot({ className = "", label }: { className?: string; label?: string }) {
  const size = 6;
  const { outline, body } = sprite(size, size, 1);
  return (
    <span
      className={`pixel-badge pointer-events-none ${className}`}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <span className="pixel-badge-hop">
        <svg width={size * UNIT} height={size * UNIT} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className="block">
          <path d={outline} fill={NAVY} />
          <path d={body} fill={ORANGE} />
          <path d={cell(1, 1)} fill={SHINE} />
        </svg>
        <Spark />
      </span>
    </span>
  );
}
