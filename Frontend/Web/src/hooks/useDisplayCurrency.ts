/**
 * The display currency and the day's rates (`Shared/commerce/currency.ts`).
 * The rates are asked for only once somebody has chosen a currency other
 * than the dinar, and the reference table stands in until they arrive, so a
 * price is never held back for them.
 */
import { convertsOn, displayCurrency, setDisplayCurrency, subscribeDisplayCurrency } from "@/lib/displayCurrency";
import { trpc } from "@/lib/trpc";
import { REFERENCE_RATES, RATES_AS_OF, type DisplayCurrency, type Rates } from "@shared/commerce/currency";
import { useSyncExternalStore } from "react";
import { useLocation } from "wouter";

export type DisplayCurrencyState = {
  code: DisplayCurrency;
  rates: Rates;
  asOf: string;
  set: (code: DisplayCurrency) => void;
};

export function useDisplayCurrency(): DisplayCurrencyState {
  const code = useSyncExternalStore(subscribeDisplayCurrency, displayCurrency, () => "KWD" as DisplayCurrency);
  const rates = trpc.commerce.currencyRates.useQuery(undefined, {
    enabled: code !== "KWD",
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  return {
    code,
    rates: rates.data?.rates ?? REFERENCE_RATES,
    asOf: rates.data?.asOf ?? RATES_AS_OF,
    set: setDisplayCurrency,
  };
}

/** The currency this page's prices are shown in, or null for dinars as they are. */
export function useShownCurrency(): DisplayCurrencyState | null {
  const [path] = useLocation();
  const state = useDisplayCurrency();
  return state.code === "KWD" || !convertsOn(path) ? null : state;
}
