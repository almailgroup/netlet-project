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
 * **Absent is the feature's default**, and for almost every feature that is on:
 * a fresh database behaves exactly as it did before the switchboard existed, a
 * row is written only when an administrator changes something, and it records
 * who. A few start **off** — the app banner, Subscribe & Save and the try-on —
 * because nothing a shopper can use is behind them yet on a shop
 * that has not set them up (an app that is not published, a scheduler nobody
 * has configured), or because switching one on is a decision (the try-on sends
 * a shopper's photo to Google).
 * Hidden behind a switch rather than deleted, so turning one on is a press on
 * `/admin/features` rather than a release.
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
  "priceOffers",
  "returns",
  "deliveryRatings",
  "damageClaims",
  "wishlists",
  "giftCards",
  "affiliates",
  "ads",
  "subscriptions",
  "fulfilment",
  "membership",
  "voiceSearch",
  "photoSearch",
  "appBanner",
  "articles",
  "tryOn",
  "cashOnDelivery",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureDefinition = {
  /**
   * tRPC paths that start something under this feature, refused while it is
   * off. `Backend/src/services/features.test.ts` fails on a path the router does not have,
   * so a rename cannot quietly leave a switch guarding nothing.
   */
  entries: readonly string[];
  /**
   * Which party the feature mostly faces, so the page can group them. Only
   * presentation: a switch applies to everybody.
   */
  audience: "shopper" | "seller" | "everyone";
  /** What the feature is with no row stored. On, except for the few listed above. */
  defaultOn: boolean;
};

export const FEATURES: Record<FeatureKey, FeatureDefinition> = {
  ai: { entries: [], audience: "everyone", defaultOn: true },
  /* Cash at the door for the whole shop (3.2.2: "the ability to disable it
     administratively"). Asked where cash is decided (`codAvailability`), not
     by entry: off, checkout says cash is not taken and refuses a cash order,
     and an order already placed in cash is still collected. */
  cashOnDelivery: { entries: [], audience: "shopper", defaultOn: true },
  /* The shop assistant: the chat button, a product page's "Ask about this
     product" and the help page's question box, all one gateway token. */
  assistant: { entries: ["ai.chatSession"], audience: "shopper", defaultOn: true },
  recommendations: { entries: [], audience: "shopper", defaultOn: true },
  boughtTogether: { entries: [], audience: "shopper", defaultOn: true },
  priceOffers: { entries: ["offers.request"], audience: "everyone", defaultOn: true },
  returns: { entries: ["orders.requestReturn"], audience: "everyone", defaultOn: true },
  deliveryRatings: { entries: ["orders.rateDelivery"], audience: "shopper", defaultOn: true },
  damageClaims: { entries: ["orders.claimDamage", "dispatch.claims.file"], audience: "everyone", defaultOn: true },
  /* The public surfaces close — the phone lookup above all, which is the one
     part of this feature with an abuse case — while an owner keeps their own
     lists. A claim already made still releases. */
  wishlists: { entries: ["wishlists.create", "wishlists.addItem", "wishlists.wish", "wishlists.findByPhone", "wishlists.byToken", "wishlists.claim"], audience: "shopper", defaultOn: true },
  /* Issuing new cards. A card already sold is money somebody holds, and it
     goes on being spendable. */
  giftCards: { entries: ["orders.createGiftCard"], audience: "seller", defaultOn: true },
  /* Affiliate marketing (3.7): joining closes and a member's product links stop
     earning on new orders. A line already frozen with its sharer is still
     credited when it is paid, and points already earned stay spendable. On
     by default, on the owner's word: anybody can join from their account and
     every product earns, so there is something behind it on any shop. */
  affiliates: { entries: ["affiliates.join"], audience: "everyone", defaultOn: true },
  /* Paid placements (3.3.15): off stops new bookings. One already sold runs
     out its days and is charged for them, so it keeps its place on the shelf. */
  ads: { entries: ["ads.book"], audience: "seller", defaultOn: true },
  /* Subscribe & Save (3.1.19): off stops new standing orders. Those already
     standing keep running and can be paused or cancelled. */
  subscriptions: { entries: ["subscriptions.create"], audience: "shopper", defaultOn: false },
  /* Fulfilled by NetLet (4.2): off stops sellers announcing new shipments.
     What is already on its way is still counted in, what NetLet holds still
     sells, and sold lines are still picked and packed. */
  fulfilment: { entries: ["fulfilment.announce"], audience: "seller", defaultOn: true },
  /* NetLet membership (4.1): off stops new grants. A member's membership
     runs out its time with every benefit — it was given, and taking it back
     with a switch would be keeping a promise only while it was convenient. */
  membership: { entries: ["membership.grant"], audience: "shopper", defaultOn: true },
  /* The browser's own recogniser; there is no entry, only the microphone in the
     search box, which is drawn only in a browser that can listen. */
  voiceSearch: { entries: [], audience: "shopper", defaultOn: true },
  /* A model reading a photo: off refuses the call as well as hiding the camera.
     On, the camera is still drawn only while a model key is configured and
     `ai` is on (`search.photoAvailable`), so it is never a button that can
     only apologise. */
  photoSearch: { entries: ["search.photo"], audience: "shopper", defaultOn: true },
  /* The home page's invitation to an app that is not yet in a store. */
  appBanner: { entries: [], audience: "shopper", defaultOn: false },
  /* The home page's guides (3.5.3), drawn only once one is published — so on
     by default, since a shop with none shows nothing either way. */
  articles: { entries: [], audience: "shopper", defaultOn: true },
  /* Trying clothes on from a photo of yourself (3.1.8): the shopper's photo
     goes to Google's model, so it starts off and is a decision to switch on. */
  tryOn: { entries: ["tryOn.make"], audience: "shopper", defaultOn: false },
};

export type FeatureStates = Record<FeatureKey, boolean>;

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

/** Every feature at its default: what a database with no switch rows means. */
export function defaultStates(): FeatureStates {
  return Object.fromEntries(FEATURE_KEYS.map(key => [key, FEATURES[key].defaultOn])) as FeatureStates;
}

/** The stored rows folded over the defaults, ignoring keys this build does not know. */
export function resolveStates(rows: readonly { key: string; enabled: boolean }[]): FeatureStates {
  const states = defaultStates();
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
