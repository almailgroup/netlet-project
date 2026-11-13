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
export const DEPARTMENT_ICONS = [
  "plug", "cooking-pot", "flower", "shirt", "carrot",
  "heart-pulse", "baby", "toy-brick", "trophy", "car", "hammer", "paw", "book",
  "grid", "tag",
] as const;
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
  /** The tile ground behind the icon, where a department has no picture yet. */
  tint: string;
  /**
   * Whether the department's pictures have arrived: its tile's art
   * (`public/departments/<slug>.webp`) and every one of its subcategories'
   * (`public/subcategories/<slug>-<sub>.webp`). Until they have, its tile is
   * its icon on its tint and its subcategories' rows their icons — drawn on
   * purpose, never a broken image or a request for a file that is not there.
   * `subcategoryPictures.test.ts` holds this to the files on disk, so a
   * picture dropped in without the flag, or the flag set without every
   * picture, fails.
   */
  art: boolean;
};

export const DEPARTMENTS: Department[] = [
  { slug: "electronics", name: "Electronics", nameAr: "إلكترونيات", position: 1, label: "category.electronics", icon: "plug", tint: "#dce5e9", art: true },
  { slug: "home-and-kitchen", name: "Home & Kitchen", nameAr: "المنزل والمطبخ", position: 2, label: "category.homeKitchen", icon: "cooking-pot", tint: "#f5e4c9", art: true },
  { slug: "beauty", name: "Beauty", nameAr: "الجمال", position: 3, label: "category.beauty", icon: "flower", tint: "#f6d9d2", art: true },
  { slug: "style", name: "Style", nameAr: "الأزياء", position: 4, label: "category.style", icon: "shirt", tint: "#e4dfd0", art: true },
  { slug: "grocery", name: "Grocery", nameAr: "البقالة", position: 5, label: "category.grocery", icon: "carrot", tint: "#dce7cf", art: true },
  /* The eight added on the owner's word ("add more categories for the
     products; currently there are only five"), after the departments a
     shop like noon or Amazon keeps. Their pictures are the owner's to send. */
  { slug: "health-and-wellness", name: "Health & Wellness", nameAr: "الصحة والعافية", position: 6, label: "category.health", icon: "heart-pulse", tint: "#d6ecea", art: false },
  { slug: "baby", name: "Baby", nameAr: "مستلزمات الرضّع", position: 7, label: "category.baby", icon: "baby", tint: "#f4e1ec", art: false },
  { slug: "toys-and-games", name: "Toys & Games", nameAr: "ألعاب الأطفال", position: 8, label: "category.toys", icon: "toy-brick", tint: "#fbe8c8", art: false },
  { slug: "sports-and-outdoors", name: "Sports & Outdoors", nameAr: "الرياضة والرحلات", position: 9, label: "category.sports", icon: "trophy", tint: "#dbe7f5", art: false },
  { slug: "automotive", name: "Automotive", nameAr: "السيارات", position: 10, label: "category.automotive", icon: "car", tint: "#e2e5eb", art: false },
  { slug: "tools-and-home-improvement", name: "Tools & Home Improvement", nameAr: "الأدوات وتحسين المنزل", position: 11, label: "category.tools", icon: "hammer", tint: "#f1e3d4", art: false },
  { slug: "pet-supplies", name: "Pet Supplies", nameAr: "مستلزمات الحيوانات الأليفة", position: 12, label: "category.pets", icon: "paw", tint: "#ece5d6", art: false },
  { slug: "books-and-stationery", name: "Books & Stationery", nameAr: "الكتب والقرطاسية", position: 13, label: "category.books", icon: "book", tint: "#e7e1f1", art: false },
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
 * NetLet does not know what "Musical instruments" looks like, and guessing produces
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
