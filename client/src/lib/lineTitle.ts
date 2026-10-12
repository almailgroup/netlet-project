/**
 * A cart line's name in the page's language.
 *
 * The bag is one read shared by every page and returned by every change to
 * it, so it carries both names and the page picks, rather than the server
 * being told the language on each of a dozen calls. English when the seller
 * wrote no Arabic, as everywhere else.
 */
import type { CartDeliveryLine, CartItem } from "@shared/commerce/types";

export function lineTitle(item: Pick<CartItem, "productTitle" | "productTitleAr">, isArabic: boolean): string {
  return (isArabic && item.productTitleAr) || item.productTitle;
}

/** A delivery row's store, by the same rule. */
export function storeName(row: Pick<CartDeliveryLine, "vendorName" | "vendorNameAr">, isArabic: boolean): string {
  return (isArabic && row.vendorNameAr) || row.vendorName;
}
