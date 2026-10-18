/**
 * Discount codes and gift cards, the half that needs a database.
 *
 * `Shared/commerce/vouchers.ts` is the rule set and is pure. This is what
 * cannot be: counting how often a code has been used and by whom, taking a
 * gift card's balance race-safely, and minting both.
 *
 * Outside `db.ts` for the reason `orders.ts`, `referral.ts` and `finance.ts`
 * are: functions inside it reach its module-local `getDb`, which nothing
 * outside can redirect, so anything living there cannot be tested against a
 * real database.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { discountCodes, discountRedemptions, giftCardUses, giftCards } from "../drizzle/schema.js";
import {
  discountOf,
  giftCardRefusal,
  normaliseCode,
  voucherRefusal,
  type VoucherKind,
  type VoucherRefusal,
  type VoucherRefusalGift,
} from "../Shared/commerce/vouchers.js";
import { assertCan, type Actor } from "../Shared/inventory/permissions.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** What the checkout is told about a code it was handed. */
export type VoucherQuote =
  | { ok: true; kind: "discount"; code: string; amount: string }
  | { ok: true; kind: "gift"; code: string; amount: string; remaining: string }
  | { ok: false; reason: VoucherRefusal | VoucherRefusalGift };

/**
 * Work out what one typed code is worth on this basket.
 *
 * **One field for both**, because a shopper holding a code does not
 * necessarily know which kind it is, and asking them to pick the right box
 * before they can use it is a question the shop can answer itself. A discount
 * code is looked for first: they are the ones people mistype, and a gift card
 * is generated rather than chosen so a collision is not a real case.
 *
 * Returns what it is worth *now*, and nothing is reserved: the figure is read
 * again at the moment of sale, the way every price is.
 */
export async function quoteVoucher(
  db: Db,
  typed: string,
  context: { goods: string; owed: string; userId: number | null },
): Promise<VoucherQuote> {
  const code = normaliseCode(typed);
  if (!code) return { ok: false, reason: "voucher.unknown" };

  const [discount] = await db.select().from(discountCodes).where(eq(discountCodes.code, code)).limit(1);
  if (discount) {
    const [counts] = await db
      .select({
        used: sql<string>`count(*)`,
        mine: sql<string>`count(*) filter (where ${discountRedemptions.userId} = ${context.userId ?? -1})`,
      })
      .from(discountRedemptions)
      .where(eq(discountRedemptions.codeId, discount.id));

    const refusal = voucherRefusal(
      {
        code: discount.code,
        kind: discount.kind as VoucherKind,
        value: discount.value,
        minSpend: discount.minSpend,
        startsAt: discount.startsAt,
        endsAt: discount.endsAt,
        maxRedemptions: discount.maxRedemptions,
        perShopper: discount.perShopper,
      },
      { goods: context.goods, used: Number(counts?.used ?? 0), usedByShopper: Number(counts?.mine ?? 0) },
    );
    if (refusal) return { ok: false, reason: refusal };

    return {
      ok: true,
      kind: "discount",
      code: discount.code,
      amount: discountOf({ kind: discount.kind as VoucherKind, value: discount.value }, context.goods),
    };
  }

  const [card] = await db.select().from(giftCards).where(eq(giftCards.code, code)).limit(1);
  if (!card) return { ok: false, reason: "voucher.unknown" };

  const cardRefusal = giftCardRefusal({ remaining: card.remaining, expiresAt: card.expiresAt });
  if (cardRefusal) return { ok: false, reason: cardRefusal };

  return {
    ok: true,
    kind: "gift",
    code: card.code,
    /* What it would pay toward what is still owed — the caller has already
       taken the discount and the points off, because a gift card pays a bill
       rather than reducing one. */
    amount: Number.parseFloat(card.remaining) < Number.parseFloat(context.owed) ? card.remaining : context.owed,
    remaining: card.remaining,
  };
}

/**
 * Take money off a gift card, or refuse.
 *
 * The predicate is inside the `UPDATE`, exactly as the stock take's is: two
 * tabs spending the last dinar both read the same balance, and without the
 * condition in the write both would spend it.
 */
export async function spendGiftCard(db: Db, code: string, amount: string): Promise<boolean> {
  const taken = await db
    .update(giftCards)
    .set({ remaining: sql`${giftCards.remaining} - ${amount}` })
    .where(and(eq(giftCards.code, code), sql`${giftCards.remaining} >= ${amount}`))
    .returning({ id: giftCards.id });
  return taken.length > 0;
}

/** Put it back, for an order that did not happen. */
export async function refundGiftCard(db: Db, code: string, amount: string): Promise<void> {
  await db
    .update(giftCards)
    .set({ remaining: sql`${giftCards.remaining} + ${amount}` })
    .where(eq(giftCards.code, code));
}

/** Record that a card paid for an order, once the order exists. */
export async function recordGiftCardUse(db: Db, code: string, orderId: number, amount: string): Promise<void> {
  const [card] = await db.select({ id: giftCards.id }).from(giftCards).where(eq(giftCards.code, code)).limit(1);
  if (card) await db.insert(giftCardUses).values({ giftCardId: card.id, orderId, amount });
}

/**
 * Take one use of a code, or refuse.
 *
 * `quoteVoucher` counts the redemptions and compares them with the ceiling,
 * and that is a read: two checkouts in two tabs both read "used 0 of 1" and
 * both went through, so a code good for one customer came off two orders and a
 * one-per-shopper code came off the same shopper twice. The only unique index
 * is on `(code, order)`, which stops one order redeeming twice and nothing
 * else.
 *
 * So the count is taken under a lock on the code's own row — the same shape
 * `takePoints` uses, and for the same reason: no single row holds the total,
 * so there is no column to hang a `>=` predicate off the way the stock take
 * and the gift-card spend do. Inside the transaction the row is held, the
 * count is re-read against the ceiling as it stands *now*, and the redemption
 * is inserted before the lock is released. A second checkout waits, re-reads,
 * and is refused.
 *
 * The row is claimed with no order behind it yet, because the order does not
 * exist until the basket has cleared every other gate. `stampRedemption`
 * attaches it afterwards and `returnRedemption` hands it back when a later
 * step refuses — exactly as the stock and the points are handed back.
 */
export async function claimRedemption(
  db: Db,
  code: string,
  input: { userId: number | null; amount: string },
): Promise<number | null> {
  return db.transaction(async tx => {
    const [row] = await tx
      .select({ id: discountCodes.id, maxRedemptions: discountCodes.maxRedemptions, perShopper: discountCodes.perShopper })
      .from(discountCodes)
      .where(eq(discountCodes.code, code))
      .for("update")
      .limit(1);
    if (!row) return null;

    const [counts] = await tx
      .select({
        used: sql<string>`count(*)`,
        mine: sql<string>`count(*) filter (where ${discountRedemptions.userId} = ${input.userId ?? -1})`,
      })
      .from(discountRedemptions)
      .where(eq(discountRedemptions.codeId, row.id));

    const used = Number(counts?.used ?? 0);
    const mine = Number(counts?.mine ?? 0);
    if (row.maxRedemptions !== null && used >= row.maxRedemptions) return null;
    if (input.userId !== null && mine >= Math.max(1, row.perShopper)) return null;

    const [claim] = await tx
      .insert(discountRedemptions)
      .values({ codeId: row.id, userId: input.userId, orderId: null, amount: input.amount })
      .returning({ id: discountRedemptions.id });
    return claim?.id ?? null;
  });
}

/** Attach the order, once there is one. */
export async function stampRedemption(db: Db, claimId: number, orderId: number): Promise<void> {
  await db.update(discountRedemptions).set({ orderId }).where(eq(discountRedemptions.id, claimId));
}

/** Hand the use back, when a later step refuses the order. */
export async function returnRedemption(db: Db, claimId: number): Promise<void> {
  await db.delete(discountRedemptions).where(eq(discountRedemptions.id, claimId));
}

/* ------------------------------------------------------------- minting --- */

/**
 * The alphabet a code is generated from.
 *
 * The same one the order reference and the referral code use — no O or 0, no
 * I, 1 or L, no S or 5 — because a gift card gets read down a phone more often
 * than an order number does.
 */
const ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ2346789";

function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let code = "";
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return code;
}

/** Mint a gift card. Admin only, and the guard is beside the query. */
export async function createGiftCard(
  actor: Actor,
  input: { amount: string; expiresAt?: Date | null; note?: string | null },
): Promise<{ code: string }> {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  /* Sixteen characters from a twenty-nine-letter alphabet: the code is the whole
     credential, so it has to be worth more to be given than to be guessed. */
  const code = `NL${randomCode(16)}`;
  await db.insert(giftCards).values({
    code,
    initialBalance: input.amount,
    remaining: input.amount,
    expiresAt: input.expiresAt ?? null,
    note: input.note?.trim() || null,
  });
  return { code };
}

/** Create or replace a discount code. Admin only. */
export async function saveDiscountCode(
  actor: Actor,
  input: {
    code: string;
    kind: VoucherKind;
    value: string;
    minSpend?: string | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
    maxRedemptions?: number | null;
    perShopper?: number;
  },
): Promise<{ code: string }> {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const code = normaliseCode(input.code);
  if (!code) throw new Error("voucher.unknown");

  await db
    .insert(discountCodes)
    .values({
      code,
      kind: input.kind,
      value: input.value,
      minSpend: input.minSpend ?? null,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      maxRedemptions: input.maxRedemptions ?? null,
      perShopper: input.perShopper ?? 1,
    })
    /* Editing a live code is ordinary — a campaign gets extended, a ceiling
       raised — and re-typing the same code is how somebody does it. */
    .onConflictDoUpdate({
      target: discountCodes.code,
      set: {
        kind: input.kind,
        value: input.value,
        minSpend: input.minSpend ?? null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        maxRedemptions: input.maxRedemptions ?? null,
        perShopper: input.perShopper ?? 1,
      },
    });
  return { code };
}

export type VoucherListing = {
  codes: {
    id: number;
    code: string;
    kind: string;
    value: string;
    minSpend: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
    maxRedemptions: number | null;
    perShopper: number;
    used: number;
  }[];
  cards: {
    id: number;
    code: string;
    initialBalance: string;
    remaining: string;
    expiresAt: Date | null;
    note: string | null;
  }[];
};

/** Everything an admin needs to see on the promotions page. */
export async function listVouchers(actor: Actor, limit = 100): Promise<VoucherListing> {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  if (!db) return { codes: [], cards: [] };

  const codes = await db
    .select({
      id: discountCodes.id,
      code: discountCodes.code,
      kind: discountCodes.kind,
      value: discountCodes.value,
      minSpend: discountCodes.minSpend,
      startsAt: discountCodes.startsAt,
      endsAt: discountCodes.endsAt,
      maxRedemptions: discountCodes.maxRedemptions,
      perShopper: discountCodes.perShopper,
      used: sql<string>`(select count(*) from ${discountRedemptions} where ${discountRedemptions.codeId} = ${discountCodes.id})`,
    })
    .from(discountCodes)
    .orderBy(desc(discountCodes.createdAt), desc(discountCodes.id))
    .limit(limit);

  const cards = await db
    .select()
    .from(giftCards)
    .orderBy(desc(giftCards.createdAt), desc(giftCards.id))
    .limit(limit);

  return {
    codes: codes.map(row => ({ ...row, used: Number(row.used) })),
    cards: cards.map(row => ({
      id: row.id,
      code: row.code,
      initialBalance: row.initialBalance,
      remaining: row.remaining,
      expiresAt: row.expiresAt,
      note: row.note,
    })),
  };
}
