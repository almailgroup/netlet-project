/**
 * The currency a shopper reads prices in (`Shared/commerce/currency.ts`),
 * kept on this device — a reading aid, like the language before an account
 * syncs it; nothing is charged by it.
 *
 * One value for the tab with listeners, so every price on the page changes
 * at once when it is switched (`useDisplayCurrency`, `useMoney`).
 */
import { readStored, writeStored } from "@/lib/browserStore";
import { isDisplayCurrency, type DisplayCurrency } from "@shared/commerce/currency";

const KEY = "netlet:currency";
const listeners = new Set<() => void>();

function stored(): DisplayCurrency {
  const value = readStored(KEY);
  return isDisplayCurrency(value) ? value : "KWD";
}

let current: DisplayCurrency = stored();

export function displayCurrency(): DisplayCurrency {
  return current;
}

export function setDisplayCurrency(code: DisplayCurrency) {
  if (code === current) return;
  current = code;
  writeStored(KEY, code);
  for (const listener of listeners) listener();
}

export function subscribeDisplayCurrency(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Whether a page's figures may be shown converted. Shopping is; a record is
 * not — an order, an invoice, points, the portal — and neither is checkout,
 * where the dinar figure is the one charged and the converted total is said
 * beside it. Help finds orders, selling quotes commission, returns are money
 * owed: all in dinars.
 */
export function convertsOn(path: string): boolean {
  return !/^\/(account|invoices|admin|checkout|sell|help|returns|seller-agreement)(\/|$)/.test(path);
}
