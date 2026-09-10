import type { Money } from "@shared/commerce/types";
import type { LocaleCode } from "@shared/i18n/dictionary";

/**
 * The formatting locale for each language.
 *
 * Arabic uses `ar-KW`, so the currency renders as د.ك rather than the letters
 * KWD — but with `nu-latn` appended, which keeps Western digits. Gulf
 * storefronts price in Western digits even in Arabic copy, and Arabic-Indic
 * numerals on a price would read as unfamiliar rather than as localised.
 */
const NUMBER_LOCALE: Record<LocaleCode, string> = {
  en: "en-US",
  ar: "ar-KW-u-nu-latn",
};

/**
 * Format a Money or raw amount string into a localized currency string.
 * Falls back to `$X` rounding if Intl rejects the currency code.
 */
export function formatMoney(
  value: Money | string | number,
  options?: { currencyCode?: string; locale?: LocaleCode },
): string {
  let amountNum: number;
  let code: string;

  if (typeof value === "object" && value !== null && "amount" in value) {
    amountNum = Number.parseFloat(value.amount);
    code = value.currencyCode;
  } else {
    amountNum = typeof value === "string" ? Number.parseFloat(value) : value;
    code = options?.currencyCode ?? "USD";
  }

  if (Number.isNaN(amountNum)) return "—";

  try {
    // Let Intl use the currency's own precision rather than hard-coding two.
    // The dinar has three decimal places, and Kuwait writes prices that way —
    // capping at two rounds 24.375 to 24.38 on screen while the cart charges
    // 24.375, and a total that does not match the parts is the fastest way to
    // lose a shopper's trust.
    //
    // A whole amount still renders clean: 129, not 129.000.
    const whole = amountNum % 1 === 0;
    return new Intl.NumberFormat(NUMBER_LOCALE[options?.locale ?? "en"], {
      style: "currency",
      currency: code,
      ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
    }).format(amountNum);
  } catch {
    return `$${amountNum.toFixed(0)}`;
  }
}
