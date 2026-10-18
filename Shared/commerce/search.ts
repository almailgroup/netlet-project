/**
 * What a search finds, in what order, and what it meant when it found nothing.
 *
 * Pure and shared: the server ranks the whole catalogue with it
 * (`Backend/src/services/productSearch.ts`), the demo build ranks its fixtures with it, and
 * the header's suggestions and the results page read the same answers — a
 * suggestion is never something "See all results" then leaves out.
 *
 * **The words are weighed by where they are found.** A word in the title is
 * worth more than one in the brand, the brand more than the department, and
 * the description least — so "phone" ranks phones above a food processor
 * whose description mentions a phone holder. **The seller's name is not
 * searched at all.** "Phone store Hawally" sells a Philips food processor, and
 * every word of a store's name matched every product in it: a search for
 * "phone" answered with the shop's whole shelf.
 *
 * **Every word must be found somewhere**, so "brass lamp" does not match every
 * brass thing and every lamp; a word matches a word that starts with it,
 * because people search while typing.
 *
 * **Words are compared as people mean them, not as they are spelled.**
 * `foldText` reads Arabic-Indic digits as digits and folds the letter forms
 * Arabic keyboards and spellers disagree on — أ إ آ to ا, ة to ه, ى to ي, ؤ to
 * و, ئ to ي — and drops the vowel marks and the tatweel. `stemWord` then takes
 * the article off an Arabic word (ال, and وال بال فال كال لل) and the sound
 * plural ات, and an English plural off an English one, so "الساعة", "ساعه" and
 * "ساعات" all find "ساعة ذكية", and "watches" finds "Smart watch". Both sides
 * go through the same two functions, so the rule cannot drift between the
 * product and the query. `Backend/src/services/productSearch.ts` folds the same way in SQL.
 *
 * **Both languages, whatever the page.** A product is searched by its title in
 * either language when the seller wrote both, and through `SYNONYM_GROUPS` a
 * shopper's own word — "جوال", "قنفة", "headphones" — finds the seller's.
 * A synonym counts for a little less than the word typed, so the product named
 * in the shopper's own words still comes first.
 *
 * **A misspelling gets a suggestion, not silence.** When nothing matches,
 * `correctionFor` looks each unknown word up in the catalogue's own words —
 * edit distance, transposition counted as one, so "samsng" and "smasung" are
 * both one away from "samsung" — and the page searches for that and says so.
 * Only the catalogue's words: a dictionary of English would correct a brand
 * into a word nobody sells.
 */
import { DEPARTMENTS, type Department } from "./departments.js";
import { SYNONYM_GROUPS } from "./searchSynonyms.js";
import type { Product } from "./types.js";

/* ------------------------------------------------------------- the words --- */

const ARABIC_LETTER = /[؀-ۿ]/;

/**
 * Text as search compares it: Latin digits, lower case, Arabic letter forms
 * folded, vowel marks and tatweel gone. `Backend/src/services/productSearch.ts` does exactly
 * this in SQL (`FOLD_FROM`/`FOLD_TO`/`FOLD_MARKS`), and a test holds the two to
 * the same table.
 */
export const FOLD_FROM = "أإآٱىةؤئ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹ـ";
export const FOLD_TO = "اااايهوي01234567890123456789";
/** The marks folding removes: the harakat, the superscript alef. (The tatweel goes by `FOLD_FROM`.) */
export const FOLD_MARKS = "[ً-ٰٟ]";

const FOLD_MAP = new Map([...FOLD_FROM].map((from, index) => [from, [...FOLD_TO][index] ?? ""]));
const MARKS = new RegExp(FOLD_MARKS, "gu");

export function foldText(text: string | null | undefined): string {
  if (!text) return "";
  return [...text.toLowerCase()].map(character => FOLD_MAP.get(character) ?? character).join("").replace(MARKS, "");
}

/** Lower-cased words, any script, with Arabic-Indic digits read as digits and Arabic letter forms folded. */
export function tokensOf(text: string | null | undefined): string[] {
  return foldText(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

const ARTICLES_LONG = ["وال", "بال", "فال", "كال"];

/**
 * A folded word's stem, which is what two words are compared by.
 *
 * Arabic: the article off the front (ال, and the four prefixed forms, and لل),
 * and the sound feminine plural ات off the end — while at least two letters
 * (three before ات) remain, so a short word is not eaten. Broken plurals are
 * left alone: they are a different word to a machine and a synonym's job.
 *
 * English: the plural off (ies, es after s/x/z/ch/sh, s), then a final y read
 * as i and a final e dropped, so "battery" and "batteries" meet at "batteri",
 * "cookie" and "cookies" at "cooki", "phone" and "phones" at "phon". Short
 * words and anything with a digit are left as they are: "65w", "s26", "bus".
 */
export function stemWord(word: string): string {
  const letters = [...word];
  if (ARABIC_LETTER.test(word)) {
    let stem = word;
    const long = ARTICLES_LONG.find(prefix => stem.startsWith(prefix));
    if (long && letters.length - 3 >= 2) stem = stem.slice(3);
    else if (stem.startsWith("لل") && letters.length - 2 >= 2) stem = stem.slice(2);
    else if (stem.startsWith("ال") && letters.length - 2 >= 2) stem = stem.slice(2);
    if (stem.endsWith("ات") && [...stem].length - 2 >= 3) stem = stem.slice(0, -2);
    return stem;
  }
  if (letters.length <= 3 || /\d/.test(word)) return word;
  let stem = word;
  if (stem.endsWith("ies") && stem.length > 4) stem = `${stem.slice(0, -3)}i`;
  else if (/(?:ss|x|z|ch|sh)es$/.test(stem)) stem = stem.slice(0, -2);
  else if (stem.endsWith("s") && !/(?:ss|us|is)$/.test(stem)) stem = stem.slice(0, -1);
  if (stem.length > 3 && stem.endsWith("y")) stem = `${stem.slice(0, -1)}i`;
  else if (stem.length > 3 && stem.endsWith("e")) stem = stem.slice(0, -1);
  return stem;
}

/** The words of a text as search compares them: folded, split and stemmed. */
export function searchWords(text: string | null | undefined): string[] {
  return tokensOf(text).map(stemWord);
}

/**
 * The part of a stem every spelling of it contains, for the SQL prefilter: the
 * stem itself, less a final i that stood for a y. The prefilter only has to
 * never miss what the ranking would find; the ranking decides.
 */
export function containedPart(stem: string): string {
  return !ARABIC_LETTER.test(stem) && stem.length > 3 && stem.endsWith("i") ? stem.slice(0, -1) : stem;
}

/* -------------------------------------------------------------- synonyms --- */

const GROUP_STEMS: string[][] = SYNONYM_GROUPS.map(group => [...new Set(group.flatMap(member => searchWords(member)))]);
const GROUPS_BY_STEM = new Map<string, number[]>();
GROUP_STEMS.forEach((stems, index) => {
  for (const stem of stems) GROUPS_BY_STEM.set(stem, [...(GROUPS_BY_STEM.get(stem) ?? []), index]);
});

/** The other words for a whole word typed, never for a fragment: "ph" means nothing yet. */
export function synonymsOf(stem: string): string[] {
  const groups = GROUPS_BY_STEM.get(stem) ?? [];
  return [...new Set(groups.flatMap(index => GROUP_STEMS[index]))].filter(other => other !== stem);
}

/** One word of a search: what it is, the other words for it, and what the SQL prefilter looks for. */
export type QueryWord = { stem: string; synonyms: string[]; patterns: string[] };

/** The most words a search reads; anything after is dropped rather than slowing every query. */
export const MAX_QUERY_WORDS = 6;

export function queryWords(term: string): QueryWord[] {
  return [...new Set(searchWords(term))].slice(0, MAX_QUERY_WORDS).map(stem => {
    const synonyms = synonymsOf(stem);
    return { stem, synonyms, patterns: [...new Set([stem, ...synonyms].map(containedPart))] };
  });
}

/* ---------------------------------------------------------- the products --- */

/**
 * What search reads of a product. The server builds one straight from the row,
 * with the title and description in both languages; `docOf` builds one from
 * the storefront's `Product`, which carries the page's language only.
 */
export type SearchDoc = {
  title: string;
  /** The title in the other language, when the seller wrote one. */
  alternateTitle?: string | null;
  brand?: string | null;
  /** The department's canonical name (`productType`). */
  department?: string | null;
  tags: string[];
  /** Variant names and option values: "Black", "256 GB", "XL". */
  variants: string[];
  description?: string | null;
  alternateDescription?: string | null;
};

/** The product's brand as its specification row states it, if it has one. */
export function brandOf(product: Product): string | null {
  const row = product.attributes.find(attribute => attribute.key === "brand" && attribute.namespace !== "reviews");
  return row?.value.trim() || null;
}

export function docOf(product: Product): SearchDoc {
  return {
    title: product.title,
    brand: brandOf(product),
    department: product.productType,
    tags: product.tags,
    variants: [...product.variants.map(variant => variant.title), ...product.options.flatMap(option => option.values)],
    description: product.description,
  };
}

type Field = { weight: number; tokens: string[] };

const WEIGHT = { title: 10, brand: 8, department: 6, tag: 4, variant: 3, description: 1 } as const;
/** What a synonym is worth against the word typed. */
const SYNONYM_SHARE = 0.8;

function fieldsOf(doc: SearchDoc): Field[] {
  const department = DEPARTMENTS.find(entry => entry.name === doc.department);
  return [
    { weight: WEIGHT.title, tokens: [...searchWords(doc.title), ...searchWords(doc.alternateTitle)] },
    { weight: WEIGHT.brand, tokens: searchWords(doc.brand) },
    /* The department in both languages, so "إلكترونيات" finds a phone typed in English. */
    { weight: WEIGHT.department, tokens: [...searchWords(doc.department), ...searchWords(department?.nameAr)] },
    { weight: WEIGHT.tag, tokens: doc.tags.flatMap(searchWords) },
    { weight: WEIGHT.variant, tokens: doc.variants.flatMap(searchWords) },
    { weight: WEIGHT.description, tokens: [...searchWords(doc.description), ...searchWords(doc.alternateDescription)] },
  ];
}

/** How well one word of the query matches one word of the product, as a share of the field's weight. */
function wordMatch(token: string, word: QueryWord): number {
  if (token === word.stem) return 1;
  if (token.startsWith(word.stem)) return 0.5;
  for (const synonym of word.synonyms) {
    if (token === synonym) return SYNONYM_SHARE;
    if ([...synonym].length >= 4 && token.startsWith(synonym)) return SYNONYM_SHARE / 2;
  }
  return 0;
}

/**
 * How well a document answers a search, or 0 when some word is found nowhere.
 * A whole-word match counts in full and a prefix half, so "lamp" ranks the
 * lamp above the "lampshade".
 */
export function scoreDoc(doc: SearchDoc, term: string | QueryWord[]): number {
  const words = typeof term === "string" ? queryWords(term) : term;
  if (words.length === 0) return 1;
  const fields = fieldsOf(doc);
  let total = 0;
  for (const word of words) {
    let best = 0;
    for (const field of fields) {
      for (const token of field.tokens) {
        const score = field.weight * wordMatch(token, word);
        if (score > best) best = score;
      }
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

export function searchScore(product: Product, term: string): number {
  return scoreDoc(docOf(product), term);
}

export function matchesSearch(product: Product, term: string): boolean {
  return searchScore(product, term) > 0;
}

/** Anything that answers a search, best first; ties keep the order they came in. */
export function rankDocs<T>(items: T[], doc: (item: T) => SearchDoc, term: string): T[] {
  const words = queryWords(term);
  return items
    .map((item, index) => ({ item, index, score: scoreDoc(doc(item), words) }))
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(entry => entry.item);
}

/** The products that answer a search, best first; ties keep the order they came in. */
export function rankBySearch(products: Product[], term: string): Product[] {
  return rankDocs(products, docOf, term);
}

/* ------------------------------------------------------------ misspelling --- */

/** Edit distance with an adjacent swap counted as one edit (optimal string alignment). */
export function editDistance(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** How far a word may be from a catalogue word and still be taken as a typo of it. */
function tolerance(word: string): number {
  const length = [...word].length;
  return length < 3 ? 0 : length <= 5 ? 1 : 2;
}

/**
 * The search the shopper probably meant, in the catalogue's own spelling, or
 * null when every word is already a catalogue word (or a synonym of one) or
 * nothing is close. Words found as they are stay as typed; only the unknown
 * ones change. `texts` are what people search for — titles, brands,
 * departments, tags.
 */
export function correctionFromTexts(term: string, texts: (string | null | undefined)[]): string | null {
  const typed = tokensOf(term);
  if (typed.length === 0) return null;
  /* Each word by its folded form, with how often it appears and the spelling it is most often written in. */
  const vocabulary = new Map<string, { count: number; display: string; stem: string }>();
  for (const text of texts) {
    for (const display of text?.match(/[\p{L}\p{N}]+/gu) ?? []) {
      const folded = foldText(display);
      const entry = vocabulary.get(folded);
      if (entry) entry.count++;
      else vocabulary.set(folded, { count: 1, display, stem: stemWord(folded) });
    }
  }
  const stems = [...vocabulary.values()].map(entry => entry.stem);
  const known = (stem: string) => [stem, ...synonymsOf(stem)].some(candidate => stems.some(other => other.startsWith(candidate)));
  let changed = false;
  const corrected = typed.map(word => {
    if (known(stemWord(word))) return word;
    const allowed = tolerance(word);
    let best: { folded: string; distance: number; count: number } | null = null;
    for (const [folded, entry] of vocabulary) {
      const distance = editDistance(word, folded);
      if (distance > allowed) continue;
      if (!best || distance < best.distance || (distance === best.distance && entry.count > best.count)) {
        best = { folded, distance, count: entry.count };
      }
    }
    if (!best) return word;
    changed = true;
    return vocabulary.get(best.folded)!.display;
  });
  return changed ? corrected.join(" ") : null;
}

/** The words of a product people would search for, for `correctionFromTexts`. */
export function vocabularyOf(product: Product): (string | null)[] {
  return [product.title, brandOf(product), product.productType, ...product.tags];
}

export function correctionFor(term: string, products: Product[]): string | null {
  return correctionFromTexts(term, products.flatMap(vocabularyOf));
}

/* ------------------------------------------------- what the dropdown draws --- */

/**
 * A title in pieces, each marked when it is one of the words searched for, so
 * the dropdown can draw the match in bold. Compared by stem, like the search,
 * so "watches" lights "watch" and "الساعة" lights "ساعة".
 */
export function highlightParts(title: string, term: string): { text: string; hit: boolean }[] {
  const words = queryWords(term);
  if (words.length === 0) return [{ text: title, hit: false }];
  return title.split(/([\p{L}\p{N}]+)/u).filter(Boolean).map(text => {
    const stem = searchWords(text)[0];
    return { text, hit: Boolean(stem) && words.some(word => wordMatch(stem, word) > 0) };
  });
}

/** The departments a search names, in either language — "elec", "إلكترون", "بقالة". */
export function departmentsMatching(term: string): Department[] {
  const words = queryWords(term);
  if (words.length === 0) return [];
  return DEPARTMENTS.filter(department => {
    const tokens = [...searchWords(department.name), ...searchWords(department.nameAr)];
    return words.every(word => tokens.some(token => wordMatch(token, word) > 0));
  });
}

/** The brands a search names, from the brands the shop sells. */
export function brandsMatching(term: string, brands: string[]): string[] {
  const words = queryWords(term);
  if (words.length === 0) return [];
  return brands.filter(brand => {
    const tokens = searchWords(brand);
    return words.every(word => tokens.some(token => wordMatch(token, word) > 0));
  });
}
