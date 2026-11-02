/**
 * The Deals page's shelves, on the owner's word — "add a new deals page just
 * like shown in the image": the picture of a shop's page where what is on
 * offer is laid out a shelf per kind of thing ("Digital cameras", "Instant
 * cameras"), each a sideways row with View all, under the filter chips.
 *
 * Pure, so the web and the app (`DealShelves.swift`, tested on the same
 * cases) cut the same shelves from the same products. Only what is on offer
 * is given here — the page's filters have already narrowed it, and an offer
 * is shown only while its store's discount permit is valid, which the read
 * decided before any of this (`fromInventory`).
 *
 * - **A shelf is a kind of thing**: the product's subcategory, as the server
 *   filed it, within its department. A kind with a single deal is not a
 *   shelf of one card; it joins its department's own shelf, and so does a
 *   product the server filed under no kind.
 * - **The fullest shelves come first**, then the departments' own order, then
 *   each department's order of its kinds; a department's own shelf follows
 *   its kinds, and products in no department NetLet keeps come last.
 * - **The deepest saving leads each shelf** unless the shopper chose an
 *   order, which is kept as given; the shelf shows `DEAL_SHELF_SIZE` and
 *   View all opens the rest.
 */
import type { Product } from "./types.js";
import { DEPARTMENTS } from "./departments.js";
import { subcategoriesOf } from "./subcategories.js";
import { savingPercentOf } from "./placement.js";

/** How many cards a shelf shows before View all. */
export const DEAL_SHELF_SIZE = 12;

/** The fewest deals a kind needs to be a shelf of its own. */
export const MIN_KIND_SHELF = 2;

export type DealShelf = {
  /** Stable: the department's slug and the kind's, or "other". */
  key: string;
  /** The department's slug, or null for products in none NetLet keeps. */
  department: string | null;
  /** The kind's slug within the department, or null for the department's own shelf. */
  subcategory: string | null;
  /** How many deals the shelf holds, before it is cut to `DEAL_SHELF_SIZE`. */
  total: number;
  products: Product[];
};

export function dealShelves(products: Product[], options: { deepestFirst: boolean }): DealShelf[] {
  const departmentOf = (product: Product) => DEPARTMENTS.find(department => department.name === product.productType) ?? null;

  /* First by kind, to see which kinds have enough to stand alone. */
  const byKind = new Map<string, Product[]>();
  for (const product of products) {
    const department = departmentOf(product);
    const kind = department && product.subcategory && subcategoriesOf(department.slug).some(entry => entry.slug === product.subcategory)
      ? product.subcategory
      : null;
    const key = department ? `${department.slug}/${kind ?? ""}` : "other";
    byKind.set(key, [...(byKind.get(key) ?? []), product]);
  }

  /* A kind too small to stand alone joins its department's own shelf. */
  const shelves = new Map<string, Product[]>();
  for (const [key, members] of byKind) {
    const [slug, kind] = key.split("/");
    const shelfKey = key === "other" ? "other" : kind && members.length >= MIN_KIND_SHELF ? key : `${slug}/`;
    shelves.set(shelfKey, [...(shelves.get(shelfKey) ?? []), ...members]);
  }

  const rank = (key: string) => {
    if (key === "other") return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
    const [slug, kind] = key.split("/");
    const department = DEPARTMENTS.find(entry => entry.slug === slug);
    const kinds = subcategoriesOf(slug).map(entry => entry.slug);
    /* The department's own shelf follows its kinds. */
    return [department?.position ?? Number.MAX_SAFE_INTEGER - 1, kind ? kinds.indexOf(kind) : kinds.length];
  };

  return [...shelves.entries()]
    .map(([key, members]): DealShelf => {
      const [slug, kind] = key === "other" ? [null, null] : key.split("/");
      /* Stable: products the saving does not separate keep the order they came in. */
      const ordered = options.deepestFirst
        ? members.map((product, index) => ({ product, index, saving: savingPercentOf(product) }))
          .sort((a, b) => b.saving - a.saving || a.index - b.index)
          .map(entry => entry.product)
        : members;
      return {
        key: key === "other" ? "other" : key.endsWith("/") ? key.slice(0, -1) : key,
        department: slug,
        subcategory: kind || null,
        total: members.length,
        products: ordered.slice(0, DEAL_SHELF_SIZE),
      };
    })
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      const [aDepartment, aKind] = rank(a.department === null ? "other" : `${a.department}/${a.subcategory ?? ""}`);
      const [bDepartment, bKind] = rank(b.department === null ? "other" : `${b.department}/${b.subcategory ?? ""}`);
      return aDepartment - bDepartment || aKind - bKind;
    });
}
