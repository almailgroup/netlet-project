/**
 * Gathering what a shopper has told us, and turning it into a rail.
 *
 * The ranking itself is not here — `Shared/commerce/taste.ts` is pure and does
 * that, so it can be argued with in a test. What is here is the part that
 * needs a database (which signals exist, and which products are actually on
 * the shelf) and the part that needs the network (an optional model pass).
 *
 * Outside `db.ts` for the reason `profile.ts`, `rateLimit.ts` and `orders.ts`
 * are: functions inside `db.ts` call its module-local `getDb`, which nothing
 * outside can redirect, so they cannot be tested against a real database.
 *
 * **Three rules hold whatever the model says.**
 *
 * The candidate set comes from `listProducts`, which reads `publishedCatalog`
 * — so a draft, or a suspended vendor's product, is absent from a rail for the
 * same reason it is absent from the shop. The model reorders that set and
 * never chooses it.
 *
 * Only interest terms leave NetLet. No name, no email, no account id, no order
 * reference — `tasteTerms` is the whole payload and it reads "lighting, home,
 * under KWD 12". A personalisation feature that ships a customer's identity to
 * a third party to get a nicer rail has made a trade nobody asked it to make.
 *
 * A model failure is never a failure of the page. No key, a timeout, a refusal,
 * malformed JSON, an invented product id — every one of them falls back to the
 * deterministic ranking, which was already good enough to render.
 */
import { takeRecommendModelCall } from "./rateLimit.js";
import { and, eq, inArray } from "drizzle-orm";
import {
  cartItems,
  followedProducts,
  orderItems,
  orders,
  productVariants,
  savedProducts,
} from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { listProducts } from "./catalog.js";
import { featureOn } from "./features.js";
import { askModel, modelAvailable, parseObject } from "./gemini.js";
import {
  applyModelOrder,
  buildTaste,
  isRecommendable,
  rankByTaste,
  tasteTerms,
  TASTE_FLOOR,
  type Recommendation,
  type TasteSignal,
} from "../Shared/commerce/taste.js";
import type { LocalePick } from "../Shared/commerce/fromInventory.js";

/** How wide a net the ranking casts before it is cut to the rail's length. */
const CANDIDATE_LIMIT = 120;

export type RecommendationResult = {
  items: Recommendation[];
  /**
   * Whether this is actually about *them*.
   *
   * False means we had too little to go on and the rail is showing the shop's
   * own picks. The page reads this to decide whether it may say "for you" —
   * because a rail headed "Picked for you" over a generic list is a claim a
   * shopper checks once and never trusts again.
   */
  personalised: boolean;
  /** The interest terms behind it, so a shopper can see what we think. */
  terms: string[];
  /** Whether a model reordered the list, or only the deterministic scorer ran. */
  refinedByModel: boolean;
};

const empty: RecommendationResult = { items: [], personalised: false, terms: [], refinedByModel: false };

/**
 * Everything the shopper has done that says something about their taste.
 *
 * The cart is keyed by its own token rather than by the account, because a
 * signed-out shopper has a bag and it is the strongest signal they have given
 * us. Orders are read for a signed-in shopper only — there is no such thing as
 * an anonymous purchase here.
 */
async function signalsFor(userId: number | null, cartId: string | null): Promise<TasteSignal[]> {
  const db = await getDb();
  if (!db) return [];

  const out: TasteSignal[] = [];

  if (userId !== null) {
    const savedRows = await db
      .select({ productId: savedProducts.productId })
      .from(savedProducts)
      .where(eq(savedProducts.userId, userId));
    for (const row of savedRows) out.push({ productId: row.productId, kind: "saved" });

    const followRows = await db
      .select({ productId: followedProducts.productId })
      .from(followedProducts)
      .where(eq(followedProducts.userId, userId));
    for (const row of followRows) out.push({ productId: row.productId, kind: "followed" });

    /*
     * Bought means paid. An order sitting in `pending_payment` is an intention
     * that may still fail, and treating it as a purchase would let an abandoned
     * checkout outweigh everything the shopper has actually done.
     */
    const boughtRows = await db
      .select({ productId: orderItems.productId })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orders.userId, userId), inArray(orders.status, ["paid", "refunded"])));
    for (const row of boughtRows) {
      if (row.productId !== null) out.push({ productId: String(row.productId), kind: "bought" });
    }
  }

  if (cartId) {
    const bagRows = await db
      .select({ productId: productVariants.productId })
      .from(cartItems)
      .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
      .where(eq(cartItems.cartId, cartId));
    for (const row of bagRows) out.push({ productId: String(row.productId), kind: "bagged" });
  }

  return out;
}

/**
 * Ask a model to reorder what we already ranked.
 *
 * It earns its place on the thing the scorer cannot do: merchant tags are free
 * text and inconsistent, so "brass reading lamp" and "linen cushion cover"
 * share no tag while plainly belonging to one room. A model reads the titles
 * and sees that; a set-overlap score never will.
 *
 * It is given ids and titles and nothing else, it may only return ids it was
 * given, and every failure lands on the ranking we already trusted.
 */
async function refineWithModel(ranked: Recommendation[], terms: string[]): Promise<Recommendation[] | null> {
  if (ranked.length < 3 || terms.length === 0) return null;
  if (!(await modelAvailable())) return null;

  const menu = ranked.map(entry => `${entry.product.id}: ${entry.product.title}`).join("\n");
  const parsed = parseObject(await askModel("recommendOrder", {
    system:
      'You order shop recommendations for a Kuwait marketplace. Return JSON only: {"order":["id","id",...]}. ' +
      "Use ONLY ids from the provided list, each at most once, best fit first. " +
      "Judge fit from how well each title suits the shopper's interests. " +
      "Never invent an id, a product, a price or a fact. Return no other keys and no prose.",
    prompt: `Shopper interests: ${terms.join(", ")}\n\nProducts:\n${menu}`,
    json: true,
    temperature: 0.2,
    maxOutputTokens: 200,
    /*
     * A short deadline, because this sits in front of a rail on the home page.
     * A recommendation that arrives after the shopper has scrolled past is
     * worth less than a slightly worse one that arrived.
     */
    deadlineMs: 2500,
  }));
  /* A timeout, a network error, a refusal, malformed JSON — all one answer. */
  if (!Array.isArray(parsed?.order)) return null;
  const order = parsed.order.filter((id): id is string => typeof id === "string");
  if (order.length === 0) return null;
  // `applyModelOrder` is what drops anything we did not send it.
  return applyModelOrder(ranked, order);
}

/**
 * The rail.
 *
 * Falls back to the shop's own newest when there is not enough to go on, and
 * says so through `personalised` rather than dressing it up.
 */
export async function recommendFor(
  { userId, cartId, limit = 8, locale = "en" }: {
    userId: number | null;
    cartId: string | null;
    limit?: number;
    locale?: LocalePick;
  },
): Promise<RecommendationResult> {
  /* Switched off (2.3): an empty rail, which the page already draws as no rail. */
  if (!(await featureOn("recommendations"))) return empty;
  const catalog = await listProducts({ first: CANDIDATE_LIMIT, locale });
  if (catalog.length === 0) return empty;

  const signals = await signalsFor(userId, cartId);
  const profile = buildTaste(signals, catalog);

  if (profile.strength < TASTE_FLOOR) {
    /*
     * Not enough to call it theirs. The shop's own shelf, minus anything they
     * have already picked up — which is still the useful half of a
     * recommendation — and `personalised: false` so the page says "Popular
     * right now" rather than claiming to know them.
     */
    return {
      // The same two refusals the ranked path makes: a fallback rail full of
      // sold-out and zero-priced products is the one a shopper meets first.
      items: catalog
        .filter(product => !profile.seen.has(product.id) && isRecommendable(product))
        .slice(0, limit)
        .map(product => ({ product, score: 0, reasons: [] })),
      personalised: false,
      terms: [],
      refinedByModel: false,
    };
  }

  const ranked = rankByTaste(profile, catalog, limit);
  if (ranked.length === 0) return { ...empty, terms: tasteTerms(profile) };

  const terms = tasteTerms(profile);
  /*
   * The model only for an account, and only so often. The rail is a public
   * read — a guest's bag is enough to make it personal — and it called the
   * model on every request, so a loop holding a full bag could run up the
   * shop's bill. Past the ceiling, or for a guest, the rail is the ranking it
   * already had, which is what it falls back to on any model failure.
   */
  const refined = userId !== null && (await takeRecommendModelCall(userId))
    ? await refineWithModel(ranked, terms)
    : null;

  return {
    items: (refined ?? ranked).slice(0, limit),
    personalised: true,
    terms,
    refinedByModel: refined !== null,
  };
}
