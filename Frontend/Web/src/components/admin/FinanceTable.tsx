/**
 * The pieces the money tables share: the finance panel's and the payouts
 * page's, so a column reads the same on both.
 */
import type { ReactNode } from "react";

export const cell = "px-4 py-3 text-[14px] tabular-nums";
/* Sentence case, like every other table in the portal: a tracked uppercase
   header is the mark of generated design, and does nothing in Arabic. */
export const head = "px-4 py-3 text-[13px] font-semibold whitespace-nowrap text-[#536b8c] bg-[#fafbfd]";

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
      className="mt-3 overflow-x-auto rounded-2xl border border-[#e1e7ef] bg-white"
    >
      {children}
    </div>
  );
}
