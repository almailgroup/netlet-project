/**
 * A row of plain-word tabs over a list, drawn to the owner's picture of a
 * shop's "Your orders": the chosen one dark with a short rounded line under
 * it, the rest muted, a hairline under the row, which scrolls sideways when it
 * is wider than a phone and keeps the chosen one in view. My orders and Saved
 * items and wishlists both wear it, so the two cannot drift apart.
 *
 * They are `aria-pressed` buttons in a named group, not a tablist: they narrow
 * or switch what is listed below, the portal's `Segmented` rule.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function TextTabs<Id extends string>({ items, value, onChange, label }: {
  items: { id: Id; label: string }[];
  value: Id;
  onChange: (id: Id) => void;
  /** What the group is, to a screen reader. */
  label: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  /* The chosen tab in view — one opened from an old address can be off the
     end of a phone's row. */
  useEffect(() => {
    row.current?.querySelector<HTMLElement>("[aria-pressed=true]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);

  /*
   * One line under the row that slides to the tab chosen, rather than a line
   * per tab fading out and in. Placed by measuring the chosen tab — its
   * middle, in the row's own coordinates, so it scrolls with the row — and
   * measured again when the row changes size (the words in a web font, a
   * phone turned). The first placement does not slide.
   */
  const [line, setLine] = useState<{ x: number; moved: boolean } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const chosen = row.current?.querySelector<HTMLElement>("[aria-pressed=true]");
      if (!chosen) return setLine(null);
      const x = chosen.offsetLeft + chosen.offsetWidth / 2;
      setLine(previous => (previous && previous.x === x ? previous : { x, moved: previous !== null }));
    };
    place();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
    if (row.current && observer) observer.observe(row.current);
    return () => observer?.disconnect();
  }, [value, items.length]);

  return (
    <div className="-mx-4 mt-2 border-b border-[#e3e6ec] sm:mx-0">
      <div
        ref={row}
        role="group"
        aria-label={label}
        className="relative flex gap-6 overflow-x-auto px-4 [scrollbar-width:none] sm:px-0"
      >
        {line ? (
          <span
            aria-hidden
            className={`absolute bottom-0 left-0 h-1 w-7 rounded-full bg-[#0a285a] ${line.moved ? "transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]" : ""}`}
            style={{ transform: `translateX(${line.x - 14}px)` }}
          />
        ) : null}
        {items.map(item => {
          const on = value === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(item.id)}
              className={`min-h-11 shrink-0 whitespace-nowrap pb-3 pt-1 text-[16px] transition-colors ${on ? "font-semibold text-[#0a285a]" : "font-medium ink-muted hover:text-[#0a285a]"}`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
