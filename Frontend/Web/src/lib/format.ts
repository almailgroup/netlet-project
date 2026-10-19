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

/*
 * One formatter per language, currency and shape, made once: building an
 * `Intl.NumberFormat` costs more than using one, and a page of product cards
 * built a fresh one for every price on it — about 40ms of the home page's
 * first draw on a mid-range phone.
 */
const formatters = new Map<string, Intl.NumberFormat>();
function formatterFor(locale: LocaleCode, currency: string, whole: boolean): Intl.NumberFormat {
  const key = `${locale}|${currency}|${whole ? 1 : 0}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(NUMBER_LOCALE[locale], {
      style: "currency",
      currency,
      ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

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
    /* NetLet sells in one currency. A bare amount with no code is dinars —
       the fallback was "USD", so a page that forgot the code printed a
       member's saved delivery as "$US 0" on the membership desk. */
    code = options?.currencyCode ?? "KWD";
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
    return formatterFor(options?.locale ?? "en", code, whole).format(amountNum);
  } catch {
    return `$${amountNum.toFixed(0)}`;
  }
}
