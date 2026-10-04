/**
 * Fulfilled by NetLet (4.2, toward Shiplee): NetLet holds a seller's stock,
 * picks it and packs it.
 *
 * Pure and shared, for the reason every rule here is: what it decides is whose
 * shelf a sold item comes off and who may move it, and the UI must not offer
 * what the API refuses.
 *
 * ## One shelf per variant, never two
 *
 * A variant is held by its seller or by one NetLet centre, and `stock` is the
 * count on *that* shelf. Which is one column — the holding centre's id, null
 * for the seller — rather than a flag and an id that would have to agree. Two pools of ordinary stock would need a rule for which one a
 * sale comes off and a parcel that might leave from either place — the
 * pre-order work already showed that a line which is wholly one thing is the
 * only kind that stays simple. So the first receipt at NetLet **hands the
 * variant over**: the shop sells what NetLet counted in, and whatever the
 * seller still has at their own warehouse is no longer for sale here. The
 * stock history records both moves.
 *
 * ## Only NetLet changes NetLet's count
 *
 * A seller cannot type a number into a shelf they do not stand in front of.
 * Their stock adjustments are refused on a variant NetLet holds; units arrive
 * by an inbound shipment that NetLet counts, and leave by a sale or by NetLet
 * sending them back. What NetLet counts is what is recorded, short or over,
 * because the count is the fact and the announcement was an intention.
 *
 * ## Who ships is frozen on the line
 *
 * A line sold from NetLet's shelf is NetLet's to pick and pack, and that is
 * copied onto the order line at the moment of sale, like the price — handing a
 * variant back to its seller next month must not move last month's parcels.
 * The seller cannot move such a line; NetLet packs it and the delivery company
 * collects it from NetLet's warehouse.
 *
 * ## Activated later
 *
 * The requirement is "built now, activated later", and activation is a fact
 * rather than a flag: sellers can announce stock only once an administrator
 * has recorded a fulfilment centre to send it to. With none, the page says so.
 *
 * No fee is charged. What NetLet charges for holding and packing is a contract
 * nobody has written yet, and a rate invented here would be money taken on a
 * guess; when there is one, it is a payout fee line like a paid placement's.
 */

export const INBOUND_STATUSES = ["announced", "received", "cancelled"] as const;
export type InboundStatus = (typeof INBOUND_STATUSES)[number];

/** How many different variants one inbound shipment may list. */
export const MAX_INBOUND_LINES = 50;
/** The most units of one variant one shipment may announce or receive. */
export const MAX_INBOUND_UNITS = 10_000;

export type InboundProblem = "fulfilment.noLines" | "fulfilment.tooManyLines" | "fulfilment.badQuantity" | "fulfilment.duplicateLine";

/** What is wrong with an announcement, or null. */
export function inboundProblem(lines: readonly { variantId: number; quantity: number }[]): InboundProblem | null {
  if (lines.length === 0) return "fulfilment.noLines";
  if (lines.length > MAX_INBOUND_LINES) return "fulfilment.tooManyLines";
  if (lines.some(line => !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_INBOUND_UNITS)) return "fulfilment.badQuantity";
  if (new Set(lines.map(line => line.variantId)).size !== lines.length) return "fulfilment.duplicateLine";
  return null;
}

/** Whether a counted figure may be recorded: zero is allowed — nothing arrived is a real count. */
export function validCount(received: number): boolean {
  return Number.isInteger(received) && received >= 0 && received <= MAX_INBOUND_UNITS;
}

/** How a receipt compares with what was announced, so both sides see the gap rather than work it out. */
export function receiptGap(expected: number, received: number): { short: number; over: number } {
  return { short: Math.max(0, expected - received), over: Math.max(0, received - expected) };
}

/**
 * Who may move a line along its fulfilment.
 *
 * A line from NetLet's shelf (a centre id frozen on it) is NetLet's: the seller is not holding the box,
 * so their "packed" would be a claim about somebody else's warehouse. An
 * administrator may move either kind — they answer for the whole shop.
 */
export function mayMoveLine(centreId: number | null, actorKind: "admin" | "vendor" | "courier"): boolean {
  return centreId === null || actorKind === "admin";
}

/**
 * A reference a person can read down a phone to the warehouse door, in the
 * order reference's alphabet — no O or 0, no I, 1 or L, no S or 5.
 */
const ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ2346789";
export function inboundReference(when: Date, random: () => number = Math.random): string {
  const day = `${when.getUTCFullYear()}${String(when.getUTCMonth() + 1).padStart(2, "0")}${String(when.getUTCDate()).padStart(2, "0")}`;
  let tail = "";
  for (let index = 0; index < 5; index += 1) tail += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return `IN-${day}-${tail}`;
}
