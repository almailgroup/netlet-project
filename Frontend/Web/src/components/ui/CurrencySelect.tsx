/**
 * The currency prices are read in (`Shared/commerce/currency.ts`), on the
 * owner's word: the dinar, the US dollar, the pound, the euro and the Gulf's.
 * Each is named by the browser in the page's language (`Intl.DisplayNames`),
 * with its code beside the name, so nothing here needs a translation of its
 * own. It is the shop's own `Select`; choosing changes every price on the
 * page at once (`useMoney`), and nothing that is charged.
 */
import { Select } from "@/components/ui/Select";
import { useDisplayCurrency } from "@/hooks/useDisplayCurrency";
import { useTranslation } from "@/hooks/useTranslation";
import { pressHaptic } from "@/lib/haptics";
import { DISPLAY_CURRENCIES, isDisplayCurrency } from "@shared/commerce/currency";

export function currencyName(code: string, locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "currency" }).of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

export function CurrencySelect({ className, id, describedBy }: { className?: string; id?: string; describedBy?: string }) {
  const { t, locale } = useTranslation();
  const { code, set } = useDisplayCurrency();
  return (
    <Select
      id={id}
      value={code}
      aria-label={t("currency.title")}
      aria-describedby={describedBy}
      className={className}
      onChange={event => {
        const next = event.target.value;
        if (!isDisplayCurrency(next) || next === code) return;
        pressHaptic();
        set(next);
      }}
    >
      {DISPLAY_CURRENCIES.map(option => (
        <option key={option} value={option}>{currencyName(option, locale)}</option>
      ))}
    </Select>
  );
}
