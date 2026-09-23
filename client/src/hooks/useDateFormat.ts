/**
 * A date in the reader's own language, spelled out rather than numeric.
 *
 * Spelled out because `03/04/2026` is two different days depending on where
 * the reader learned to write dates, and a delivery or a pre-order date is
 * exactly where that ambiguity costs something.
 *
 * Arabic uses Latin digits (`-u-nu-latn`) rather than Arabic-Indic: the rest
 * of the storefront prices, counts and quantities in Latin digits, and one
 * numeral system per page is what keeps a total readable.
 *
 * It lived privately inside `AccountOrders` and was about to be copied a third
 * time, which is what this file is instead.
 */
import { useTranslation } from "@/hooks/useTranslation";

export function useDateFormat() {
  const { isArabic } = useTranslation();
  return (value: string | Date) =>
    new Date(value).toLocaleDateString(isArabic ? "ar-KW-u-nu-latn" : "en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
}
