/**
 * The two arrows beside a sideways row's heading, for a mouse: drawn from
 * `sm` up and only while the row has something off one end, each disabled at
 * its own end. A finger swipes the row and never needs them.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { SideScroll } from "@/hooks/useSideScroll";

export function ScrollArrows({ scroll, previousLabel, nextLabel }: { scroll: Pick<SideScroll, "edges" | "scrollBy">; previousLabel: string; nextLabel: string }) {
  const { edges, scrollBy } = scroll;
  if (!edges.back && !edges.forward) return null;
  const arrowClass = "glass pressable grid size-9 place-items-center rounded-full text-[#0a285a] disabled:opacity-35";
  return (
    <div className="hidden items-center gap-2 sm:flex">
      <button type="button" onClick={() => scrollBy(-1)} disabled={!edges.back} aria-label={previousLabel} title={previousLabel} className={arrowClass}>
        <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden />
      </button>
      <button type="button" onClick={() => scrollBy(1)} disabled={!edges.forward} aria-label={nextLabel} title={nextLabel} className={arrowClass}>
        <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
      </button>
    </div>
  );
}
