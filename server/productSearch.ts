/**
 * Search over the whole catalogue, on the server.
 *
 * It used to run in the browser over whatever the page had fetched — the 24
 * newest products in the header's suggestions, the 100 newest on the results
 * page — so the 101st product could not be found by any search at all, and a
 * shop that grew past a hundred quietly stopped answering for most of itself.
 * This reads every published product of an approved store, the rule
 * `publishedCatalog` keeps, and ranks it with `shared/commerce/search.ts`, the
 * same rules the client used, so nothing about *what* matches changed.
 *
 * **Two steps, so a keystroke does not load the catalogue.** SQL narrows to
 * the products whose text contains every word — folded in SQL exactly as
 * `foldText` folds in JavaScript, and through the synonyms — reading only the
 * text columns. The pure ranking then decides, on those few, and only the
 * page's worth of winners is loaded as storefront products. The prefilter is
 * allowed to let through what the ranking drops; it must never drop what the
 * ranking would find, which is why it matches `containedPart` rather than the
 * stem itself.
 *
 * **Both languages, whatever the page.** The prefilter and the ranking read
 * the title and description in Arabic and English both, so an Arabic search
 * finds a product titled in English on the English page and the other way
 * round. What comes back is drawn in the page's language.
 *
 * At most `CANDIDATE_CEILING` products are ranked, newest first, and the
 * answer says so when it hit the ceiling rather than under-reporting in
 * silence — the finance panel's rule.
 */
import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { categories, products, productVariants, vendors } from "../drizzle/schema.js";
import type { LocalePick } from "../shared/commerce/fromInventory.js";
import {
  FOLD_FROM,
  FOLD_MARKS,
  FOLD_TO,
  correctionFromTexts,
  queryWords,
  rankDocs,
  type QueryWord,
  type SearchDoc,
} from "../shared/commerce/search.js";
import type { Product } from "../shared/commerce/types.js";
import { listProductsByIds } from "./catalog.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** The most products one search ranks. */
export const CANDIDATE_CEILING = 1000;
/** The most it hands back: a results page's worth, facets and all. */
export const MAX_RESULTS = 200;

export type SearchAnswer = {
  /** The best of what matched, best first, in the page's language. */
  products: Product[];
  /** How many matched in all, which may be more than `products`. */
  total: number;
  /** The catalogue's spelling of what was searched for, when the words as typed found nothing. */
  correctedTo: string | null;
  /** In a department that had nothing: how many the whole shop has for the same words. */
  elsewhere: number;
  /** The candidates hit `CANDIDATE_CEILING`, so the total is a floor. */
  capped: boolean;
};

const EMPTY: SearchAnswer = { products: [], total: 0, correctedTo: null, elsewhere: 0, capped: false };

/** `%`, `_` and `\` are LIKE's own; a search for "50%" means the characters. */
const likeLiteral = (text: string) => text.replace(/[\\%_]/g, character => `\\${character}`);

/** Folded in SQL as `foldText` folds in JavaScript: lower case, the letter table, the marks. */
const fold = (text: SQL) => sql`regexp_replace(translate(lower(${text}), ${FOLD_FROM}, ${FOLD_TO}), ${FOLD_MARKS}, '', 'g')`;

/** A published product of an approved store, in a department when one is named — `productsInCategory`'s rule. */
function shelfWhere(department: string | null) {
  return and(
    eq(products.status, "published"),
    eq(vendors.status, "approved"),
    department ? or(eq(categories.name, department), sql`${department} = any(${products.tags})`) : undefined,
  );
}

type Row = {
  id: number;
  title: string;
  titleAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  tags: string[];
  attributes: { namespace: string; key: string; value: string }[];
  department: string | null;
  variants: string | null;
};

function docFromRow(row: Row): SearchDoc {
  const brand = row.attributes.find(attribute => attribute.key === "brand" && attribute.namespace !== "reviews")?.value ?? null;
  return {
    title: row.title,
    alternateTitle: row.titleAr,
    brand,
    department: row.department,
    tags: row.tags,
    variants: row.variants ? [row.variants] : [],
    description: row.description,
    alternateDescription: row.descriptionAr,
  };
}

/** The products whose text holds every word somewhere, newest first, up to the ceiling. */
async function candidates(db: Db, words: QueryWord[], department: string | null): Promise<Row[]> {
  const variants = sql<string | null>`(select string_agg(concat_ws(' ', ${productVariants.title}, ${productVariants.options}::text), ' ') from ${productVariants} where ${productVariants.productId} = ${products.id})`;
  const haystack = fold(sql`concat_ws(' ', ${products.title}, ${products.titleAr}, ${products.description}, ${products.descriptionAr}, array_to_string(${products.tags}, ' '), ${products.attributes}::text, ${categories.name}, ${categories.nameAr}, ${variants})`);
  const docs = db
    .select({
      id: products.id,
      title: products.title,
      titleAr: products.titleAr,
      description: products.description,
      descriptionAr: products.descriptionAr,
      tags: products.tags,
      attributes: products.attributes,
      department: categories.name,
      variants: variants.as("variant_text"),
      updatedAt: products.updatedAt,
      haystack: haystack.as("haystack"),
    })
    .from(products)
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(shelfWhere(department))
    .as("docs");
  const rows = await db
    .select({
      id: docs.id,
      title: docs.title,
      titleAr: docs.titleAr,
      description: docs.description,
      descriptionAr: docs.descriptionAr,
      tags: docs.tags,
      attributes: docs.attributes,
      department: docs.department,
      variants: docs.variants,
    })
    .from(docs)
    .where(and(...words.map(word => sql`${docs.haystack} like any (array[${sql.join(word.patterns.map(pattern => sql`${`%${likeLiteral(pattern)}%`}`), sql`, `)}])`)))
    /* Ends on the id, for the reason every capped read here does: a cap decides membership. */
    .orderBy(desc(docs.updatedAt), desc(docs.id))
    .limit(CANDIDATE_CEILING);
  return rows as Row[];
}

async function ranked(db: Db, term: string, department: string | null) {
  const words = queryWords(term);
  if (words.length === 0) return { rows: [] as Row[], capped: false };
  const found = await candidates(db, words, department);
  return { rows: rankDocs(found, docFromRow, term), capped: found.length >= CANDIDATE_CEILING };
}

/** What people search for across the shop — titles, brands, departments, tags — for the misspelling. */
async function vocabulary(db: Db): Promise<string[]> {
  const rows = await db
    .select({ title: products.title, titleAr: products.titleAr, tags: products.tags, attributes: products.attributes, department: categories.name, departmentAr: categories.nameAr })
    .from(products)
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(shelfWhere(null))
    .orderBy(desc(products.updatedAt), desc(products.id))
    .limit(5 * CANDIDATE_CEILING);
  return rows.flatMap(row => [
    row.title,
    row.titleAr ?? "",
    row.department ?? "",
    row.departmentAr ?? "",
    ...row.tags,
    ...row.attributes.filter(attribute => attribute.key === "brand" && attribute.namespace !== "reviews").map(attribute => attribute.value),
  ]);
}

export async function searchCatalogue(request: { q: string; department?: string | null; locale?: LocalePick; limit?: number }): Promise<SearchAnswer> {
  const db = await getDb();
  const term = request.q.trim();
  if (!db || !term) return EMPTY;
  const department = request.department?.trim() || null;
  const limit = Math.min(Math.max(1, request.limit ?? 24), MAX_RESULTS);

  let answer = await ranked(db, term, department);
  let correctedTo: string | null = null;
  if (answer.rows.length === 0) {
    const correction = correctionFromTexts(term, await vocabulary(db));
    if (correction) {
      const corrected = await ranked(db, correction, department);
      if (corrected.rows.length) {
        answer = corrected;
        correctedTo = correction;
      }
    }
  }

  /* A department search that found nothing has not found that NetLet sells none. */
  let elsewhere = 0;
  if (answer.rows.length === 0 && department) {
    elsewhere = (await ranked(db, correctedTo ?? term, null)).rows.length;
    if (!elsewhere) {
      const correction = correctionFromTexts(term, await vocabulary(db));
      if (correction) elsewhere = (await ranked(db, correction, null)).rows.length;
    }
  }

  const top = answer.rows.slice(0, limit).map(row => row.id);
  return {
    products: await listProductsByIds(top, request.locale ?? "en"),
    total: answer.rows.length,
    correctedTo,
    elsewhere,
    capped: answer.capped,
  };
}
