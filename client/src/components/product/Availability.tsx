/**
 * What a shopper is told about getting the thing.
 *
 * Three answers, and one component so that the product page, the card and
 * Quick View cannot give different ones about the same variant: on the shelf,
 * promised for later, or not available at all.
 *
 * **A pre-order says so everywhere the buy button appears.** The button works
 * — `availableForSale` is true for a variant whose only pool is the allowance
 * — so without this a shopper presses "Add to cart" on something that does not
 * exist yet and finds out when the parcel does not come. That is the same
 * dishonesty this codebase already refuses from a Publish button that quietly
 * produces "In review".
 *
 * The date is spelled out and only shown when it is in the future.
 * `shared/commerce/preorder.ts` has already nulled a date that has passed, so
 * there is no stale-date branch here: an absent date becomes "as soon as it
 * arrives", which is vaguer and true.
 */
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import type { ProductVariant } from "@shared/commerce/types";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useTranslation } from "@/hooks/useTranslation";

/** The line under the price: one sentence about whether this can be had. */
export function AvailabilityLine({ variant, size = "base" }: {
  variant: ProductVariant | null | undefined;
  size?: "base" | "small";
}) {
  const { t } = useTranslation();
  const formatDate = useDateFormat();

  const text = size === "small" ? "text-[13px]" : "text-sm";
  const icon = size === "small" ? "size-4" : "size-[18px]";

  if (!variant?.availableForSale) {
    return (
      <p className={`flex items-center gap-2 font-semibold text-[#b3261e] ${text}`}>
        <XCircle className={icon} aria-hidden />
        {t("product.outOfStock")}
      </p>
    );
  }

  if (variant.preorder) {
    return (
      <p className={`flex items-center gap-2 font-semibold ink-accent ${text}`}>
        <Clock className={icon} aria-hidden />
        {variant.preorder.releaseAt
          ? t("product.preorderShips", { date: formatDate(variant.preorder.releaseAt) })
          : t("product.preorderShipsUnknown")}
      </p>
    );
  }

  return (
    /* #2f5d33 at 7.68:1, not #28a745 at 3.13:1 — the darkening the rest of the
       storefront already took. The product page was the one place still on the
       lighter green. */
    <p className={`flex items-center gap-2 font-semibold text-[#2f5d33] ${text}`}>
      <CheckCircle2 className={icon} aria-hidden />
      {t("product.inStock")}
    </p>
  );
}

/**
 * The corner flag on a card, so a rail reads at a glance.
 *
 * Nothing at all for an ordinary variant, by the same rule the cart badge
 * follows: a marker that is always there stops being read.
 */
export function PreorderBadge({ variant, className = "" }: {
  variant: ProductVariant | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!variant?.preorder) return null;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-[#fde8df] px-2 py-0.5 text-[10px] font-extrabold ink-accent ${className}`}>
      <Clock className="size-3 shrink-0" aria-hidden />
      {t("product.preorder")}
    </span>
  );
}

/**
 * The verb on the button.
 *
 * "Add to cart" on something that has not been made yet asks the shopper to
 * discover the difference later. The button says which act it is.
 */
export function buyLabelFor(variant: ProductVariant | null | undefined): "product.preorderAction" | "product.addToCart" | "product.unavailable" {
  if (!variant?.availableForSale) return "product.unavailable";
  return variant.preorder ? "product.preorderAction" : "product.addToCart";
}
