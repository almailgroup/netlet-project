/**
 * How many orders the dispatch board looks back over, for the page to say so.
 *
 * Re-stated on the client rather than imported from `Backend/src/services/dispatch.ts`,
 * because nothing in `Backend/` may reach the browser — and it is a constant
 * about a sentence rather than a rule about money, so the two cannot disagree
 * in a way that costs anybody anything. `ORDER_CEILING` is the one that
 * actually bounds the query.
 */
export const ORDER_CEILING_NOTE = 300;
