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

/** Nobody buys a hundred lamps from a product card; a typo could. */
export const MAX_QUANTITY = 99;

export function QuantityStepper({ value, onChange, size = "regular", disabled = false }: {
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
}) {
  const { t } = useTranslation();
  const compact = size === "compact";
  const button = compact ? "grid size-8 place-items-center" : "grid size-9 place-items-center";

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
        onClick={() => onChange(current => Math.min(MAX_QUANTITY, current + 1))}
        disabled={disabled || value >= MAX_QUANTITY}
        aria-label={t("product.increaseQuantity")}
        className={`${button} pressable rounded-full text-[#0a285a] disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <Plus className={compact ? "size-3.5" : "size-4"} />
      </button>
    </div>
  );
}
