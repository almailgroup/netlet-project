/**
 * A small menu about one line of the bag, behind a round button on the line:
 * the "⋯" of what can be done with it (`LineMenu`) and the delivery button of
 * where it goes (`LineDestination`) share it, so the two open, move and close
 * alike.
 *
 * Two shapes, one at a time. On a phone it is a sheet from the foot of the
 * screen, naming the product over the rows — the thumb's reach; from `sm` a
 * small menu under the button. Both are the WAI-ARIA menu: focus on the first
 * item as it opens, the arrows and Home/End between items, Escape back to the
 * button, Tab out; a row that is a choice among others is a `menuitemradio`
 * with a tick. The menu is `position: fixed` against the button and portalled
 * into the nearest dialog or landmark, because the store card round the line
 * clips what overflows it.
 */
import { Thumb } from "@/components/product/Thumb";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { pressHaptic } from "@/lib/haptics";
import type { CartItem } from "@shared/commerce/types";
import { Check, ShoppingBag } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type LineAction = {
  key: string;
  icon: ReactNode;
  label: string;
  /** A second, quieter line under the label. */
  note?: string;
  /** Set on a row that is one choice among others: ticked when chosen. */
  checked?: boolean;
  danger?: boolean;
  run: () => void;
};

export function LinePopover({ item, title, label, short, trigger, actions, intro, active = false }: {
  item: CartItem;
  title: string;
  /** The button's and the menu's name. */
  label: string;
  /** The tooltip under a mouse. */
  short: string;
  trigger: ReactNode;
  actions: LineAction[];
  /** A sentence over the rows. */
  intro?: string;
  /** Drawn in navy rather than the muted ink: the line has a choice made. */
  active?: boolean;
}) {
  const { t } = useTranslation();
  const wide = useMediaQuery("(min-width: 640px)");
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [place, setPlace] = useState<{ top?: number; bottom?: number; end: number } | null>(null);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };
  const choose = (action: LineAction) => {
    pressHaptic();
    setOpen(false);
    action.run();
  };
  const focusItem = (index: number) => {
    const all = menu.current ? [...menu.current.querySelectorAll<HTMLElement>("[role^=menuitem]")] : [];
    all[(index + all.length) % all.length]?.focus();
  };
  const onMenuKey = (event: React.KeyboardEvent) => {
    const all = [...(menu.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") { event.preventDefault(); focusItem(at + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focusItem(at - 1); }
    else if (event.key === "Home") { event.preventDefault(); focusItem(0); }
    else if (event.key === "End") { event.preventDefault(); focusItem(all.length - 1); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === "Tab") close(false);
  };

  /* The small menu sits under the button, or over it when the screen has no
     room below, measured as it opens and again as the page moves — it
     follows its button while the button is on screen, and closes once it is
     not. Closing on any scroll shut it under a press made while a smooth
     scroll was still settling. */
  const measure = () => {
    const anchor = button.current;
    if (!anchor) return false;
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    const rtl = getComputedStyle(anchor).direction === "rtl";
    const end = rtl ? rect.left : window.innerWidth - rect.right;
    const roomBelow = window.innerHeight - rect.bottom;
    setPlace(roomBelow > 300 ? { top: rect.bottom + 6, end } : { bottom: window.innerHeight - rect.top + 6, end });
    return true;
  };
  useLayoutEffect(() => {
    if (open && wide) measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, wide]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => focusItem(0), 0);
    if (!wide) return () => window.clearTimeout(timer);
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const follow = () => { if (!measure()) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, wide]);

  /* The sheet is a modal: Escape, the page held still, focus handed back. */
  useOverlay(open && !wide, () => setOpen(false));

  const row = (action: LineAction, big: boolean) => (
    <button
      key={action.key}
      type="button"
      role={action.checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={action.checked}
      tabIndex={-1}
      onClick={() => choose(action)}
      className={`flex w-full items-center gap-3 rounded-xl px-3 text-start font-bold hover:bg-[#0a285a]/[.06] focus-visible:bg-[#0a285a]/[.06] ${big ? "min-h-12 text-[15px]" : "min-h-10 text-[13px]"} ${action.danger ? "text-[#c2362a]" : "text-[#0a285a]"}`}
    >
      <span className={`grid size-5 shrink-0 place-items-center ${action.danger ? "" : "text-[#536b8c]"}`}>{action.icon}</span>
      <span className="min-w-0 flex-1 py-1.5">
        <span dir="auto" className="block">{action.label}</span>
        {action.note ? <span dir="auto" className={`block font-medium ink-muted ${big ? "text-[13px]" : "text-[12px]"}`}>{action.note}</span> : null}
      </span>
      {action.checked ? <Check className="size-[18px] shrink-0 text-[#0a285a]" aria-hidden /> : null}
    </button>
  );

  const host = typeof document === "undefined" ? null
    : (button.current?.closest<HTMLElement>("[role=dialog], main") ?? document.body);

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => { pressHaptic(); setOpen(value => !value); }}
        onKeyDown={event => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); setOpen(true); } }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={short}
        className={`tap-target -m-1 grid size-9 shrink-0 place-items-center rounded-full hover:bg-[#0a285a]/[.06] hover:text-[#0a285a] ${active ? "text-[#0a285a]" : "text-[#536b8c]"}`}
      >
        {trigger}
      </button>
      {open && wide && place && host ? createPortal(
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          style={{ top: place.top, bottom: place.bottom, insetInlineEnd: place.end }}
          className="fixed z-[80] w-64 rounded-2xl border border-[#d5dfeb] bg-white p-1.5 shadow-[0_18px_40px_rgba(10,40,90,.16)]"
        >
          {intro ? <p className="px-3 pb-1.5 pt-2 text-[12px] leading-4 ink-muted">{intro}</p> : null}
          {actions.map((action, index) => (
            <div key={action.key}>
              {action.danger && index > 0 ? <div role="separator" className="my-1 h-px bg-[#e6e9ef]" /> : null}
              {row(action, false)}
            </div>
          ))}
        </div>,
        host,
      ) : null}
      {open && !wide ? createPortal(
        <div className="fixed inset-0 z-[80] flex items-end bg-[#061b3b]/40" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            onClick={event => event.stopPropagation()}
            className="sheet-rise w-full rounded-t-3xl bg-white px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_40px_rgba(10,40,90,.18)]"
          >
            <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-[#d5dfeb]" />
            {/* Which line this is about, so a sheet over the bag cannot be
                mistaken for the one under it. */}
            <div className="mb-2 flex items-center gap-3 border-b border-[#eef1f5] px-2 pb-3">
              <span className="size-12 shrink-0 overflow-hidden rounded-xl border border-[#eef1f5] bg-[#f4f6f9]">
                <Thumb src={item.image?.url} alt="" className="size-full object-cover" icon={<ShoppingBag className="size-4" />} />
              </span>
              <span className="min-w-0">
                <span dir="auto" className="line-clamp-2 text-[14px] font-extrabold leading-5 text-[#0a285a]">{title}</span>
                {intro ? <span className="mt-0.5 block text-[12px] leading-4 ink-muted">{intro}</span> : null}
              </span>
            </div>
            <div ref={menu} id={menuId} role="menu" aria-label={label} onKeyDown={onMenuKey}>
              {actions.map(action => row(action, true))}
            </div>
            <button
              type="button"
              onClick={() => close(true)}
              className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl bg-[#f0f2f5] text-[15px] font-bold text-[#0a285a]"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
