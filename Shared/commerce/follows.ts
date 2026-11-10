/**
 * What a follow on a product asks to be told — the rule `setFollowedProduct`
 * writes by, pure so it is tested apart from the database.
 *
 * **A follow is what was asked for and nothing more.** "Remind me when back in
 * stock" on a sold-out product used to sign the shopper up for price-drop
 * notices too, because a flag the request left out read as on for a new row.
 * A flag left out keeps what the row already says, and on a new row it is off.
 * Both off is no follow at all: the row goes, so the waiting count a store
 * sees is people waiting.
 */
export type FollowFlags = { priceDrop: boolean; backInStock: boolean };

export function followFlags(
  patch: { priceDrop?: boolean; backInStock?: boolean },
  existing: FollowFlags | null | undefined,
): FollowFlags | null {
  const priceDrop = patch.priceDrop ?? existing?.priceDrop ?? false;
  const backInStock = patch.backInStock ?? existing?.backInStock ?? false;
  return priceDrop || backInStock ? { priceDrop, backInStock } : null;
}
