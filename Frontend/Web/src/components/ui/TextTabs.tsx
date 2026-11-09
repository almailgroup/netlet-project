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
import { useEffect, useRef } from "react";

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

  return (
    <div className="-mx-4 mt-2 border-b border-[#e3e6ec] sm:mx-0">
      <div
        ref={row}
        role="group"
        aria-label={label}
        className="flex gap-6 overflow-x-auto px-4 [scrollbar-width:none] sm:px-0"
      >
        {items.map(item => {
          const on = value === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(item.id)}
              className={`relative min-h-11 shrink-0 whitespace-nowrap pb-3 pt-1 text-[16px] transition-colors ${on ? "font-semibold text-[#0a285a]" : "font-medium ink-muted hover:text-[#0a285a]"}`}
            >
              {item.label}
              <span
                aria-hidden
                className={`absolute bottom-0 left-1/2 h-1 w-7 -translate-x-1/2 rounded-full bg-[#0a285a] transition-opacity duration-200 ${on ? "opacity-100" : "opacity-0"}`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
