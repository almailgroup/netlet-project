/**
 * A better price for one line of the bag, on the owner's word ("a discount
 * icon next to each individual product … applies exclusively to that row").
 *
 * **It is the price request, asked from the line.** A shopper names what they
 * would pay for that variant and its seller answers (`PriceOfferPanel`,
 * 3.1.13); an agreed price is a fact about this shopper and this variant, so
 * it lowers that line and nothing else in the bag, is read on every price of
 * the bag and checkout, and is never drawn as an advertised saving. A code
 * that takes money off one product is a different thing — a discount code
 * scoped to a product — and needs columns this schema does not have, so it
 * waits on an approved migration rather than being faked here.
 *
 * **Drawn only where the seller takes requests** on that variant
 * (`offers.openOn`, the product page's own read, so the two share an answer)
 * and while `priceOffers` is on: a button that can only say "this seller does
 * not do that" is the dead-control rule. It is navy while an agreed price is
 * on the line. A guest is shown it too and offered the sign-in inside.
 *
 * The sheet comes from the foot of a phone's screen and is a card from `sm`,
 * portalled to `<body>` over the drawer, a modal (`useOverlay`).
 */
import { PriceOfferPanel } from "@/components/product/PriceOfferPanel";
import { Thumb } from "@/components/product/Thumb";
import { useFeature } from "@/hooks/useFeature";
import { useOverlay } from "@/hooks/useOverlay";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { pressHaptic } from "@/lib/haptics";
import { trpc } from "@/lib/trpc";
import type { CartItem } from "@shared/commerce/types";
import { BadgePercent, ShoppingBag, X } from "lucide-react";
import { Suspense, lazy, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const AuthDialog = lazy(() => import("@/components/auth/AuthDialog"));

export function LineDiscount({ item, title }: { item: CartItem; title: string }) {
  const { t } = useTranslation();
  const money = useMoney();
  const on = useFeature("priceOffers");
  const variantId = Number(item.variantId);
  const valid = Number.isFinite(variantId) && variantId > 0;
  const taken = trpc.offers.openOn.useQuery(
    { variantIds: [variantId] },
    { enabled: on && valid, staleTime: 5 * 60 * 1000 },
  );
  const [open, setOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const headingId = useId();

  useOverlay(open && !signingIn, () => setOpen(false));
  /* Into the sheet as it opens: the price box when there is one to type in
     (the panel focuses it), and the sheet's own heading otherwise. */
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      if (!sheet.current?.contains(document.activeElement)) sheet.current?.querySelector<HTMLElement>("[data-sheet-heading]")?.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!on || !valid || !taken.data?.includes(variantId)) return null;

  const agreed = item.priceReason === "agreed" && Boolean(item.agreedFrom);
  const listPrice = (item.agreedFrom ?? item.unitPrice).amount;
  const close = () => { setOpen(false); button.current?.focus(); };

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => { pressHaptic(); setOpen(true); }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("offers.forLine", { name: title })}
        title={t("offers.lineShort")}
        className={`tap-target -m-1 grid size-9 shrink-0 place-items-center rounded-full hover:bg-[#0a285a]/[.06] hover:text-[#0a285a] ${agreed ? "text-[#0a285a]" : "text-[#536b8c]"}`}
      >
        <BadgePercent className="size-[18px]" aria-hidden />
      </button>
      {open ? createPortal(
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#061b3b]/40 sm:items-center sm:p-4" onClick={close}>
          <div
            ref={sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            onClick={event => event.stopPropagation()}
            className="sheet-rise max-h-[92svh] w-full overflow-y-auto rounded-t-3xl bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_40px_rgba(10,40,90,.18)] sm:max-w-md sm:rounded-3xl sm:pb-5 sm:pt-4"
          >
            <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-[#d5dfeb] sm:hidden" />
            <div className="flex items-start gap-3 border-b border-[#eef1f5] pb-3">
              <span className="size-12 shrink-0 overflow-hidden rounded-xl border border-[#eef1f5] bg-[#f4f6f9]">
                <Thumb src={item.image?.url} alt="" className="size-full object-cover" icon={<ShoppingBag className="size-4" />} />
              </span>
              <span className="min-w-0 flex-1">
                <span id={headingId} data-sheet-heading tabIndex={-1} className="block text-[15px] font-extrabold text-[#0a285a] outline-none">{t("offers.heading")}</span>
                <span dir="auto" className="mt-0.5 line-clamp-2 block text-[13px] font-bold leading-5 text-[#404553]">{title}</span>
                <span className="mt-0.5 block text-[12px] leading-4 ink-muted">{t("offers.lineNote", { price: money({ amount: listPrice, currencyCode: "KWD" }) })}</span>
              </span>
              <button
                type="button"
                onClick={close}
                aria-label={t("common.close")}
                className="tap-target -m-1 grid size-9 shrink-0 place-items-center rounded-full text-[#536b8c] hover:bg-[#0a285a]/[.06]"
              >
                <X className="size-[18px]" aria-hidden />
              </button>
            </div>
            <div className="pt-3">
              <PriceOfferPanel variantId={item.variantId} listPrice={listPrice} embedded onSignIn={() => setSigningIn(true)} />
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
      {signingIn ? createPortal(
        <Suspense fallback={null}><AuthDialog open onClose={() => setSigningIn(false)} /></Suspense>,
        document.body,
      ) : null}
    </>
  );
}
