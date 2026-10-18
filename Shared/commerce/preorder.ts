/**
 * Selling something that has not arrived yet.
 *
 * Requirement 3.1.3: "Pre-order products that ship once available." The whole
 * difficulty is one sentence in this repository's own rules — `stock = stock -
 * n WHERE stock >= n` is *the entire safety property*, so a pre-order must not
 * be a way around it. Two shoppers racing for the last item is the case that
 * predicate exists for, and a flag that says "sell anyway" would delete it.
 *
 * **So a pre-order is not an exemption from the predicate; it is a second
 * pool with the same predicate.** A variant carries `preorderStock` — how many
 * the vendor is willing to promise before any exist — and taking one is
 * `preorder_stock = preorder_stock - n WHERE preorder_stock >= n`, exactly the
 * shape of the real take. Nothing about overselling changes: a vendor who
 * promises 50 can sell 50, and the fifty-first shopper is refused by the same
 * mechanism as the one racing for the last item on the shelf.
 *
 * That also makes the allowance the flag. There is no separate boolean,
 * because "may be pre-ordered" and "has some pre-order allowance left" are the
 * same question, and two columns that must agree eventually do not.
 *
 * **A line is wholly stocked or wholly pre-ordered, never split.** Three in the
 * warehouse and an order for five is refused rather than served as three now
 * and two later. The line is the unit that carries a fulfilment state and a
 * promise to the shopper; splitting it would turn one chosen quantity into two
 * order lines with two different promises, which is not what anybody pressed a
 * button for. Refusing is the same answer a short read already gets.
 */

/** What a variant has, in both pools. `preorderReleaseAt` is when it is expected. */
export type StockLevels = {
  stock: number;
  preorderStock: number;
  preorderReleaseAt: Date | string | null;
};

/**
 * How a quantity would be served, decided once and used by both sides.
 *
 * `refused` rather than a thrown error or a null, because the caller on the
 * client wants to grey out a button and the caller on the server wants to
 * refuse an order, and those are the same decision made in two places.
 */
export type Fulfilment =
  | { kind: "stock" }
  | { kind: "preorder"; releaseAt: Date | null }
  | { kind: "refused" };

/** Which pool a take came from, for handing units back when a later line fails. */
export type Pool = "stock" | "preorder";

function levelOf(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * When it is expected, or null when nothing trustworthy can be said.
 *
 * A date that has already passed is treated as unknown rather than printed.
 * "Ships 3 February" on a page read in September does not inform anybody; it
 * says the shop has stopped paying attention, which costs more trust than
 * admitting the date is not known. The shopper gets "ships as soon as it
 * arrives", which is both vaguer and true.
 */
export function releaseDate(levels: StockLevels, now: Date = new Date()): Date | null {
  const raw = levels.preorderReleaseAt;
  if (raw === null || raw === undefined) return null;
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime() > now.getTime() ? date : null;
}

/**
 * How this quantity would be served: from the shelf, as a pre-order, or not.
 *
 * Stock first, always. A variant with three on the shelf and a pre-order
 * allowance sells the three as ordinary stock — calling that a pre-order would
 * delay a parcel that could have gone out today.
 */
export function fulfilmentFor(levels: StockLevels, quantity: number, now: Date = new Date()): Fulfilment {
  const wanted = levelOf(quantity);
  if (wanted <= 0) return { kind: "refused" };
  if (levelOf(levels.stock) >= wanted) return { kind: "stock" };
  if (levelOf(levels.preorderStock) >= wanted) return { kind: "preorder", releaseAt: releaseDate(levels, now) };
  return { kind: "refused" };
}

/**
 * What the storefront should say about a variant before a quantity is chosen.
 *
 * One unit is the right question to ask, because that is what a card and a
 * product page are announcing: whether this can be bought at all, and under
 * which promise. The quantity stepper then asks `fulfilmentFor` again with the
 * real number.
 */
export function offerFor(levels: StockLevels, now: Date = new Date()): Fulfilment {
  return fulfilmentFor(levels, 1, now);
}

/** Whether a variant can be bought at all, from either pool. */
export function buyable(levels: StockLevels): boolean {
  return levelOf(levels.stock) > 0 || levelOf(levels.preorderStock) > 0;
}

/**
 * The most a shopper may take in one line.
 *
 * The two pools do not add up, because a line cannot draw on both — so the
 * ceiling is the larger of them, not the sum. Offering six when there are
 * three stocked and three promised would produce a refusal at checkout for a
 * quantity the page itself suggested.
 */
export function maxQuantityFor(levels: StockLevels): number {
  return Math.max(levelOf(levels.stock), levelOf(levels.preorderStock));
}
