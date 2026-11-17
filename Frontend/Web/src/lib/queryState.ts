/**
 * Whether a read failed with nothing to show for it.
 *
 * React Query keeps the last good answer when asking again fails — returning
 * to a tab, a reconnect, a second request after thirty seconds — and sets
 * `error` beside it. A page that drew its error state on `error` alone threw
 * away what was on screen at the first hiccup: a product page left open and
 * refocused on a flaky phone connection became "Product not found … may be
 * sold out or no longer for sale", which is a claim about the shop, not the
 * network. So what is already drawn stays, and the error is drawn only when
 * there is nothing to show — the first read failed, or the answer on screen is
 * a placeholder (another page's, held while this one was asked) rather than
 * this query's own.
 */
export type ReadState = {
  isError: boolean;
  data?: unknown;
  isPlaceholderData?: boolean;
};

export function failedToLoad(query: ReadState): boolean {
  return query.isError && (query.data === undefined || query.isPlaceholderData === true);
}
