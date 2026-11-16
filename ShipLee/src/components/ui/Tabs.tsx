import { useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export type Tab = { id: string; label: string; panel: ReactNode };

/**
 * Tabs, the WAI-ARIA way: one tab in the Tab order, the arrows move between
 * them (mirrored on the Arabic page, where the next tab is to the left), Home
 * and End go to the ends, and each panel is named by its tab.
 */
export function Tabs({ tabs, label, initial }: { tabs: Tab[]; label: string; initial?: string }) {
  const [selected, setSelected] = useState(initial ?? tabs[0]?.id);
  const base = useId();
  const list = useRef<HTMLDivElement>(null);

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = document.documentElement.dir === "rtl";
    const step: Record<string, number> = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 };
    let next: number | null = null;
    if (event.key in step) next = (index + step[event.key]! + tabs.length) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    setSelected(tabs[next]!.id);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div>
      <div ref={list} className="tabs" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="tab"
            id={`${base}-${tab.id}-tab`}
            aria-selected={tab.id === selected}
            aria-controls={`${base}-${tab.id}-panel`}
            tabIndex={tab.id === selected ? 0 : -1}
            onClick={() => setSelected(tab.id)}
            onKeyDown={event => move(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map(tab => (
        <div
          key={tab.id}
          role="tabpanel"
          className="tab-panel"
          id={`${base}-${tab.id}-panel`}
          aria-labelledby={`${base}-${tab.id}-tab`}
          tabIndex={0}
          hidden={tab.id !== selected}
        >
          {tab.id === selected ? tab.panel : null}
        </div>
      ))}
    </div>
  );
}
