/**
 * The product page's and the preview's price, for the quantity chosen — on
 * the owner's word: "the main price should update automatically based on the
 * selected quantity … clearly display the individual unit price below or
 * beside the total price". `priceForQuantity` (`Shared/commerce/
 * quantityPrice.ts`) is the arithmetic, in fils; this draws it.
 *
 * - **The headline is the total**, extras ticked included, with the was-price
 *   for the same many struck beside it and the product's own saving badge.
 * - **The unit line is always there**, at one too: drawn only from two, it
 *   would push the stepper down under the thumb pressing its plus.
 * - **On a phone the struck price and the badge always sit on a line of their
 *   own** under the total (`basis-full` below `sm`). Beside it, a total that
 *   gained a digit as the quantity rose wrapped them to a second line at some
 *   press and not the one before, moving everything below — the stepper with
 *   it. From `sm` there is room for all three on one line at any total.
 * - **A screen reader hears the new total** as the quantity or the option
 *   changes: a polite live region, visually hidden, saying "Total for 3:
 *   KWD 37.500". Present from the first draw, so arriving says nothing.
 */
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { unitLineKey, type QuantityPrice } from "@shared/commerce/quantityPrice";
import type { MessageKey } from "@shared/i18n/dictionary";

export function QuantityPriceBlock({ quote, savings, tone, className = "" }: {
  quote: QuantityPrice;
  /** The product's own saving, in whole percent; zero draws no badge. */
  savings: number;
  tone: "page" | "preview";
  className?: string;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const page = tone === "page";
  const step = quote.step ? `${quote.step.value} ${t(`unit.${quote.step.unit}` as MessageKey)}` : "";
  const unitLine = t(unitLineKey(quote), { count: String(quote.quantity), price: money(quote.unit), step });

  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={page
            ? "text-[32px] font-extrabold leading-tight tracking-[-.04em] text-[#1f2229]"
            : "text-[28px] font-extrabold leading-none tracking-[-.03em] text-[#0a285a] lg:text-[32px]"}
        >
          {money(quote.total)}
        </span>
        {quote.wasTotal || savings > 0 ? (
          <span className="flex basis-full flex-wrap items-baseline gap-x-3 gap-y-1 sm:basis-auto">
            {quote.wasTotal ? <span className={`${page ? "text-lg" : "text-[15px]"} ink-muted line-through`}>{money(quote.wasTotal)}</span> : null}
            {savings > 0 ? (
              <span className={`${page ? "rounded-sg px-2.5 py-1 text-xs" : "rounded-full px-2.5 py-0.5 text-[13px]"} bg-[#d4edda] font-bold text-[#155724]`}>
                {t("product.savePercent", { percent: savings })}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      <p className={`${page ? "mt-1.5 text-[15px]" : "mt-2 text-[14px]"} font-semibold ink-muted`}>{unitLine}</p>
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {t("product.totalFor", { count: String(quote.quantity), price: money(quote.total) })}
      </p>
    </div>
  );
}
