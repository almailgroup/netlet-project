/**
 * Home page structure.
 *
 * The rows carry message keys rather than English sentences: the copy itself
 * lives in `shared/i18n/dictionary`, so the page reads the same in both
 * languages and a missing Arabic string is a type error rather than an English
 * heading appearing on the Arabic storefront.
 */
import type { MessageKey } from "@shared/i18n/dictionary";
import { ALL_DEPARTMENTS, DEPARTMENTS } from "@shared/commerce/departments";

/**
 * The departments, as the home page draws them.
 *
 * Derived rather than written out: this was a second copy of the list in
 * `shared/commerce/departments.ts`, carrying its own tints and message keys,
 * which is exactly the drift that file exists to prevent — a department added
 * in one place and missing from the other. "All" leads, because it is the
 * absence of a filter rather than a department and so is not in the list
 * itself.
 */
export const categoryRail: readonly { key: MessageKey; query: string; color: string }[] = [
  { key: ALL_DEPARTMENTS.label, query: ALL_DEPARTMENTS.query, color: ALL_DEPARTMENTS.tint },
  ...DEPARTMENTS.map(department => ({
    key: department.label,
    query: department.name,
    color: department.tint,
  })),
];

export const homeRailDefinitions = [
  { id: "deals", title: "rail.deals.title", description: "rail.deals.description", treatment: "light" },
  { id: "bestsellers", title: "rail.bestsellers.title", description: "rail.bestsellers.description", treatment: "navy" },
  { id: "popular", title: "rail.popular.title", description: "rail.popular.description", treatment: "light" },
  { id: "newest", title: "rail.newest.title", description: "rail.newest.description", treatment: "navy" },
] as const satisfies readonly { id: string; title: MessageKey; description: MessageKey; treatment: string }[];

export const editorialUpdates = [
  { date: "editorial.delivery.date", title: "editorial.delivery.title", summary: "editorial.delivery.summary" },
  { date: "editorial.edit.date", title: "editorial.edit.title", summary: "editorial.edit.summary" },
  { date: "editorial.guide.date", title: "editorial.guide.title", summary: "editorial.guide.summary" },
] as const satisfies readonly { date: MessageKey; title: MessageKey; summary: MessageKey }[];

/**
 * Footer links carry the category query they select, so "Electronics" in the
 * footer lands on the same filtered view as "Electronics" in the header rail
 * instead of raising a "coming soon" toast.
 */
export const footerGroups = [
  {
    title: "footer.categories",
    links: [
      { key: "category.electronics", query: "Electronics" },
      { key: "category.homeKitchen", query: "Home & Kitchen" },
      { key: "category.beauty", query: "Beauty" },
      { key: "category.style", query: "Style" },
      { key: "category.grocery", query: "Grocery" },
    ],
  },
  {
    title: "footer.shopping",
    links: [
      { key: "footer.allProducts", query: "All" },
      { key: "footer.newArrivals", href: "#newest" },
      { key: "footer.bestsellers", href: "#bestsellers" },
      { key: "footer.savedItems", route: "/saved" },
    ],
  },
  {
    title: "footer.service",
    links: [
      { key: "footer.delivery", route: "/checkout" },
      { key: "footer.returns" },
      { key: "footer.nativeCheckout", route: "/checkout" },
      { key: "footer.contact" },
    ],
  },
  {
    title: "footer.netlet",
    links: [
      { key: "footer.ourStory" },
      { key: "footer.sellWithUs" },
      { key: "footer.kuwaitDelivery", route: "/checkout" },
      { key: "footer.account", route: "/account" },
    ],
  },
] as const satisfies readonly {
  title: MessageKey;
  links: readonly { key: MessageKey; query?: string; href?: string; route?: string }[];
}[];

export const railSupportCardContent = [
  { eyebrow: "support.mornings.eyebrow", title: "support.mornings.title", category: "Home & Kitchen" },
  { eyebrow: "support.tech.eyebrow", title: "support.tech.title", category: "Electronics" },
  { eyebrow: "support.everyday.eyebrow", title: "support.everyday.title", category: "All" },
] as const satisfies readonly { eyebrow: MessageKey; title: MessageKey; category: string }[];

/**
 * The message key for a merchant's department name, when NetLet has one.
 *
 * Product types are merchant-written, so most have no translation and are shown
 * as typed. The six named departments do have one, and showing "Electronics" on
 * the Arabic storefront when "الإلكترونيات" exists would be a gap the shopper
 * reads as an unfinished translation.
 */
export function categoryMessageKey(category: string): MessageKey | null {
  return categoryRail.find((entry) => entry.query === category)?.key ?? null;
}
