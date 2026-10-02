/**
 * The feature switchboard (2.3): every advanced feature can be turned off.
 *
 * Pure, and imported by both sides, for the reason the password floor is: the
 * page hides what the API refuses, from one list, so the two cannot disagree
 * about what is switched on.
 *
 * ## What "off" means
 *
 * **A switch closes the door; it never locks anybody in the room.** Turning a
 * feature off refuses *starting* something — a new message, a new return, a new
 * price request — and leaves everything already in motion to finish. A refund
 * a seller owes does not stop being owed because somebody turned returns off,
 * an agreed price is still honoured at checkout, and a thread already open can
 * still be read and answered by the seller. A switch that stranded obligations
 * would be one nobody dared touch, which is the same as not having one.
 *
 * So each feature names its **entries**: the procedures that start something.
 * Those are refused in one place, on the base procedure, by path — the shape
 * `refuseNul` already has, for the same reason: a check added to each router
 * by hand is the arrangement where one gets missed. A feature whose surface is
 * a read rather than an act (a rail, a panel) answers empty instead of
 * refusing, because a shelf that errors is worse than a shelf that is absent.
 *
 * **Absent is on.** A fresh database has no rows and behaves exactly as it did
 * before the switchboard existed; a row is written only when an administrator
 * changes something, and it records who.
 *
 * ## The model switch
 *
 * `ai` has no entries of its own. It is the one switch that reaches every
 * place NetLet sends text to a third-party model — the product assistant, the
 * search refinement, the recommendation ordering and the review queue's model
 * pass — and each of those already falls back to its deterministic answer when
 * no key is configured. Off is that same branch. Every model call spends money
 * at a third party and sends it catalogue text, so "stop all of it, now" has
 * to be one control rather than four.
 */

export const FEATURE_KEYS = [
  "ai",
  "assistant",
  "recommendations",
  "boughtTogether",
  "chat",
  "priceOffers",
  "returns",
  "deliveryRatings",
  "damageClaims",
  "wishlists",
  "giftCards",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureDefinition = {
  /**
   * tRPC paths that start something under this feature, refused while it is
   * off. `server/features.test.ts` fails on a path the router does not have,
   * so a rename cannot quietly leave a switch guarding nothing.
   */
  entries: readonly string[];
  /**
   * Which party the feature mostly faces, so the page can group them. Only
   * presentation: a switch applies to everybody.
   */
  audience: "shopper" | "seller" | "everyone";
};

export const FEATURES: Record<FeatureKey, FeatureDefinition> = {
  ai: { entries: [], audience: "everyone" },
  assistant: { entries: ["assistant.ask"], audience: "shopper" },
  recommendations: { entries: [], audience: "shopper" },
  boughtTogether: { entries: [], audience: "shopper" },
  /* The shopper writing is the entry; the seller answering an open thread is
     finishing one. */
  chat: { entries: ["chat.send"], audience: "everyone" },
  priceOffers: { entries: ["offers.request"], audience: "everyone" },
  returns: { entries: ["orders.requestReturn"], audience: "everyone" },
  deliveryRatings: { entries: ["orders.rateDelivery"], audience: "shopper" },
  damageClaims: { entries: ["orders.claimDamage", "dispatch.claims.file"], audience: "everyone" },
  /* The public surfaces close — the phone lookup above all, which is the one
     part of this feature with an abuse case — while an owner keeps their own
     lists. A claim already made still releases. */
  wishlists: { entries: ["wishlists.create", "wishlists.addItem", "wishlists.findByPhone", "wishlists.byToken", "wishlists.claim"], audience: "shopper" },
  /* Issuing new cards. A card already sold is money somebody holds, and it
     goes on being spendable. */
  giftCards: { entries: ["orders.createGiftCard"], audience: "seller" },
};

export type FeatureStates = Record<FeatureKey, boolean>;

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

/** Every feature on: what a database with no switch rows means. */
export function allOn(): FeatureStates {
  return Object.fromEntries(FEATURE_KEYS.map(key => [key, true])) as FeatureStates;
}

/** The stored rows folded over the default, ignoring keys this build does not know. */
export function resolveStates(rows: readonly { key: string; enabled: boolean }[]): FeatureStates {
  const states = allOn();
  for (const row of rows) if (isFeatureKey(row.key)) states[row.key] = row.enabled;
  return states;
}

const ENTRY_TO_FEATURE: ReadonlyMap<string, FeatureKey> = new Map(
  FEATURE_KEYS.flatMap(key => FEATURES[key].entries.map(path => [path, key] as const)),
);

/** Which feature a procedure path starts something under, or null. */
export function featureForEntry(path: string): FeatureKey | null {
  return ENTRY_TO_FEATURE.get(path) ?? null;
}
