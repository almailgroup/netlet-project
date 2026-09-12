/**
 * One collapsible group in the filter sidebar.
 *
 * Open by default, because a shopper who has come to narrow a list should see
 * what they can narrow by without a round of clicking. Groups that are long or
 * secondary pass `defaultOpen={false}`.
 *
 * The heading is a real button controlling a real region, so the sidebar is
 * navigable by keyboard and announces itself rather than being a list of divs
 * that happen to fold.
 */
import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

export function FilterGroup({ title, defaultOpen = true, children }: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className="border-b border-[#e6e9ef] py-3.5 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-2 text-start"
      >
        <span className="text-[13px] font-bold text-[#0a285a]">{title}</span>
        <ChevronDown className={`size-4 shrink-0 ink-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {/* `hidden` rather than unmounting, so a group keeps its scroll position
          and any typed value when it is folded and opened again. */}
      <div id={panelId} hidden={!open} className="mt-3">
        {children}
      </div>
    </div>
  );
}

/**
 * A filter row: a checkbox, its label, and how many products carry it.
 *
 * The count is the part that makes a facet usable — it is the difference
 * between guessing and knowing whether ticking "Sony" leaves you anything.
 */
export function FilterCheckbox({ label, count, checked, onChange }: {
  label: string;
  count?: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 py-1.5 text-[13px] text-[#404553] hover:text-[#0a285a]">
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        className="size-4 shrink-0 rounded accent-[#f2683a]"
      />
      <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
      {count === undefined ? null : <span className="shrink-0 text-[11px] text-[#9ea4b5]">({count})</span>}
    </label>
  );
}

/**
 * A facet list that does not run off the page.
 *
 * A brand list can be forty long. Showing the first handful and the rest behind
 * one control keeps the sidebar scannable, and the threshold is high enough
 * that a short list never gets a pointless "show all 6".
 */
export function CollapsibleList({ children, moreLabel, fewerLabel, limit = 6 }: {
  children: ReactNode[];
  moreLabel: (hidden: number) => string;
  fewerLabel: string;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const overflow = children.length - limit;
  const shown = expanded ? children : children.slice(0, limit);

  return (
    <>
      {shown}
      {overflow > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(current => !current)}
          className="mt-1.5 text-[12px] font-bold ink-accent underline underline-offset-4"
        >
          {expanded ? fewerLabel : moreLabel(children.length)}
        </button>
      ) : null}
    </>
  );
}
