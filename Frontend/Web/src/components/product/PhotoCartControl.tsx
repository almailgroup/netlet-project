/**
 * The bag, on the card's photo — how a phone adds to the cart, on the owner's
 * word (the way the delivery apps people here use every day do it).
 *
 * Three faces in the photo's end corner, one at a time:
 *
 * - **A plus**, white, while the product is not in the bag. A press puts one
 *   in and opens the stepper.
 * - **The stepper** — a bin (at one) or a minus, the count, a plus — in navy,
 *   grown out of the corner across the foot of the photo. Each press changes
 *   the bag's line at once (`CartContext` draws it before the server answers)
 *   and starts the wait again.
 * - **The count**, a navy square with the cart and how many, once the stepper
 *   has been left alone for `SETTLE_MS` or a finger lands anywhere else. A
 *   press on it opens the stepper again.
 *
 * It is the bag's plain line for this variant — no extras, no bundle — the
 * line `CardAction` reads, so the card's photo and its Buy now can never
 * disagree about how many. A product with sizes or colours opens its choice
 * instead (the preview where there is one), because a size has to be chosen
 * before "add" means anything; a sold-out one draws nothing here, its badge on
 * the photo already says so.
 *
 * **Every press is felt** where the phone lets a page buzz (`pressHaptic`,
 * Android's Chrome; an iPhone's Safari allows none), and a refusal is felt
 * differently and said in a toast. A polite live region says what each press
 * did, since nothing else on the page moves to say it.
 *
 * The keyboard is followed rather than stranded: a press made with it (a
 * click whose `detail` is 0) puts focus on what replaced the button pressed —
 * the stepper's plus on opening, the plus on removing — and the stepper does
 * not fold away under keyboard focus; when it does fold with focus inside,
 * focus moves to the count that replaces it. A finger's press moves no focus,
 * so a phone's own focus rules cannot keep the stepper open.
 */
import { cardCeiling } from "@shared/commerce/typedQuantity";
import { useCart } from "@/contexts/CartContext";
import { useTranslation } from "@/hooks/useTranslation";
import { pressHaptic, refusedHaptic } from "@/lib/haptics";
import type { Product } from "@shared/commerce/types";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

/** How long the stepper stays open after the last press before it folds into the count. */
export const SETTLE_MS = 2500;

type Focus = "plus" | "step" | "count" | null;

export function PhotoCartControl({ product, onChoose }: { product: Product; onChoose?: () => void }) {
  const { t } = useTranslation();
  const { cart, addItem, updateQuantity, removeItem } = useCart();
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const focusNext = useRef<Focus>(null);

  const variant = product.variants.find(entry => entry.availableForSale) ?? product.variants[0];
  const line = variant
    ? cart?.items.find(item => item.variantId === variant.id && !item.addons?.length && !item.bundleName)
    : undefined;
  const quantity = line?.quantity ?? 0;
  const name = product.title;
  const stepping = open && Boolean(line);

  /* Folds into the count once the presses stop — the timer starts again with
     every change — unless the keyboard is inside it, which would be pulled out
     from under somebody tabbing between its buttons. */
  useEffect(() => {
    if (!stepping) return;
    const timer = window.setTimeout(() => {
      if (box.current?.querySelector(":focus-visible")) return;
      if (box.current?.contains(document.activeElement)) focusNext.current = "count";
      setOpen(false);
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [stepping, quantity]);

  /* A finger anywhere else folds it at once. */
  useEffect(() => {
    if (!stepping) return;
    const away = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [stepping]);

  /* The button pressed is gone by the next frame, so focus goes to what took its place. */
  useEffect(() => {
    const want = focusNext.current;
    if (!want) return;
    focusNext.current = null;
    box.current?.querySelector<HTMLElement>(`[data-focus="${want}"]`)?.focus();
  });

  if (!variant?.availableForSale) return null;

  const failed = () => {
    refusedHaptic();
    toast.error(t("cart.addFailed"));
  };

  const plusFace = (
    <Plus className="size-5" strokeWidth={2.25} aria-hidden />
  );
  const corner = "absolute bottom-2 end-2 z-[1]";
  const plusClass = `${corner} grid size-11 place-items-center rounded-xl border border-[#d5dfeb] bg-white text-[#0a285a] shadow-[0_2px_8px_rgba(10,40,90,0.14)] hover:bg-[#f0f2f5] focus-visible:outline-offset-2`;

  /* A size or a colour to choose first: the preview, or the product's page. */
  if (product.variants.length > 1) {
    return onChoose ? (
      <button type="button" onClick={() => { pressHaptic(); onChoose(); }} aria-label={t("card.chooseName", { name })} className={plusClass}>
        {plusFace}
      </button>
    ) : (
      <Link href={`/products/${encodeURIComponent(product.handle)}`} onClick={() => pressHaptic()} aria-label={t("card.chooseName", { name })} className={plusClass}>
        {plusFace}
      </Link>
    );
  }

  /* Only a press the keyboard made moves focus on. */
  const follow = (event: MouseEvent, to: Focus) => {
    if (event.detail === 0) focusNext.current = to;
  };

  const add = (event: MouseEvent) => {
    pressHaptic();
    follow(event, "step");
    setOpen(true);
    setSaid(t("cart.added", { name }));
    addItem(variant.id, 1, { reveal: false, product }).catch(() => {
      setOpen(false);
      failed();
    });
  };

  const change = (event: MouseEvent, next: number) => {
    if (!line) return;
    pressHaptic();
    if (next < 1) {
      follow(event, "plus");
      setOpen(false);
      setSaid(t("cart.removedName", { name }));
      removeItem(line.lineId).catch(failed);
      return;
    }
    const clamped = Math.min(cardCeiling(variant, line, cart?.items ?? []), next);
    if (clamped === line.quantity) return;
    setSaid(t("cart.quantityShort", { count: String(clamped) }));
    updateQuantity(line.lineId, clamped).catch(failed);
  };

  let face;
  if (!line) {
    face = (
      <button type="button" data-focus="plus" onClick={add} aria-label={t(variant.preorder ? "card.preorderName" : "card.addName", { name })} className={plusClass}>
        {plusFace}
      </button>
    );
  } else if (!stepping) {
    face = (
      <button
        type="button"
        data-focus="count"
        onClick={event => { pressHaptic(); follow(event, "step"); setOpen(true); }}
        aria-expanded={false}
        aria-label={t("card.changeQuantity", { count: String(quantity), name })}
        className={`${corner} grid size-11 place-items-center rounded-xl bg-[#0a285a] text-white shadow-[0_2px_8px_rgba(10,40,90,0.24)] hover:bg-[#0d3372] focus-visible:outline-offset-2`}
      >
        <CartCount count={quantity} />
      </button>
    );
  } else {
    const step = "grid h-full w-11 shrink-0 place-items-center rounded-xl hover:bg-white/[.12] disabled:opacity-40 focus-visible:outline-offset-[-3px] focus-visible:outline-white";
    face = (
      <div
        role="group"
        aria-label={t("card.inCart", { count: String(quantity) })}
        className={`photo-stepper ${corner} flex h-11 w-[min(calc(100%-1rem),9.5rem)] items-center overflow-hidden rounded-xl bg-[#0a285a] text-white shadow-[0_2px_10px_rgba(10,40,90,0.28)]`}
      >
        <button
          type="button"
          onClick={event => change(event, quantity - 1)}
          aria-label={t(quantity <= 1 ? "cart.remove" : "cart.decrease", { name })}
          className={step}
        >
          {quantity <= 1 ? <Trash2 className="size-[18px]" aria-hidden /> : <Minus className="size-5" aria-hidden />}
        </button>
        <span aria-hidden className="min-w-0 flex-1 text-center text-[16px] font-bold tabular-nums">{quantity}</span>
        <button
          type="button"
          data-focus="step"
          onClick={event => change(event, quantity + 1)}
          disabled={quantity >= cardCeiling(variant, line, cart?.items ?? [])}
          aria-label={t("cart.increase", { name })}
          className={step}
        >
          <Plus className="size-5" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div ref={box}>
      {face}
      <span aria-live="polite" className="sr-only">{said}</span>
    </div>
  );
}

/**
 * The cart with how many inside its basket — one drawing, so the number sits
 * where the basket is in either language and at any size. Two digits are drawn
 * a little smaller, since a line holds up to 99.
 */
function CartCount({ count }: { count: number }) {
  return (
    <svg viewBox="0 0 28 28" className="size-7" aria-hidden>
      <path d="M2.5 4h3.2l2.7 12.4a1.6 1.6 0 0 0 1.6 1.3h10.7a1.6 1.6 0 0 0 1.6-1.2L24.6 8H6.6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10.6" cy="22.6" r="1.7" fill="currentColor" />
      <circle cx="20" cy="22.6" r="1.7" fill="currentColor" />
      <text x="15.6" y="13" textAnchor="middle" dominantBaseline="central" fill="currentColor" fontSize={count > 9 ? 7.5 : 9} fontWeight={800} style={{ fontVariantNumeric: "tabular-nums" }}>
        {count}
      </text>
    </svg>
  );
}
