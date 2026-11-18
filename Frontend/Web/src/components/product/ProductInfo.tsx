/**
 * Specifications, shipping, warranty and returns: tabs, or sections on a phone.
 *
 * Four tabs do not fit a phone's width. They scrolled sideways inside their own
 * strip, so on a 390px screen "Returns" was cut at the edge and nothing said
 * there was a fourth — the policy a shopper deciding on a purchase most wants to
 * find. Below `sm` each is a section that opens and closes, all four named one
 * under the other, the specifications open to start with, and more than one
 * may be open at once; from `sm` up they are the tabs they were.
 *
 * One structure at a time (`useMediaQuery`), never both with one hidden: both
 * would put each panel's id, and its content, on the page twice.
 *
 * **The tabs are drawn only where they fit, whatever the window's width.**
 * From `lg` the information sits in the column beside the photos, and between
 * 1024 and about 1150 that column is narrower than the four tabs (528px in
 * English, 446 in Arabic): the English page scrolled sideways and the Arabic
 * tabs hung past the card's edge. So the tabs' own width is measured when they
 * are drawn (before the paint) and the sections are used while the column has
 * less room than that; a change of language measures again.
 */
import { ChevronDown, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";

export type InfoSectionId = "specifications" | "shipping" | "warranty" | "returns";

export type InfoSection = { id: InfoSectionId; label: string; icon: LucideIcon; panel: ReactNode };

/* The selected tab keeps its navy on hover: `.glass-navy:hover` shifts to a
   lighter step, which on a tab already selected reads as a second control. */
const tabClass = (active: boolean) =>
  `pressable inline-flex items-center gap-1.5 rounded-[9px] px-3.5 py-2 text-[13px] font-bold whitespace-nowrap transition-colors ${active ? "glass glass-navy hover:!bg-[#0a285a]" : "ink-muted hover:text-[#0a285a]"}`;

export function ProductInfo({ sections, label, resetKey }: { sections: InfoSection[]; label: string; resetKey: string | undefined }) {
  const phone = useMediaQuery("(max-width: 639px)");
  const wrap = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  /* The tabs' own width once drawn, and the room the column has. */
  const [need, setNeed] = useState(0);
  const [room, setRoom] = useState<number | null>(null);
  const labels = sections.map(section => section.label).join("|");
  useLayoutEffect(() => setNeed(0), [labels]);
  useLayoutEffect(() => {
    if (strip.current) setNeed(strip.current.offsetWidth);
  });
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const read = () => setRoom(el.clientWidth);
    read();
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const narrow = phone || (need > 0 && room !== null && need > room);
  const [tab, setTab] = useState<InfoSectionId>("specifications");
  const [open, setOpen] = useState<Set<InfoSectionId>>(() => new Set(["specifications"]));

  /* Another product starts where a product starts. */
  useEffect(() => {
    setTab("specifications");
    setOpen(new Set(["specifications"]));
  }, [resetKey]);

  /* One wrapper for both shapes, so the room is read off the same element
     whichever is drawn. */
  if (narrow) {
    return (
      <div ref={wrap}>
        <div className="divide-y divide-[#0a285a]/8 border-y border-[#0a285a]/8">
          {sections.map(section => {
            const expanded = open.has(section.id);
            return (
              <section key={section.id}>
                <h2>
                  <button
                    type="button"
                    id={`tab-${section.id}`}
                    aria-expanded={expanded}
                    aria-controls={`panel-${section.id}`}
                    onClick={() => setOpen(was => {
                      const next = new Set(was);
                      if (next.has(section.id)) next.delete(section.id);
                      else next.add(section.id);
                      return next;
                    })}
                    className="flex min-h-12 w-full items-center gap-2.5 py-3 text-start text-[14px] font-bold text-[#0a285a]"
                  >
                    <section.icon className="size-4 shrink-0 ink-muted" aria-hidden />
                    <span className="min-w-0 flex-1">{section.label}</span>
                    <ChevronDown className={`size-5 shrink-0 ink-muted transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                </h2>
                <div id={`panel-${section.id}`} role="region" aria-labelledby={`tab-${section.id}`} hidden={!expanded} className="panel-in pb-5 pt-1">
                  {section.panel}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div ref={wrap}>
      <div className="flex flex-wrap items-center gap-3">
        <div ref={strip} role="tablist" aria-label={label} className="inline-flex gap-1 rounded-xl border border-[#0a285a]/8 bg-white/50 p-1 shadow-[inset_0_1px_1px_rgba(255,255,255,.7)]">
          {sections.map(section => (
            <button
              key={section.id}
              role="tab"
              id={`tab-${section.id}`}
              aria-selected={tab === section.id}
              aria-controls={`panel-${section.id}`}
              onClick={() => setTab(section.id)}
              className={tabClass(tab === section.id)}
            >
              <section.icon className="size-3.5 shrink-0" aria-hidden />
              {section.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-5 min-h-[120px]">
        {sections.map(section => (
          <div key={section.id} role="tabpanel" id={`panel-${section.id}`} aria-labelledby={`tab-${section.id}`} hidden={tab !== section.id} className="panel-in">
            {section.panel}
          </div>
        ))}
      </div>
    </div>
  );
}
