/**
 * "KWD 2.400 / kg" — the number that makes two sizes comparable.
 *
 * **It draws nothing for a counted product**, which is every product in the
 * shop today. "KWD 24.375 / each" is the price printed twice, and a line that
 * repeats what is directly above it is noise on every card in the grid. The
 * component returning null rather than the caller checking is deliberate: the
 * decision lives in one place, so a page added later cannot forget it.
 *
 * The arithmetic is `unitPrice` in `Shared/`, in fils, rounded once — a per
 * kilo figure computed in floats reads 2.4000000000000004 on a currency with
 * three decimal places.
 */
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { measureOf, unitPrice, type Measure } from "@shared/commerce/units";
import type { ProductVariant } from "@shared/commerce/types";
import type { MessageKey } from "@shared/i18n/dictionary";

export function UnitPrice({ variant, className = "" }: { variant: ProductVariant; className?: string }) {
  const { t } = useTranslation();
  const money = useMoney();

  const per = unitPrice(variant.price.amount, variant.measure);
  if (!per) return null;

  return (
    <p className={`type-label ink-muted ${className}`}>
      {t("unit.perUnit", {
        price: money({ amount: per.amount, currencyCode: variant.price.currencyCode }),
        unit: t(`unit.${per.unit}` as MessageKey),
      })}
    </p>
  );
}

/**
 * How much of the thing a quantity comes to — "1.5 kg" beside a quantity of 6.
 *
 * Takes a `Measure` rather than a variant, because the caller that needs it
 * most is a cart line, and a cart line is not a variant — it is a frozen
 * record of one. Null for a counted line, which is every line today.
 */
export function MeasureLabel({ measure, quantity, className = "" }: {
  measure: Measure;
  quantity: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const amount = measureOf(measure, quantity);
  if (!amount) return null;
  return (
    <p className={className}>
      {t("unit.amount", { value: amount.value, unit: t(`unit.${amount.unit}` as MessageKey) })}
    </p>
  );
}
