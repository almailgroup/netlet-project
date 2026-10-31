/**
 * The shop's notification badges: a flat 2D badge drawn like a sketch, on the
 * owner's word ("fix the fade which is on top of it, make it high quality 2D
 * sketch design") — it was a 3D badge with a gloss fading across its upper
 * half, and before that pixel art.
 *
 * A count is a pill of the brand orange, flat, inside a navy ink line, on a
 * white sticker edge (`.count-badge` in `index.css`); no gradient, no blur
 * and no shadow — the hard navy one went, on the owner's word. The number is navy
 * on the orange, never white: navy is 4.65:1 on `#f2683a`, white 3.08:1. It
 * is hidden from a screen reader, because the control it sits on already says
 * the count.
 *
 * **It hops when it has news, and again every five seconds**, on the owner's
 * word — a jump, a squash as it lands and a spring back. Keyed by the number,
 * so a new number hops at once and starts the five seconds again. Nobody who
 * asked for less motion sees it move.
 */

/**
 * A count on a control's shoulder, drawn only when there is something to
 * count. `className` places it — the caller knows where the shoulder is.
 */
export function CountBadge({ value, className = "" }: { value: number; className?: string }) {
  if (!value) return null;
  const text = value > 99 ? "99+" : String(value);
  return (
    <span aria-hidden className={`badge-hold pointer-events-none ${className}`}>
      <span key={text} className="count-badge badge-hop">{text}</span>
    </span>
  );
}

/**
 * Something is waiting, without a number: the same surface as a small round
 * dot, for the places that say how many in words beside it.
 */
export function NoticeDot({ className = "", label }: { className?: string; label?: string }) {
  return (
    <span
      className={`badge-hold pointer-events-none ${className}`}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <span className="notice-dot badge-hop" />
    </span>
  );
}
