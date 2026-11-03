/**
 * "Confirm your order" — on the owner's word: Place order "should ask you for
 * confirmation of cart before switching to the homepage or any other page. So
 * you should either confirm your purchase or back out. But it should stay in
 * the checkout page."
 *
 * Place order opens this over checkout rather than placing anything: what is
 * coming (its pictures and count), where it goes, how it is paid and what is
 * collected at the door, with Confirm order and Back. Back — and Escape, and a
 * press on the dim — leaves the shopper on checkout with nothing ordered, and
 * Back takes focus as the dialog opens, `ConfirmDialog`'s rule: a stray Enter
 * gives the safe answer. Only Confirm places the order, and while it is being
 * placed both buttons wait.
 *
 * A sheet from the foot of a phone's screen, a card from `sm`, the shop's
 * other sheets' shape (`LinePopover`, the address book).
 */
import { Thumb } from "@/components/product/Thumb";
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { lineTitle } from "@/lib/lineTitle";
import type { CartItem } from "@shared/commerce/types";
import { Banknote, LoaderCircle, MapPin, PackageCheck, ShoppingBag } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

/** How many pictures the strip draws before "+N". */
const PICTURES = 4;

export function ConfirmOrderDialog({
  items,
  itemCount,
  storeCount,
  addressLabel,
  addressLine,
  contact,
  total,
  pending,
  onConfirm,
  onClose,
}: {
  items: CartItem[];
  itemCount: number;
  storeCount: number;
  addressLabel: string;
  addressLine: string;
  /** Who the driver calls, and on what number. */
  contact: string;
  /** What is collected at the door, formatted. */
  total: string;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t, isArabic } = useTranslation();
  const titleId = useId();
  const noteId = useId();
  const backRef = useRef<HTMLButtonElement>(null);
  /* While the order is being placed, nothing closes it: the answer is coming
     either way, and closing would hide which. */
  useOverlay(true, () => { if (!pending) onClose(); });
  useEffect(() => {
    const timer = window.setTimeout(() => backRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, []);

  const shown = items.slice(0, PICTURES);
  const more = items.length - shown.length;

  return createPortal(
    <div className="sheet-scrim fixed inset-0 z-[90] flex items-end justify-center bg-[#061b3b]/50 sm:items-center sm:p-4" onClick={() => { if (!pending) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={noteId}
        onClick={event => event.stopPropagation()}
        className="sheet-rise w-full max-w-[440px] rounded-t-3xl bg-[#fffdf9] px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 text-[#0a285a] shadow-[0_24px_60px_rgba(10,40,90,.28)] sm:rounded-3xl sm:p-6"
      >
        <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-[#d5dfeb] sm:hidden" />
        <h2 id={titleId} className="text-[20px] font-extrabold leading-7">{t("checkout.confirmTitle")}</h2>
        <p id={noteId} className="mt-1 text-[14px] leading-5 text-[#536b8c]">{t("checkout.confirmBody")}</p>

        <div className="mt-4 divide-y divide-[#eef1f5] rounded-2xl border border-[#e6e9ef] bg-white">
          <div className="flex items-center gap-3 p-3.5">
            <span aria-hidden className="flex shrink-0 -space-x-2 rtl:space-x-reverse">
              {shown.map(item => (
                <span key={item.lineId} className="size-11 overflow-hidden rounded-xl border-2 border-white bg-[#f4f6f9] shadow-[0_1px_3px_rgba(10,40,90,.12)]">
                  <Thumb src={item.image?.url} alt="" className="size-full object-cover" icon={<ShoppingBag className="size-4" />} />
                </span>
              ))}
              {more > 0 ? (
                <span className="grid size-11 place-items-center rounded-xl border-2 border-white bg-[#e7edf5] text-[13px] font-extrabold text-[#0a285a]">+{more}</span>
              ) : null}
            </span>
            <p className="min-w-0">
              <span className="block text-[15px] font-extrabold">{t("cart.itemCount", { count: itemCount })}</span>
              <span dir="auto" className="block truncate text-[13px] text-[#536b8c]">
                {storeCount > 1 ? t("checkout.confirmStores", { count: storeCount }) : items[0] ? lineTitle(items[0], isArabic) : ""}
              </span>
            </p>
          </div>
          <div className="flex items-start gap-3 p-3.5">
            <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#fdf3ee]"><MapPin className="size-5 ink-accent" /></span>
            <p className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold leading-4 text-[#536b8c]">{t("home.deliverTo")}</span>
              <span dir="auto" className="block text-[15px] font-extrabold">{addressLabel}</span>
              <span dir="auto" className="block text-[13px] leading-5 text-[#404553]">{addressLine}</span>
              {contact ? <span className="block text-[13px] leading-5 text-[#536b8c]"><bdi>{contact}</bdi></span> : null}
            </p>
          </div>
          <div className="flex items-center gap-3 p-3.5">
            <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#0a285a] text-white"><Banknote className="size-5" /></span>
            <p className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold leading-4 text-[#536b8c]">{t("checkout.paymentMethod")}</span>
              <span className="block text-[15px] font-extrabold">{t("checkout.payCod")}</span>
            </p>
          </div>
          <p className="flex items-baseline justify-between gap-3 p-3.5">
            <span className="text-[15px] font-bold">{t("checkout.confirmCollected")}</span>
            <span className="text-[20px] font-extrabold">{total}</span>
          </p>
        </div>

        <div className="mt-5 grid gap-2.5">
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="glass-accent flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl px-5 text-[16px] font-bold transition-colors disabled:cursor-wait disabled:opacity-70"
          >
            {pending ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <PackageCheck className="size-5" aria-hidden />}
            {pending ? t("checkout.placing") : t("checkout.confirmPlace")}
          </button>
          <button
            ref={backRef}
            type="button"
            onClick={onClose}
            disabled={pending}
            className="glass pressable flex h-12 w-full items-center justify-center rounded-2xl border border-[#d5dfeb] text-[15px] font-bold text-[#0a285a] disabled:opacity-60"
          >
            {t("checkout.confirmBack")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
