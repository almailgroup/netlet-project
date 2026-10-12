/**
 * What a search finds, in what order, and what it meant when it found nothing.
 *
 * Pure and shared, for the reason `matchesSearch` always was: the header's
 * suggestions and the results page must agree, or a suggestion is something
 * "See all results" leaves out.
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
 * brass thing and every lamp; a word matches a token that starts with it,
 * because people search while typing.
 *
 * **A misspelling gets a suggestion, not silence.** When nothing matches,
 * `correctionFor` looks each unknown word up in the catalogue's own words —
 * edit distance, transposition counted as one, so "samsng" and "smasung" are
 * both one away from "samsung" — and the page searches for that and says so.
 * Only the catalogue's words: a dictionary of English would correct a brand
 * into a word nobody sells.
 */
import { DEPARTMENTS } from "./departments.js";
import type { Product } from "./types.js";

/** Lower-cased words, any script, with Arabic-Indic digits read as digits. */
export function tokensOf(text: string | null | undefined): string[] {
  if (!text) return [];
  const folded = [...text].map(character => {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    return character;
  }).join("");
  return folded.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** The product's brand as its specification row states it, if it has one. */
export function brandOf(product: Product): string | null {
  const row = product.attributes.find(attribute => attribute.key === "brand" && attribute.namespace !== "reviews");
  return row?.value.trim() || null;
}

type Field = { weight: number; tokens: string[] };

const WEIGHT = { title: 10, brand: 8, department: 6, tag: 4, variant: 3, description: 1 } as const;

function fieldsOf(product: Product): Field[] {
  const department = DEPARTMENTS.find(entry => entry.name === product.productType);
  return [
    { weight: WEIGHT.title, tokens: tokensOf(product.title) },
    { weight: WEIGHT.brand, tokens: tokensOf(brandOf(product)) },
    /* The department in both languages, so "إلكترونيات" finds a phone typed in English. */
    { weight: WEIGHT.department, tokens: [...tokensOf(product.productType), ...tokensOf(department?.nameAr)] },
    { weight: WEIGHT.tag, tokens: product.tags.flatMap(tokensOf) },
    { weight: WEIGHT.variant, tokens: [...product.variants.flatMap(variant => tokensOf(variant.title)), ...product.options.flatMap(option => option.values.flatMap(tokensOf))] },
    { weight: WEIGHT.description, tokens: tokensOf(product.description) },
  ];
}

/**
 * How well a product answers a search, or 0 when some word is found nowhere.
 * A whole-token match counts in full and a prefix half, so "lamp" ranks the
 * lamp above the "lampshade".
 */
export function searchScore(product: Product, term: string): number {
  const words = tokensOf(term);
  if (words.length === 0) return 1;
  const fields = fieldsOf(product);
  let total = 0;
  for (const word of words) {
    let best = 0;
    for (const field of fields) {
      for (const token of field.tokens) {
        const score = token === word ? field.weight : token.startsWith(word) ? field.weight / 2 : 0;
        if (score > best) best = score;
      }
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

export function matchesSearch(product: Product, term: string): boolean {
  return searchScore(product, term) > 0;
}

/** The products that answer a search, best first; ties keep the order they came in. */
export function rankBySearch(products: Product[], term: string): Product[] {
  return products
    .map((product, index) => ({ product, index, score: searchScore(product, term) }))
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(entry => entry.product);
}

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
 * null when every word is already a catalogue word or nothing is close.
 * Words found as they are stay as typed; only the unknown ones change.
 */
export function correctionFor(term: string, products: Product[]): string | null {
  const words = tokensOf(term);
  if (words.length === 0) return null;
  /* The words people would search for — title, brand, department, tags — with
     how often each appears and the spelling it is most often written in. */
  const vocabulary = new Map<string, { count: number; display: string }>();
  for (const product of products) {
    const sources = [product.title, brandOf(product), product.productType, ...product.tags];
    for (const source of sources) {
      for (const display of source?.match(/[\p{L}\p{N}]+/gu) ?? []) {
        const token = display.toLocaleLowerCase();
        const entry = vocabulary.get(token);
        if (entry) entry.count++;
        else vocabulary.set(token, { count: 1, display });
      }
    }
  }
  const known = (word: string) => [...vocabulary.keys()].some(token => token.startsWith(word));
  let changed = false;
  const corrected = words.map(word => {
    if (known(word)) return word;
    const allowed = tolerance(word);
    let best: { token: string; distance: number; count: number } | null = null;
    for (const [token, entry] of vocabulary) {
      const distance = editDistance(word, token);
      if (distance > allowed) continue;
      if (!best || distance < best.distance || (distance === best.distance && entry.count > best.count)) {
        best = { token, distance, count: entry.count };
      }
    }
    if (!best) return word;
    changed = true;
    return vocabulary.get(best.token)!.display;
  });
  return changed ? corrected.join(" ") : null;
}
