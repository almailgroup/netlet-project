/**
 * A small glass disc that is still a 44px target.
 *
 * `.tap-target` grows a hit area with `::after`, and `.glass` draws its rim
 * with `::after` too — on one element the later rule wins, so the rim's
 * `inset: 0` and `pointer-events: none` replaced the hit area outright. Every
 * glass icon button that also carried `.tap-target` (the heart and the share
 * on every product card among them) had a 32px target while looking as though
 * it had been fixed, and the over-constrained box pushed the Arabic account
 * page a pixel sideways, which is how it was found.
 *
 * Two pseudo-elements cannot share one box, so the two jobs go on two
 * elements: the button is the transparent 44px target, and the disc inside it
 * is the glass. `Frontend/Web/src/lib/tapTarget.test.ts` refuses the two classes on
 * one element again. Callers keep the old footprint by pulling the button in
 * by the difference — a negative margin in a row, a smaller offset when it is
 * positioned.
 */
import type { ButtonHTMLAttributes } from "react";

export function DiscButton({ discClassName = "size-8", className = "", children, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  /** The disc's size and anything about how it looks. */
  discClassName?: string;
}) {
  return (
    <button type={type} {...props} className={`pressable grid size-11 shrink-0 place-items-center rounded-full ${className}`}>
      <span className={`glass grid place-items-center rounded-full ${discClassName}`}>{children}</span>
    </button>
  );
}
