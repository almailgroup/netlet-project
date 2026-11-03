/**
 * The country a shopper shops in — Kuwait, and the rest of the Gulf marked as
 * coming, on the owner's word ("Country" among the quick settings on My
 * Profile; "Kuwait, others coming soon").
 *
 * NetLet sells and delivers in Kuwait alone, so the choice is a fact drawn as
 * a setting: the list shows where the shop is going next, and none of those
 * can be chosen — a country that could be picked and then delivered nothing
 * would be the dead control this shop refuses everywhere else. Each name is
 * the browser's or the phone's own, in the page's language
 * (`Intl.DisplayNames`, `localizedString(forRegionCode:)`).
 */
export const SHOP_COUNTRIES = [
  { code: "KW", open: true },
  { code: "SA", open: false },
  { code: "AE", open: false },
  { code: "QA", open: false },
  { code: "BH", open: false },
  { code: "OM", open: false },
] as const;

export type ShopCountry = (typeof SHOP_COUNTRIES)[number]["code"];

/** The one country the shop runs in today. */
export const HOME_COUNTRY: ShopCountry = "KW";

/** A flag from a country code, by its regional-indicator letters. */
export function flagOf(code: string): string {
  return /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map(letter => 0x1f1e6 + letter.charCodeAt(0) - 65)) : "";
}
