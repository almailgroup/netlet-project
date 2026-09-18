/**
 * Wishlists: what a shopper wants, and what a stranger holding their phone
 * number is allowed to see of it.
 *
 * Pure, for the reason permissions and commission are pure — but the stake
 * here is different from either. This is the one feature in NetLet where a
 * person who is not signed in, and who NetLet knows nothing about, asks the
 * server a question about somebody else. What comes back is a privacy
 * decision, and a privacy decision you can only exercise by typing a real
 * customer's phone number into a real deployment is one nobody checks.
 *
 * **A phone-number lookup is an enumeration oracle, and that is the whole
 * design problem.** A Kuwaiti mobile number is eight digits: the entire space
 * can be walked. So the thing the lookup returns has to be worth almost
 * nothing to somebody walking it, and that shapes three rules that live here:
 *
 * - A list is private until its owner publishes it. `public` is a decision,
 *   never a default, and `publicView` is the only shape that leaves the
 *   server for a caller who is not the owner.
 * - The answer for "no such customer" and for "that customer publishes
 *   nothing" is the same answer. Distinguishing them turns the lookup into a
 *   way to ask which phone numbers shop here — the same reason sign-in and
 *   password reset reply identically to an address with no account.
 * - Nothing identifying rides along. A display name only if the owner chose
 *   to show one, and never an email, an order, an address, or the existence
 *   of any other list.
 *
 * Throttling is the fourth rule and it cannot live here because it needs a
 * database; `shared/auth/rateLimit.ts` holds the policy and the ceiling for
 * this door is `MAX_LOOKUPS_PER_ADDRESS`.
 */
import type { Product } from "./types.js";

/* ------------------------------------------------------------- the key --- */

/**
 * Kuwait's country code, and the only one this understands.
 *
 * Saying so plainly rather than pretending to a general parser: a normaliser
 * that half-handles international numbers puts two spellings of one person
 * under two keys, and then a gift list is findable at one of them and not the
 * other. A real second country is a real piece of work — number lengths,
 * trunk prefixes, a library — and is worth doing when there is a second
 * country rather than guessed at now.
 */
export const COUNTRY_CODE = "965";

/** Kuwait subscriber numbers are eight digits. Landline or mobile, both fit. */
const LOCAL_DIGITS = 8;

/**
 * One spelling of a phone number, or null if it is not one.
 *
 * `+965 5012 3456`, `00965-50123456`, `965 50123456` and `5012 3456` are one
 * person, and a lookup keyed on the string somebody typed would find them at
 * one spelling and not the others — which reads to the shopper as the feature
 * being broken rather than as their aunt having typed a space.
 *
 * Arabic-Indic digits are folded too. An Arabic keyboard is the obvious way to
 * type a number on an Arabic page, and `٥٠١٢٣٤٥٦` is the same number.
 *
 * The canonical form carries the `+`, because a number stored without its
 * country code is one nobody can dial later.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // Fold Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) onto ASCII first,
  // then drop everything that is not a digit: spaces, dashes, brackets, the +.
  const digits = [...raw.trim()]
    .map(character => {
      const code = character.codePointAt(0) ?? 0;
      if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
      if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
      return character;
    })
    .join("")
    .replace(/\D/g, "");

  // 00965… is how the country code is dialled from a landline here.
  const withoutTrunk = digits.startsWith(`00${COUNTRY_CODE}`) ? digits.slice(2) : digits;
  const local = withoutTrunk.startsWith(COUNTRY_CODE) ? withoutTrunk.slice(COUNTRY_CODE.length) : withoutTrunk;

  if (local.length !== LOCAL_DIGITS) return null;
  return `+${COUNTRY_CODE}${local}`;
}

/** `+96550123456` → `5012 3456`, for showing a number back to its owner. */
export function formatPhone(canonical: string): string {
  const local = canonical.replace(`+${COUNTRY_CODE}`, "");
  if (local.length !== LOCAL_DIGITS) return canonical;
  return `${local.slice(0, 4)} ${local.slice(4)}`;
}

/* ------------------------------------------------------------ the rules --- */

export const VISIBILITIES = ["private", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/**
 * Ceilings, so one account cannot make the lookup table its own storage.
 *
 * Generous enough that no real shopper meets them — a person has a birthday,
 * a wedding and an Eid list, not forty — and low enough that the limits are
 * the thing that fails rather than the database.
 */
export const MAX_LISTS_PER_SHOPPER = 12;
export const MAX_ITEMS_PER_LIST = 200;

/**
 * How long a "somebody is getting this" hold lasts.
 *
 * A claim is not a purchase and this is not a checkout, so it has to expire:
 * an aunt who presses the button and then forgets must not silently block the
 * present forever. Fourteen days is about the distance between deciding on a
 * gift and the occasion it is for.
 */
export const CLAIM_HOLD_DAYS = 14;

export type ClaimState = "available" | "claimed" | "bought";

export type WishlistItemFacts = {
  /** When somebody said they were getting it, if anybody has. */
  claimedAt?: Date | string | null;
  /** Set once a claim became a real order. Never expires. */
  boughtAt?: Date | string | null;
};

const asDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Whether an item is still going spare.
 *
 * The point of the whole mechanic: without it, three relatives buy the same
 * lamp, which is exactly the problem a gift list exists to solve.
 *
 * Bought outranks claimed and never lapses — money changed hands. A claim
 * lapses at `CLAIM_HOLD_DAYS`, which is what keeps an abandoned press from
 * reserving a present for good.
 */
export function claimStateFor(item: WishlistItemFacts, now: Date = new Date()): ClaimState {
  if (asDate(item.boughtAt)) return "bought";
  const claimed = asDate(item.claimedAt);
  if (!claimed) return "available";
  const lapsesAt = claimed.getTime() + CLAIM_HOLD_DAYS * 24 * 60 * 60 * 1000;
  return now.getTime() < lapsesAt ? "claimed" : "available";
}

/**
 * Whether a gift can actually be bought right now.
 *
 * The same two refusals `isRecommendable` makes, for the same reason and with
 * one difference: a sold-out product still *shows* on the list, because it is
 * a wish and the shopper meant it. It simply cannot be pressed. Hiding it
 * would quietly edit somebody's list, and the giver would rather know the
 * thing exists and is gone than never see it.
 */
export function giftableNow(product: Product, item: WishlistItemFacts, now: Date = new Date()): boolean {
  if (claimStateFor(item, now) !== "available") return false;
  const buyable = product.variants.filter(variant => variant.availableForSale);
  if (buyable.length === 0) return false;
  return buyable.some(variant => Number(variant.price.amount) > 0);
}

/* ------------------------------------------------------- what gets sent --- */

/**
 * What the owner sees of their own list.
 *
 * Deliberately *not* the claim state. A list whose owner can watch items go
 * grey is a list that tells them what they are getting for their birthday,
 * which is the one thing the feature must not do — so `claimedAt` never
 * leaves the server towards the owner, and the count of claims does not
 * either. That is why this is a separate shape rather than a superset of
 * `publicView`: the public view knows *more* about claims than the owner's
 * does, which is backwards from how every other permission here works and is
 * exactly the point.
 */
export type OwnerListView = {
  id: number;
  title: string;
  visibility: Visibility;
  itemCount: number;
  /** The shareable phone key, only ever the owner's own. */
  phone: string | null;
  updatedAt: string;
};

/**
 * What a stranger who typed a phone number sees.
 *
 * No email, no account id, no other list, no address, no order. A name only
 * when the owner chose to show one — somebody sharing a gift list usually
 * wants "Noura's birthday" on it, and somebody who does not can leave it off
 * and the page says "This list" instead.
 */
export type PublicListView = {
  /** An opaque share token, never the serial id. See `shareable`. */
  token: string;
  title: string;
  /** Null when the owner did not publish a name. */
  ownerName: string | null;
  items: PublicItemView[];
};

export type PublicItemView = {
  productId: string;
  /** What the owner wanted, in their own words, if they said anything. */
  note: string | null;
  quantity: number;
  state: ClaimState;
  /**
   * Whether *this* viewer is the one holding it.
   *
   * The only fact about a claim that is safe to tell anybody, because it is a
   * fact about them: it says "you took this", never "Salem took this". It is
   * what lets a giver change their mind, and without it the release endpoint
   * would have no caller — a button nobody can see is the dead control rule
   * pointed at an API.
   *
   * False for a signed-out viewer even when they made the claim, because we
   * genuinely cannot tell. They wait out the hold instead; that is the honest
   * cost of not making people register to buy a present.
   */
  claimedByYou: boolean;
};

/**
 * Whether this list may be handed to somebody who typed a phone number.
 *
 * One function rather than an `if` at each call site, because there are three
 * doors onto a list — the lookup, the share token, and the gift action — and a
 * check written three times is a check that goes missing from one of them.
 * The same argument that puts `assertCan` next to each inventory query.
 */
export function shareable(list: { visibility: Visibility }): boolean {
  return list.visibility === "public";
}
