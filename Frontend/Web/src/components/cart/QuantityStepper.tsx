/**
 * How many of this one.
 *
 * One component rather than two, because the product page already had this
 * control and a card growing its own copy is how the minus on one starts
 * clamping at 1 and the other at 0. The bounds live here.
 *
 * `aria-live="polite"` on the number is what makes it usable without sight:
 * pressing + moves a digit that is otherwise silent, and a stepper that gives
 * no feedback is one somebody presses four times and then checks the cart.
 * The buttons disable at the ends rather than silently refusing, so the
 * control says where its limits are before you hit them.
 */
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Minus, Plus } from "lucide-react";
import { MAX_LINE_QUANTITY } from "@shared/commerce/types";

/** Nobody buys a hundred lamps from a product card; a typo could. The server's own ceiling. */
export const MAX_QUANTITY = MAX_LINE_QUANTITY;

export function QuantityStepper({ value, onChange, size = "regular", disabled = false, max = MAX_QUANTITY }: {
  value: number;
  /*
   * A React setter, so a press can say "one more than whatever it is now"
   * rather than "one more than what it was when I rendered". Several presses
   * inside one batch — a held Enter on a focused button is the ordinary way —
   * all read the same stale `value` and the count advances once for all of
   * them. Every caller already passes `setQuantity`, so this is the type it
   * always had.
   */
  onChange: Dispatch<SetStateAction<number>>;
  /** `compact` is the card; `regular` is the product page. */
  size?: "regular" | "compact";
  disabled?: boolean;
  /**
   * The most this press may ask for — what is left of the variant after what
   * the bag already holds (`roomFor`), never over the line ceiling. Without
   * it, a stepper offered ninety-nine of something with three on the shelf
   * and checkout refused what the page had suggested.
   */
  max?: number;
}) {
  const { t } = useTranslation();
  const compact = size === "compact";
  const ceiling = Math.max(1, Math.min(MAX_QUANTITY, max));
  /* The product page's is a thumb's size under a coarse pointer (44px a
     side); a mouse keeps the 36px it always had. */
  const button = compact ? "grid size-8 place-items-center" : "grid size-11 place-items-center pointer-fine:size-9";

  return (
    <div className={`inline-flex items-center rounded-full border border-[#d5dfeb] bg-white ${compact ? "h-9" : ""}`}>
      <button
        type="button"
        onClick={() => onChange(current => Math.max(1, current - 1))}
        disabled={disabled || value <= 1}
        aria-label={t("product.decreaseQuantity")}
        className={`${button} pressable rounded-full text-[#0a285a] disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <Minus className={compact ? "size-3.5" : "size-4"} />
      </button>
      {/*
        The count is Latin digits in both languages — Gulf storefronts price in
        Western digits even in Arabic copy — so it is isolated rather than left
        to the paragraph's direction.
      */}
      <span aria-live="polite" className={`text-center font-bold text-[#1f2229] ${compact ? "min-w-7 text-[13px]" : "min-w-9 text-[15px]"}`}>
        <bdi dir="ltr">{value}</bdi>
      </span>
      <button
        type="button"
        onClick={() => onChange(current => Math.min(ceiling, current + 1))}
        disabled={disabled || value >= ceiling}
        aria-label={t("product.increaseQuantity")}
        className={`${button} pressable rounded-full text-[#0a285a] disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <Plus className={compact ? "size-3.5" : "size-4"} />
      </button>
    </div>
  );
}
