/**
 * Which stores sell what a search, a department or a subcategory holds, and
 * in what order — on the owner's word ("when you search for something it
 * would show the stores that sell it at the top", and the stores under a
 * department's subcategories on the Categories page).
 *
 * The rule, pure, so the server's search, its department read and the tests
 * agree: a store comes once however many of the matches it sells; the store
 * selling the most of them comes first; two selling as many are in the order
 * their first match came — for a search, the ranking's order, so the store
 * with the best match wins a tie — and at most `limit` are kept.
 */

/** How many stores a search or a department names at most. */
export const STORES_SELLING_LIMIT = 12;

export type StoreTally = { vendorId: number; matching: number };

export function rankStores(rows: readonly { vendorId: number | null }[], limit = STORES_SELLING_LIMIT): StoreTally[] {
  const tally = new Map<number, StoreTally & { first: number }>();
  rows.forEach((row, index) => {
    if (row.vendorId === null) return;
    const entry = tally.get(row.vendorId);
    if (entry) entry.matching += 1;
    else tally.set(row.vendorId, { vendorId: row.vendorId, matching: 1, first: index });
  });
  return [...tally.values()]
    .sort((a, b) => b.matching - a.matching || a.first - b.first)
    .slice(0, Math.max(0, limit))
    .map(({ vendorId, matching }) => ({ vendorId, matching }));
}
