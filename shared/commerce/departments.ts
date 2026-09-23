/**
 * NetLet's departments.
 *
 * One list, in `shared` rather than in the seed script, because three things
 * have to agree about it and they live on opposite sides of the app: the
 * client turns a department name into a URL with `categorySlug`, the database
 * stores a slug that the category page looks up, and the storefront draws a
 * label, a tint and an icon for each. If those ever disagree, a department
 * link lands on an empty page — so the slug is written here once and
 * `departments.test.ts` proves it is the slug the client would have produced.
 *
 * The client used to keep its own copy of this list, with the tints and the
 * message keys on it, which is the second list this file's whole existence is
 * an argument against. It derives from here now.
 *
 * "All" is deliberately absent from `DEPARTMENTS`. It is the absence of a
 * filter rather than a department, and a category row for it would be a
 * department containing everything. It still needs a label and an icon on the
 * rail, so it is exported beside the list rather than inside it.
 */
import type { MessageKey } from "../i18n/dictionary.js";

/**
 * What a department's icon depicts — a name, never a component, because
 * `shared` is pure and a React import here would end that.
 *
 * Named for the picture rather than for the department, which is the point: a
 * key of `"electronics"` would be the slug again and would let a new
 * department ship with no icon chosen. Naming the drawing forces somebody to
 * pick one, and makes it obvious when two departments would share.
 */
export const DEPARTMENT_ICONS = ["plug", "cooking-pot", "flower", "shirt", "carrot", "grid", "tag"] as const;
export type DepartmentIcon = (typeof DEPARTMENT_ICONS)[number];

export type Department = {
  slug: string;
  /** The catalog name. This is what a product's `productType` is matched against. */
  name: string;
  nameAr: string;
  position: number;
  /** The translated label. Merchant departments have none and are shown as typed. */
  label: MessageKey;
  icon: DepartmentIcon;
  /** The tile ground behind the icon on the home page. */
  tint: string;
};

export const DEPARTMENTS: Department[] = [
  { slug: "electronics", name: "Electronics", nameAr: "إلكترونيات", position: 1, label: "category.electronics", icon: "plug", tint: "#dce5e9" },
  { slug: "home-and-kitchen", name: "Home & Kitchen", nameAr: "المنزل والمطبخ", position: 2, label: "category.homeKitchen", icon: "cooking-pot", tint: "#f5e4c9" },
  { slug: "beauty", name: "Beauty", nameAr: "الجمال", position: 3, label: "category.beauty", icon: "flower", tint: "#f6d9d2" },
  { slug: "style", name: "Style", nameAr: "الأزياء", position: 4, label: "category.style", icon: "shirt", tint: "#e4dfd0" },
  { slug: "grocery", name: "Grocery", nameAr: "البقالة", position: 5, label: "category.grocery", icon: "carrot", tint: "#dce7cf" },
];

/**
 * The query every surface uses for "no department chosen".
 *
 * A string rather than `null` because it travels through the same
 * `selectCategory(query)` path as a real department name, and a union of
 * `string | null` at every call site buys nothing.
 */
export const ALL_DEPARTMENTS = {
  query: "All",
  label: "category.all" as MessageKey,
  icon: "grid" as DepartmentIcon,
  tint: "#dce5e9",
};

/**
 * The icon that stands for a merchant's own department.
 *
 * NetLet does not know what "Pet supplies" looks like, and guessing produces
 * the failure this whole feature exists to fix: a picture that means something
 * else. A label tag says "this is a department" and claims nothing more.
 */
const UNKNOWN_ICON: DepartmentIcon = "tag";

const BY_NAME = new Map(DEPARTMENTS.map(department => [department.name.toLowerCase(), department]));

/** The department NetLet knows by that catalog name, or null for a merchant's own. */
export function departmentByName(query: string): Department | null {
  return BY_NAME.get(query.trim().toLowerCase()) ?? null;
}

/**
 * Which icon to draw beside a department name, for any name at all.
 *
 * Total on purpose: the home rail lists NetLet's departments *and* every
 * product type a merchant has invented, and a lookup that can return nothing
 * puts a fallback at each of the four call sites instead of one here.
 */
export function departmentIcon(query: string): DepartmentIcon {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === ALL_DEPARTMENTS.query.toLowerCase()) return ALL_DEPARTMENTS.icon;
  return departmentByName(query)?.icon ?? UNKNOWN_ICON;
}
