import { useTranslation } from "@/hooks/useTranslation";

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
 *
 * **In Kuwait's time, whoever is reading.** The shop's days are Kuwaiti days —
 * a code's last day, a payout week, a pre-order's release — and formatted in
 * the browser's own zone a date stored at midnight UTC read as the day before
 * to anybody west of Greenwich, an administrator travelling included.
 */
export const SHOP_TIME_ZONE = "Asia/Kuwait";

export function useDateFormat() {
  const { isArabic } = useTranslation();
  return (value: string | Date) =>
    new Date(value).toLocaleDateString(isArabic ? "ar-KW-u-nu-latn" : "en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: SHOP_TIME_ZONE,
    });
}

/**
 * A moment rather than a day — a stock movement, an audit row, a message —
 * on the same rules, with the time on Kuwait's clock.
 */
export function useDateTimeFormat() {
  const { isArabic } = useTranslation();
  return (value: string | Date) =>
    new Date(value).toLocaleString(isArabic ? "ar-KW-u-nu-latn" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: SHOP_TIME_ZONE,
    });
}
