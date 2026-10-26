/**
 * An address book, and a parcel per destination.
 *
 * Requirement 3.2.6: "different address per product". A basket is already
 * allowed to span three sellers; this lets it span two doors — the sofa to the
 * flat and the gift to the office, bought in one go rather than in two orders
 * placed a minute apart.
 *
 * Pure, and in `shared`, because what it decides is money: a seller shipping to
 * two places packs two parcels, and how that is charged is not a detail the
 * checkout page may decide on its own.
 *
 * ## The rules
 *
 * **A parcel is a seller and a destination, not a seller.** `quoteDelivery`
 * has charged per seller since delivery landed, on the grounds that three
 * shops are three warehouses. Two doors are two journeys from the same
 * warehouse, and charging one fee for both would be NetLet handing a seller's
 * van out for free.
 *
 * **The free-over threshold is measured per destination too.** KWD 15 to home
 * and KWD 15 to the office is not KWD 30 toward one seller's KWD 20 threshold:
 * that would buy two deliveries with one threshold, which is the same money the
 * per-basket rule already refuses to spend. The shortfall line names the
 * destination, because a threshold nobody can see is a higher price with a
 * rumour attached — and with two destinations in play it also has to say
 * *which* one is short.
 *
 * **A line with no destination goes wherever the order goes.** Null is the
 * default rather than the unknown, so a shopper who never opens the control
 * places exactly the order they always did, and an address deleted afterwards
 * leaves a cart line pointing at the order's own address rather than nowhere.
 *
 * **The book belongs to an account.** An anonymous bag has no owner, so it has
 * nowhere to keep a second address and nothing to attach a line to — the same
 * reason a price a seller agreed with a shopper is never granted to a guest.
 * Checkout's own typed address is the whole answer there, untouched.
 */
import { normalisePhone } from "./wishlist.js";
import { kuwaitDeliveryZones } from "../customer.js";
import type { MessageKey } from "../i18n/dictionary.js";
import { pinProblem, storedPin, type Pin } from "./geo.js";
import { cleanParts, composeAddressLine, hasParts, missingParts, partsProblems, type AddressParts } from "./kuwaitAddress.js";

/**
 * A ceiling, so the book stays a book.
 *
 * Twelve is far more than a household needs and few enough that the picker at
 * checkout is still a list somebody reads rather than scrolls. Without one,
 * an address book is free storage attached to a free account.
 */
export const MAX_ADDRESSES = 12;

export const MAX_LABEL = 40;
export const MAX_LINE = 300;
export const MAX_NOTES = 300;

/** One place a parcel can go, as the shopper recorded it. */
export type ShippingAddress = {
  /** What the shopper calls it — "Home", "المكتب". Their words, not a type. */
  label: string;
  contactName?: string | null;
  contactPhone?: string | null;
  /** One of the six governorates, by the id in `Shared/customer.ts`. */
  governorate?: string | null;
  addressLine?: string | null;
  addressNotes?: string | null;
  /** Exactly where, if the shopper dropped a pin (3.2.7). Optional, always. */
  pin?: Pin | null;
  /**
   * Area, block, street, house and the rest (`kuwaitAddress.ts`). When given,
   * the line is composed from them; an address with only a line — every one
   * saved before parts existed — is still an address.
   */
  parts?: AddressParts | null;
};

/** The line drawn for a reader: the parts in their language when there are parts, else the stored line. */
export function addressLineIn(address: Pick<ShippingAddress, "addressLine" | "parts">, arabic: boolean): string {
  return hasParts(address.parts) ? composeAddressLine(address.parts, arabic) : (address.addressLine ?? "").trim();
}

/** The line an address carries: composed from its parts when it has them, else as typed. */
export function addressLineOf(address: Pick<ShippingAddress, "addressLine" | "parts">): string {
  return hasParts(address.parts) ? composeAddressLine(address.parts) : (address.addressLine ?? "").trim();
}

/**
 * What is *actively wrong*, as message keys.
 *
 * The same split the seller application makes, and for the same reason: a save
 * refuses only what cannot be true, and everything merely absent is reported on
 * the page rather than blocked at the door. An address with no notes is an
 * ordinary address; an address with a phone number that is not a phone number
 * is a parcel nobody can be called about.
 *
 * A label and a line are the two it cannot exist without — a book of addresses
 * all reading "Address" is a picker nobody can use, and a destination with no
 * street is not a destination.
 */
export function addressProblems(address: ShippingAddress): MessageKey[] {
  const problems: MessageKey[] = [];

  if (!address.label?.trim()) problems.push("address.needsLabel");
  else if (address.label.trim().length > MAX_LABEL) problems.push("address.labelTooLong");

  const line = addressLineOf(address);
  if (!line) problems.push("address.needsLine");
  else if (line.length > MAX_LINE) problems.push("address.lineTooLong");

  /* Given as parts, a driver needs the area, block, street and house of it. */
  if (hasParts(address.parts)) {
    if (missingParts(address.parts).length) problems.push("address.needsParts");
    problems.push(...partsProblems(address.parts));
  }

  if ((address.addressNotes ?? "").trim().length > MAX_NOTES) problems.push("address.notesTooLong");

  const zone = address.governorate?.trim();
  if (zone && !kuwaitDeliveryZones.some(area => area.id === zone)) problems.push("address.unknownZone");

  const phone = address.contactPhone?.trim();
  if (phone && !normalisePhone(phone)) problems.push("address.badPhone");

  /* Absent is ordinary; present and wrong is a parcel sent somewhere else. */
  const pinIssue = address.pin ? pinProblem(address.pin) : null;
  if (pinIssue) problems.push(pinIssue);

  return problems;
}

/**
 * What is merely missing, for the page to say so.
 *
 * A governorate and a phone are how a parcel is routed and how a driver asks
 * where the building is. Neither blocks a save — the direction
 * `missingStoreDetails` and the return window both err in — and both are worth
 * a line on the card.
 */
export function missingFromAddress(address: ShippingAddress): MessageKey[] {
  const missing: MessageKey[] = [];
  if (!address.governorate?.trim()) missing.push("address.noZone");
  if (!address.contactPhone?.trim()) missing.push("address.noPhone");
  if (!address.contactName?.trim()) missing.push("address.noName");
  return missing;
}

/** Whether this address can be saved at all. */
export function addressAcceptable(address: ShippingAddress): boolean {
  return addressProblems(address).length === 0;
}

/* ----------------------------------------------- a parcel per destination --- */

/**
 * How a destination is identified while a basket is being priced.
 *
 * A number for a saved address, and null for "wherever the order goes" — which
 * is its own destination rather than the absence of one, because the parcel
 * still has to be paid for.
 */
export type DestinationId = number | null;

/** A line, reduced to what deciding the parcels needs. */
export type DestinedLine = {
  vendorId: number | null;
  vendorName: string;
  destinationId: DestinationId;
  /** What the shopper calls this destination. Null for the order's own. */
  destinationLabel: string | null;
  /** What this line is worth to that seller, goods and extras together. */
  value: string;
  /** The trip the shopper chose for it (3.2.5); absent is regular. */
  choice?: "regular" | "fast";
};

/**
 * A stable key for one parcel.
 *
 * Both halves are spelled into it rather than concatenated loosely, so a seller
 * with id 1 going to address 12 cannot collide with seller 11 going to address
 * 2 — the same reason browse facets are namespaced `opt.<name>`.
 *
 * The destination may be an id while a basket is being priced, or the frozen
 * address itself once an order exists and there is no id left to point at.
 * Both spell into the same key, so pricing and dispatch group a basket the
 * same way rather than each inventing its own notion of "the same door".
 */
export function parcelKey(vendorId: number | null, destination: DestinationId | string): string {
  return `v${vendorId ?? "none"}|d${destination ?? "order"}`;
}

/**
 * How many distinct doors this basket is going to.
 *
 * Counted so a page can stay silent when there is only one: a checkout that
 * explains per-destination delivery to somebody sending everything home is
 * explaining a rule that has not applied to them.
 */
export function destinationCount(lines: DestinedLine[]): number {
  return new Set(lines.map(line => line.destinationId ?? "order")).size;
}

/**
 * Whether any seller in this basket is being asked for two parcels.
 *
 * This is the case the extra fee appears in, and the one worth a sentence on
 * the page — a shopper who sent two different sellers' goods to two different
 * doors pays exactly what they always would have.
 */
export function splitAcrossSeller(lines: DestinedLine[]): boolean {
  const seen = new Map<string, Set<string>>();
  for (const line of lines) {
    const key = `v${line.vendorId ?? "none"}`;
    const doors = seen.get(key) ?? new Set<string>();
    doors.add(String(line.destinationId ?? "order"));
    seen.set(key, doors);
  }
  return [...seen.values()].some(doors => doors.size > 1);
}

/**
 * The destination frozen onto an order line.
 *
 * Copied rather than referenced, for the reason the price and the commission
 * rate are: an address edited in March must not rewrite where a parcel was sent
 * in September, and an address deleted must not leave an order unable to say
 * where it went.
 *
 * Null on a line that went wherever the order went, which is nearly all of
 * them — the order's own address columns already say where that was, and
 * copying them onto every line would be storing one fact twice.
 */
export type FrozenDestination = {
  label: string;
  contactName: string | null;
  contactPhone: string | null;
  governorate: string | null;
  addressLine: string | null;
  addressNotes: string | null;
  /**
   * Optional rather than nullable-and-required, because every line frozen
   * before pins existed has none, and reads as "no pin" rather than missing.
   */
  pin?: Pin | null;
  /** The parts, for the same reason: absent on everything frozen before them. */
  parts?: AddressParts | null;
};

/** An address, reduced to what an order needs to remember about it. */
export function freezeDestination(address: ShippingAddress): FrozenDestination {
  return {
    label: address.label.trim(),
    contactName: address.contactName?.trim() || null,
    contactPhone: address.contactPhone?.trim() || null,
    governorate: address.governorate?.trim() || null,
    addressLine: addressLineOf(address) || null,
    addressNotes: address.addressNotes?.trim() || null,
    pin: storedPin(address.pin),
    parts: cleanParts(address.parts),
  };
}
