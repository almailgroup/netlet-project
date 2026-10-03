/**
 * The pieces the money tables share: the finance panel's and the payouts
 * page's, so a column reads the same on both.
 */
import type { ReactNode } from "react";

export const cell = "px-3 py-2.5 text-[13px]";
export const head = "px-3 py-2 text-[11px] font-extrabold tracking-[.06em] text-[#536b8c] uppercase";

/**
 * The box a wide table scrolls inside.
 *
 * Seven columns do not fit a phone, so the box scrolls sideways — and a region
 * a mouse can drag but a keyboard cannot reach is one axe is right to fail:
 * without a tab stop on the box itself there is no way to read the last column
 * without a pointer. It takes its name from its own heading, so somebody
 * landing on it is told which table they are in rather than "region".
 *
 * The focus ring comes from the global `[tabindex]:focus-visible` rule, which
 * is why there is none here.
 */
export function Scroller({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return (
    <div
      role="region"
      aria-labelledby={labelledBy}
      tabIndex={0}
      className="mt-3 overflow-x-auto rounded-xl border border-[#d5dfeb] bg-white/70"
    >
      {children}
    </div>
  );
}
