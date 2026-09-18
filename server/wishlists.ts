/**
 * Wishlists: the part that needs a database.
 *
 * The rules are `shared/commerce/wishlist.ts` and are pure. What is here is
 * the reading and the writing, and one thing that is neither: **which columns
 * each caller is allowed to select**. That is the security property of this
 * whole feature and it is enforced in the queries rather than in the router,
 * for the reason the inventory guards sit next to their queries — a second
 * caller added later skips a check written once at the top.
 *
 * Three rules are written into the queries themselves:
 *
 * **An owner's read never selects `claimedAt` or `claimedBy`.** A list whose
 * owner can watch items go grey tells them what they are getting for their
 * birthday. There is no flag for this and no "unless" — `listMine` and
 * `itemsForOwner` simply do not name those columns.
 *
 * **A public read is scoped by `visibility = 'public'` inside the where
 * clause**, not filtered after. A private list must be indistinguishable from
 * a list that does not exist, and a query that fetches it and then decides is
 * one that eventually returns it.
 *
 * **Nothing about the owner leaves except the name they chose to publish.**
 * No join to `users`. The name is copied onto the list row precisely so that
 * this file never has to reach for that table.
 *
 * Outside `db.ts` for the reason `profile.ts`, `orders.ts` and
 * `recommendations.ts` are: functions inside `db.ts` call its module-local
 * `getDb`, which nothing outside can redirect, so they cannot be tested
 * against a real database.
 */
import { randomBytes } from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import {
  customerPreferences,
  wishlistItems,
  wishlists,
} from "../drizzle/schema.js";
import { getDb } from "./db.js";
import {
  CLAIM_HOLD_DAYS,
  MAX_ITEMS_PER_LIST,
  MAX_LISTS_PER_SHOPPER,
  claimStateFor,
  normalisePhone,
  type OwnerListView,
  type PublicListView,
  type Visibility,
} from "../shared/commerce/wishlist.js";

/**
 * Why a write was refused, as a code rather than a sentence.
 *
 * The same shape `refusalFor` uses for orders: the server decides and the page
 * translates, so a refusal reads in Arabic without the server knowing there is
 * an Arabic.
 */
export type WishlistRefusal =
  | "notFound"
  | "tooManyLists"
  | "listFull"
  | "phoneInvalid"
  | "phoneTaken"
  | "alreadyClaimed";

export class WishlistError extends Error {
  constructor(readonly reason: WishlistRefusal) {
    super(reason);
  }
}

/**
 * A token for a URL: 32 URL-safe characters from a real random source.
 *
 * `randomBytes`, not `Math.random`, because this is the only thing standing
 * between a published list and anybody who fancies walking the space — the
 * same argument the cart id makes for not being a serial.
 */
const newToken = () => randomBytes(24).toString("base64url");

async function db() {
  const database = await getDb();
  if (!database) throw new Error("wishlists: no database configured");
  return database;
}

/* --------------------------------------------------------- the owner --- */

/** The shopper's own lists. Deliberately carries no claim information. */
export async function listMine(userId: number): Promise<OwnerListView[]> {
  const rows = await (await db())
    .select({
      id: wishlists.id,
      title: wishlists.title,
      visibility: wishlists.visibility,
      updatedAt: wishlists.updatedAt,
      itemCount: sql<number>`(select count(*)::int from ${wishlistItems} where ${wishlistItems.wishlistId} = ${wishlists.id})`,
    })
    .from(wishlists)
    .where(eq(wishlists.userId, userId))
    .orderBy(wishlists.createdAt, wishlists.id);

  const phone = await phoneFor(userId);

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    visibility: row.visibility,
    itemCount: row.itemCount,
    phone,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * The share link for one of the shopper's own lists.
 *
 * Split out from `listMine` rather than included in it, because a token is a
 * capability: it belongs on the screen where somebody asked to share, not in
 * the payload of every page that happens to list their wishlists.
 */
export async function shareTokenFor(userId: number, listId: number): Promise<string | null> {
  const [row] = await (await db())
    .select({ token: wishlists.shareToken, visibility: wishlists.visibility })
    .from(wishlists)
    .where(and(eq(wishlists.id, listId), eq(wishlists.userId, userId)));
  if (!row) throw new WishlistError("notFound");
  return row.visibility === "public" ? row.token : null;
}

/** What the owner sees of one list: the wishes, and nothing about claims. */
export async function itemsForOwner(userId: number, listId: number) {
  const database = await db();
  const [list] = await database
    .select({ id: wishlists.id, title: wishlists.title, visibility: wishlists.visibility, ownerName: wishlists.ownerName })
    .from(wishlists)
    .where(and(eq(wishlists.id, listId), eq(wishlists.userId, userId)));
  if (!list) throw new WishlistError("notFound");

  const items = await database
    .select({
      id: wishlistItems.id,
      productId: wishlistItems.productId,
      note: wishlistItems.note,
      quantity: wishlistItems.quantity,
      // claimedAt and claimedBy are absent on purpose. See the file comment.
    })
    .from(wishlistItems)
    .where(eq(wishlistItems.wishlistId, listId))
    .orderBy(wishlistItems.createdAt, wishlistItems.id);

  return { list, items };
}

export async function createList(userId: number, title: string): Promise<number> {
  const database = await db();
  const [{ n }] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(wishlists)
    .where(eq(wishlists.userId, userId));
  if (n >= MAX_LISTS_PER_SHOPPER) throw new WishlistError("tooManyLists");

  const [row] = await database
    .insert(wishlists)
    .values({ userId, title, shareToken: newToken() })
    .returning({ id: wishlists.id });
  return row.id;
}

/**
 * Publish, unpublish, rename, or set the name strangers see.
 *
 * **Unpublishing mints a new token**, so a link already pasted into a group
 * chat stops working. Without that, "make this private again" would only stop
 * *new* people finding it by phone number and would leave every existing link
 * live — which is not what anybody means by the word private.
 */
export async function updateList(
  userId: number,
  listId: number,
  patch: { title?: string; visibility?: Visibility; ownerName?: string | null },
): Promise<void> {
  const database = await db();
  const [existing] = await database
    .select({ visibility: wishlists.visibility })
    .from(wishlists)
    .where(and(eq(wishlists.id, listId), eq(wishlists.userId, userId)));
  if (!existing) throw new WishlistError("notFound");

  const goingPrivate = patch.visibility === "private" && existing.visibility === "public";

  const result = await database
    .update(wishlists)
    .set({
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.visibility === undefined ? {} : { visibility: patch.visibility }),
      ...(patch.ownerName === undefined ? {} : { ownerName: patch.ownerName }),
      ...(goingPrivate ? { shareToken: newToken() } : {}),
    })
    .where(and(eq(wishlists.id, listId), eq(wishlists.userId, userId)))
    .returning({ id: wishlists.id });
  if (result.length === 0) throw new WishlistError("notFound");
}

export async function deleteList(userId: number, listId: number): Promise<void> {
  const result = await (await db())
    .delete(wishlists)
    .where(and(eq(wishlists.id, listId), eq(wishlists.userId, userId)))
    .returning({ id: wishlists.id });
  if (result.length === 0) throw new WishlistError("notFound");
}

/**
 * Put a product on a list.
 *
 * Every write takes the owner's id and joins on it, so a list id typed into a
 * request adds nothing to somebody else's list. That is the same argument the
 * orders router makes about a serial being short enough to guess.
 */
export async function addItem(
  userId: number,
  listId: number,
  item: { productId: string; note?: string | null; quantity?: number },
): Promise<void> {
  const database = await db();
  const [owned] = await database
    .select({ id: wishlists.id })
    .from(wishlists)
    .where(and(eq(wishlists.id, listId), eq(wishlists.userId, userId)));
  if (!owned) throw new WishlistError("notFound");

  const [{ n }] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(wishlistItems)
    .where(eq(wishlistItems.wishlistId, listId));
  if (n >= MAX_ITEMS_PER_LIST) throw new WishlistError("listFull");

  /*
   * Adding something already on the list updates the note rather than
   * refusing. Somebody pressing the button twice meant to say something about
   * the item the second time, and an error that reads "already on your list"
   * throws away what they typed.
   */
  /*
   * Only the fields the caller actually sent are overwritten. Setting both
   * every time meant saving a note silently reset the quantity to one — an
   * upsert that writes a default over somebody's data is invisible until the
   * field it clobbers grows a control.
   *
   * And when the caller sent neither — a plain "add this to my list" — there
   * is nothing to update, so the row is left alone. `onConflictDoUpdate` with
   * an empty `set` is not a no-op: Drizzle refuses to *build* the statement,
   * which broke every add rather than just the repeat ones. Found by pressing
   * the button in a browser; the tests all happened to send a note.
   */
  const changes = {
    ...(item.note === undefined ? {} : { note: item.note }),
    ...(item.quantity === undefined ? {} : { quantity: item.quantity }),
  };
  const insert = database
    .insert(wishlistItems)
    .values({ wishlistId: listId, productId: item.productId, note: item.note ?? null, quantity: item.quantity ?? 1 });

  await (Object.keys(changes).length === 0
    ? insert.onConflictDoNothing({ target: [wishlistItems.wishlistId, wishlistItems.productId] })
    : insert.onConflictDoUpdate({ target: [wishlistItems.wishlistId, wishlistItems.productId], set: changes }));
}

export async function removeItem(userId: number, listId: number, itemId: number): Promise<void> {
  const database = await db();
  const [owned] = await database
    .select({ id: wishlists.id })
    .from(wishlists)
    .where(and(eq(wishlists.id, listId), eq(wishlists.userId, userId)));
  if (!owned) throw new WishlistError("notFound");

  await database.delete(wishlistItems).where(and(eq(wishlistItems.id, itemId), eq(wishlistItems.wishlistId, listId)));
}

/* ---------------------------------------------------------- the phone --- */

export async function phoneFor(userId: number): Promise<string | null> {
  const [row] = await (await db())
    .select({ phone: customerPreferences.wishlistPhone })
    .from(customerPreferences)
    .where(eq(customerPreferences.userId, userId));
  return row?.phone ?? null;
}

/**
 * Whether a thrown thing is Postgres saying "that already exists".
 *
 * It walks `cause`, because Drizzle wraps the driver's error and the code is
 * not on the object it hands back — which is how the first version of this
 * silently fell through and sent the shopper a `TRPCError` whose message was
 * the entire INSERT statement with its parameters. Ugly, and worse than ugly:
 * a client that can read our SQL from a duplicate phone number has been told
 * more about the schema than a client ever needs.
 */
function isUniqueViolation(error: unknown): boolean {
  for (let step: unknown = error, depth = 0; step && depth < 5; depth++) {
    const code = (step as { code?: unknown }).code;
    if (code === "23505" || code === 23505) return true;
    step = (step as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Set or clear the number friends and family type.
 *
 * Normalised through the same pure function the lookup uses, so one person is
 * one key however their aunt spelled it.
 *
 * Checked *and* caught. The read is what produces a decent message in the
 * ordinary case; the catch is the actual guarantee, because between the read
 * and the write somebody else can take the number. Relying on the read alone
 * is the classic check-then-act race, and relying on the catch alone worked
 * until Drizzle wrapped the error.
 *
 * It deliberately never says whose number it is. "Already in use" is all a
 * caller needs, and anything more would make this a second way to ask which
 * numbers shop at NetLet.
 */
export async function setPhone(userId: number, raw: string | null): Promise<string | null> {
  const phone = raw === null || raw.trim() === "" ? null : normalisePhone(raw);
  if (raw !== null && raw.trim() !== "" && phone === null) throw new WishlistError("phoneInvalid");

  const database = await db();

  if (phone !== null) {
    const [taken] = await database
      .select({ userId: customerPreferences.userId })
      .from(customerPreferences)
      .where(eq(customerPreferences.wishlistPhone, phone));
    if (taken && taken.userId !== userId) throw new WishlistError("phoneTaken");
  }

  try {
    await database
      .insert(customerPreferences)
      .values({ userId, wishlistPhone: phone })
      .onConflictDoUpdate({ target: customerPreferences.userId, set: { wishlistPhone: phone } });
  } catch (error) {
    if (isUniqueViolation(error)) throw new WishlistError("phoneTaken");
    throw error;
  }
  return phone;
}

/* --------------------------------------------------------- the public --- */

/**
 * Shape a published list for somebody who is not its owner.
 *
 * The single place the public payload is built, so there is one answer to
 * "what does a stranger see" rather than one per call site.
 */
async function publicFrom(
  list: { id: number; title: string; ownerName: string | null; shareToken: string },
  viewerId: number | null,
): Promise<PublicListView> {
  const items = await (await db())
    .select({
      productId: wishlistItems.productId,
      note: wishlistItems.note,
      quantity: wishlistItems.quantity,
      claimedAt: wishlistItems.claimedAt,
      claimedBy: wishlistItems.claimedBy,
      boughtAt: wishlistItems.boughtAt,
    })
    .from(wishlistItems)
    .where(eq(wishlistItems.wishlistId, list.id))
    .orderBy(wishlistItems.createdAt, wishlistItems.id);

  const now = new Date();
  return {
    token: list.shareToken,
    title: list.title,
    ownerName: list.ownerName,
    items: items.map(item => ({
      productId: item.productId,
      note: item.note,
      quantity: item.quantity,
      // The state, not the timestamps. A giver has no business knowing when
      // somebody else pressed the button, and `claimedBy` never leaves as an
      // id — only as the one boolean that is a fact about the viewer.
      state: claimStateFor(item, now),
      claimedByYou: viewerId !== null
        && item.claimedBy === viewerId
        && claimStateFor(item, now) === "claimed",
    })),
  };
}

/**
 * Every published list belonging to the shopper at this number.
 *
 * Plural because somebody may keep a birthday list and a wedding list, and
 * asking a relative which one they meant is better than picking for them.
 *
 * `visibility = 'public'` is inside the where clause, so an unpublished list
 * is not fetched and then hidden — it is never read. The caller cannot tell a
 * number with no account from a number whose owner publishes nothing, and
 * that is the point: both return an empty array.
 */
export async function publicListsByPhone(rawPhone: string, viewerId: number | null = null): Promise<PublicListView[]> {
  const phone = normalisePhone(rawPhone);
  if (!phone) return [];

  const rows = await (await db())
    .select({
      id: wishlists.id,
      title: wishlists.title,
      ownerName: wishlists.ownerName,
      shareToken: wishlists.shareToken,
    })
    .from(wishlists)
    .innerJoin(customerPreferences, eq(customerPreferences.userId, wishlists.userId))
    .where(and(eq(customerPreferences.wishlistPhone, phone), eq(wishlists.visibility, "public")))
    .orderBy(wishlists.createdAt, wishlists.id);

  return Promise.all(rows.map(row => publicFrom(row, viewerId)));
}

/** One published list by its share token, for a pasted link. */
export async function publicListByToken(token: string, viewerId: number | null = null): Promise<PublicListView | null> {
  const [row] = await (await db())
    .select({
      id: wishlists.id,
      title: wishlists.title,
      ownerName: wishlists.ownerName,
      shareToken: wishlists.shareToken,
    })
    .from(wishlists)
    .where(and(eq(wishlists.shareToken, token), eq(wishlists.visibility, "public")));

  return row ? publicFrom(row, viewerId) : null;
}

/**
 * "I am getting this one."
 *
 * The predicate is the whole safety property, and it is the same shape the
 * stock take uses: the condition lives *inside* the write, so two relatives
 * pressing at the same moment cannot both be told they have it. Anything
 * already bought, or claimed and still inside its hold, fails the where clause
 * and the update touches no rows.
 *
 * Reached by token rather than by list id, because the person doing it is
 * usually signed out — the token is the capability, and a claim on a list
 * nobody published is refused for the same reason reading one is.
 */
export async function claimItem(
  token: string,
  productId: string,
  byUserId: number | null,
): Promise<void> {
  const database = await db();
  const [list] = await database
    .select({ id: wishlists.id })
    .from(wishlists)
    .where(and(eq(wishlists.shareToken, token), eq(wishlists.visibility, "public")));
  if (!list) throw new WishlistError("notFound");

  const lapsed = new Date(Date.now() - CLAIM_HOLD_DAYS * 24 * 60 * 60 * 1000);
  const updated = await database
    .update(wishlistItems)
    .set({ claimedAt: new Date(), claimedBy: byUserId })
    .where(
      and(
        eq(wishlistItems.wishlistId, list.id),
        eq(wishlistItems.productId, productId),
        isNull(wishlistItems.boughtAt),
        /*
         * Free, or held by a claim that has already lapsed.
         *
         * `lt(column, date)` rather than a raw `sql` fragment. Interpolating a
         * JS Date into a raw fragment skips the column's own mapper and hands
         * the driver an object it cannot bind — postgres.js throws
         * ERR_INVALID_ARG_TYPE on it. PGlite accepted it happily, so the tests
         * were green and every claim failed with a 500 in the browser: the
         * difference between a test database and the real driver, found by
         * pressing the button.
         */
        or(isNull(wishlistItems.claimedAt), lt(wishlistItems.claimedAt, lapsed)),
      ),
    )
    .returning({ id: wishlistItems.id });

  if (updated.length === 0) throw new WishlistError("alreadyClaimed");
}

/**
 * Let go of a claim.
 *
 * Only whoever made it, and only while signed in — otherwise a passer-by with
 * the link could free every hold on a list and let the same present be bought
 * three times, which is the exact failure claiming exists to prevent. A giver
 * who claimed while signed out cannot release, and waits out the hold instead;
 * that is the honest cost of not making people register to buy a gift.
 */
export async function releaseClaim(token: string, productId: string, byUserId: number): Promise<void> {
  const database = await db();
  const [list] = await database
    .select({ id: wishlists.id })
    .from(wishlists)
    .where(and(eq(wishlists.shareToken, token), eq(wishlists.visibility, "public")));
  if (!list) throw new WishlistError("notFound");

  await database
    .update(wishlistItems)
    .set({ claimedAt: null, claimedBy: null })
    .where(
      and(
        eq(wishlistItems.wishlistId, list.id),
        eq(wishlistItems.productId, productId),
        eq(wishlistItems.claimedBy, byUserId),
        isNull(wishlistItems.boughtAt),
      ),
    );
}
