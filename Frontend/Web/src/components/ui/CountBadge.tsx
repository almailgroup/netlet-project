/**
 * The shop's notification badges: a small, rounded, lit-from-above badge —
 * on the owner's word, who asked for a modern 3D look in place of the pixel
 * art the badges wore before.
 *
 * A count is a pill of the brand orange, lighter at the top and the brand's
 * own orange at the foot, with a soft highlight across its upper half, a fine
 * inner edge and a white rim, lifted off the control by a small shadow
 * (`.count-badge` in `index.css`). The number is navy on the orange, never
 * white: navy is 4.65:1 on `#f2683a` and more on the lighter top, where white
 * would be 3.08:1. It is hidden from a screen reader, because the control it
 * sits on already says the count.
 *
 * **It hops when it has news, and again every ten seconds**, as the pixel
 * badge did on the owner's word — a smooth rise and a small settle now rather
 * than held sprite poses. Keyed by the number, so a new number hops at once
 * and starts the ten seconds again. Nobody who asked for less motion sees it
 * move.
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
