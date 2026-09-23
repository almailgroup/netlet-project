/**
 * Where a line is, on its way to the shopper.
 *
 * One list, imported by the schema's enum, the router's input and the page
 * that draws the control — so a state cannot exist in one of the three and not
 * the others. It is here rather than in `drizzle/schema.ts` because `shared/`
 * is what both sides may import, and the client needs the order of these to
 * draw them in.
 *
 * Fulfilment lives on the **line**, never on the order: a basket spanning
 * three sellers can be fully paid while two of them have shipped nothing, and
 * partial shipment within one seller — two items, one on the shelf — is
 * ordinary. That is the same split `order_items` was built around.
 */
export const FULFILMENT_STATES = [
  "pending",
  "preparing",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
] as const;

export type FulfilmentState = (typeof FULFILMENT_STATES)[number];

/**
 * The states a line may be moved to next, from where it is.
 *
 * Forward along the road, plus the two ways out. It is deliberately not a
 * strict machine: a seller who marked the wrong line shipped has to be able to
 * put it back, and a rule that refuses them turns a mis-click into a support
 * request. What it stops is the nonsense — a returned line becoming
 * "preparing" — while leaving every correction somebody might actually need.
 */
export function nextStates(from: FulfilmentState): FulfilmentState[] {
  if (from === "returned") return [];
  if (from === "cancelled") return ["pending"];
  return FULFILMENT_STATES.filter(state => state !== from && state !== "returned");
}

/** Whether a line is finished, one way or the other. */
export function isSettled(state: FulfilmentState): boolean {
  return state === "delivered" || state === "cancelled" || state === "returned";
}
