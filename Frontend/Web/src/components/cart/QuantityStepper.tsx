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
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { MAX_LINE_QUANTITY } from "@shared/commerce/types";
import { quantityDraft, typedQuantity } from "@shared/commerce/typedQuantity";

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
  /* The product page's is the cart line's control, on the owner's word
     ("match the unit selector on the cart page"): the same pill, a 40px
     minus and plus under a thumb (28px under a mouse), and the number a box
     a press selects and types into (`TypedCount`). The card keeps its own. */
  const button = compact ? "grid size-8 place-items-center" : "grid size-10 place-items-center pointer-fine:size-7";
  const icon = compact ? "size-3.5" : "size-3.5 pointer-fine:size-3";

  return (
    <div className={`inline-flex items-center rounded-full border border-[#d5dfeb] bg-white ${compact ? "h-9" : ""}`}>
      <button
        type="button"
        onClick={() => onChange(current => Math.max(1, current - 1))}
        disabled={disabled || value <= 1}
        aria-label={t("product.decreaseQuantity")}
        className={`${button} rounded-full text-[#0a285a] disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <Minus className={icon} aria-hidden />
      </button>
      {compact ? (
        /*
          The count is Latin digits in both languages — Gulf storefronts price in
          Western digits even in Arabic copy — so it is isolated rather than left
          to the paragraph's direction.
        */
        <span aria-live="polite" className="min-w-7 text-center text-[13px] font-bold text-[#1f2229]">
          <bdi dir="ltr">{value}</bdi>
        </span>
      ) : (
        <TypedCount value={value} ceiling={ceiling} disabled={disabled} onChange={next => onChange(next)} />
      )}
      <button
        type="button"
        onClick={() => onChange(current => Math.min(ceiling, current + 1))}
        disabled={disabled || value >= ceiling}
        aria-label={t("product.increaseQuantity")}
        className={`${button} rounded-full text-[#0a285a] disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <Plus className={icon} aria-hidden />
      </button>
    </div>
  );
}

/**
 * The number between the minus and the plus, as a box — the cart line's own
 * (`LineQuantity` in `BagDrawer.tsx`): a press selects the number and opens the
 * number keypad, and what is typed is the count on Enter or on leaving the box,
 * read by `typedQuantity` (Arabic-Indic digits folded, over what there is held
 * to it and said). Here nothing is in the bag yet, so zero or nothing typed
 * puts the number back rather than taking a line out; Escape does the same.
 */
function TypedCount({ value, ceiling, disabled, onChange }: { value: number; ceiling: number; disabled: boolean; onChange: (next: number) => void }) {
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
    if (!typed || typed.kind === "remove") return;
    if (typed.capped) toast(ceiling < MAX_LINE_QUANTITY ? t("cart.onlyAvailable", { count: ceiling }) : t("cart.atMost", { count: String(MAX_QUANTITY) }));
    if (typed.quantity !== value) onChange(typed.quantity);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      enterKeyHint="done"
      autoComplete="off"
      disabled={disabled}
      aria-label={t("product.quantity")}
      value={draft ?? String(value)}
      onFocus={event => {
        setDraft(String(value));
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
      className="line-quantity h-8 w-10 rounded-lg bg-[#0a285a]/[.06] text-center text-[14px] font-extrabold tabular-nums text-[#0a285a] outline-none focus:bg-white focus:ring-2 focus:ring-[#0a285a] disabled:opacity-40 pointer-fine:h-6 pointer-fine:w-8 pointer-fine:text-xs"
    />
  );
}
