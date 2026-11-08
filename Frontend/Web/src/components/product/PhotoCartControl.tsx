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
 * **All three are Liquid Glass, the tab bar's, on the owner's word** ("make
 * the adding to cart design Liquid Glass, just like the bottom menu"): the
 * tab bar's layers (`glass-bar-surface`), its rim and its near-black ink, at
 * an even 70% white (`.glass-chip`) — thicker than the bar's, because the
 * count is words on the glass and a photo can be dark behind it. A phone
 * blurs without the warp, as the tab bar does.
 *
 * **The count is typed, on the owner's word** ("pick a custom amount … by
 * tapping on the number and editing the value"): the stepper's number is the
 * bag's own box (`typedQuantity`) — a press selects it and opens the number
 * keypad, Enter or leaving it sets the line, zero takes the line out, and
 * over what there is is held to it and said. The stepper stays open while it
 * is being typed in.
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
import { cardCeiling, quantityDraft, typedQuantity } from "@shared/commerce/typedQuantity";
import { MAX_LINE_QUANTITY } from "@shared/commerce/types";
import { useCart } from "@/contexts/CartContext";
import { useStockLimit } from "@/hooks/useStockLimit";
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
  const sayLimit = useStockLimit();
  /* What there is, less the bag's other lines of it: the plus is faint there. */
  const atLimit = Boolean(line) && quantity >= cardCeiling(variant, line, cart?.items ?? []);

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
      if (!box.current || box.current.contains(event.target as Node)) return;
      /* A number still being typed is set before the stepper folds. */
      const field = box.current.querySelector("input");
      if (field && document.activeElement === field) field.blur();
      setOpen(false);
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
    <>
      <Glass />
      <Plus className="size-5" strokeWidth={2.4} aria-hidden />
    </>
  );
  const corner = "absolute bottom-2 end-2 z-[1]";
  /* The tab bar's glass: its rim, its shadow and its near-black ink. */
  const glass = "glass-chip isolate border border-black/[.12] text-[#16181d] shadow-[0_6px_18px_rgba(10,40,90,.16),0_1px_3px_rgba(10,40,90,.08)]";
  const plusClass = `${corner} ${glass} grid size-11 place-items-center rounded-xl focus-visible:outline-offset-2`;

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
    const ceiling = cardCeiling(variant, line, cart?.items ?? []);
    const clamped = Math.min(ceiling, next);
    if (clamped === line.quantity) {
      /* A plus at the limit says why rather than doing nothing (`useStockLimit`). */
      if (next > line.quantity) sayLimit(ceiling);
      return;
    }
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
        className={`${corner} ${glass} grid size-11 place-items-center rounded-xl focus-visible:outline-offset-2`}
      >
        <Glass />
        <CartCount count={quantity} />
      </button>
    );
  } else {
    const step = "grid h-full w-11 shrink-0 place-items-center rounded-xl hover:bg-[#0a285a]/[.06] disabled:opacity-40 focus-visible:outline-offset-[-3px]";
    const ceiling = cardCeiling(variant, line, cart?.items ?? []);
    face = (
      <div
        role="group"
        aria-label={t("card.inCart", { count: String(quantity) })}
        className={`photo-stepper ${corner} ${glass} flex h-11 w-[min(calc(100%-1rem),9.5rem)] items-center overflow-hidden rounded-xl`}
      >
        <Glass />
        <button
          type="button"
          onClick={event => change(event, quantity - 1)}
          aria-label={t(quantity <= 1 ? "cart.remove" : "cart.decrease", { name })}
          className={step}
        >
          {quantity <= 1 ? <Trash2 className="size-[18px]" aria-hidden /> : <Minus className="size-5" aria-hidden />}
        </button>
        <PhotoQuantity
          quantity={quantity}
          ceiling={ceiling}
          name={name}
          onSet={next => {
            setSaid(next < 1 ? t("cart.removedName", { name }) : t("cart.quantityShort", { count: String(next) }));
            if (next < 1) {
              focusNext.current = "plus";
              setOpen(false);
              removeItem(line.lineId).catch(failed);
            } else updateQuantity(line.lineId, next).catch(failed);
          }}
        />
        <button
          type="button"
          data-focus="step"
          onClick={event => change(event, quantity + 1)}
          aria-disabled={atLimit || undefined}
          aria-label={t("cart.increase", { name })}
          className={`${step} ${atLimit ? "opacity-40" : ""}`}
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

/** The tab bar's glass behind a face: blur, tint and rim, inside its corners. */
function Glass() {
  return (
    <span aria-hidden className="glass-bar-surface glass-bar-round">
      <span className="glass-bar-bend" />
      <span className="glass-bar-face" />
    </span>
  );
}

/**
 * The stepper's number, a box — the bag's own (`LineQuantity`): a press
 * selects it and opens the number keypad, and what is typed is the line's
 * quantity on Enter or on leaving the box; zero takes the line out, over what
 * there is is held to it and said, anything not a whole number changes
 * nothing, and Escape puts it back. Always an input, because a phone opens its
 * keyboard only for a field focused by the press itself.
 */
function PhotoQuantity({ quantity, ceiling, name, onSet }: { quantity: number; ceiling: number; name: string; onSet: (next: number) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const justFocused = useRef(false);
  const commit = () => {
    const text = draft;
    setDraft(null);
    if (cancelled.current || text === null) {
      cancelled.current = false;
      return;
    }
    const typed = typedQuantity(text, ceiling);
    if (!typed) return;
    if (typed.kind === "remove") return onSet(0);
    if (typed.capped) toast(ceiling < MAX_LINE_QUANTITY ? t("cart.onlyAvailable", { count: ceiling }) : t("cart.atMost", { count: String(MAX_LINE_QUANTITY) }));
    if (typed.quantity !== quantity) {
      pressHaptic();
      onSet(typed.quantity);
    }
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      enterKeyHint="done"
      autoComplete="off"
      aria-label={t("cart.quantityOf", { name })}
      value={draft ?? String(quantity)}
      onFocus={event => {
        setDraft(String(quantity));
        event.currentTarget.setSelectionRange(0, event.currentTarget.value.length);
        justFocused.current = true;
      }}
      onMouseUp={event => {
        if (!justFocused.current) return;
        justFocused.current = false;
        event.preventDefault();
      }}
      onChange={event => setDraft(quantityDraft(event.target.value))}
      onKeyDown={event => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
      onBlur={commit}
      className="line-quantity h-8 min-w-0 flex-1 rounded-lg bg-transparent text-center text-[16px] font-bold tabular-nums text-[#16181d] outline-none focus:bg-white focus:ring-2 focus:ring-[#0a285a]"
    />
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
