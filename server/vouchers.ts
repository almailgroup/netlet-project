/**
 * Discount codes and gift cards, the half that needs a database.
 *
 * `shared/commerce/vouchers.ts` is the rule set and is pure. This is what
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
} from "../shared/commerce/vouchers.js";
import { assertCan, type Actor } from "../shared/inventory/permissions.js";
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
 * Record that a code was used.
 *
 * The row *is* the count, so this is also what makes "all used up" true for
 * the next shopper. `onConflictDoNothing` on the (code, order) index, because
 * a retry must not count twice.
 */
export async function recordRedemption(
  db: Db,
  code: string,
  input: { userId: number | null; orderId: number; amount: string },
): Promise<void> {
  const [row] = await db.select({ id: discountCodes.id }).from(discountCodes).where(eq(discountCodes.code, code)).limit(1);
  if (!row) return;
  await db
    .insert(discountRedemptions)
    .values({ codeId: row.id, userId: input.userId, orderId: input.orderId, amount: input.amount })
    .onConflictDoNothing();
}

/* ------------------------------------------------------------- minting --- */

/**
 * The alphabet a code is generated from.
 *
 * The same one the order reference and the referral code use — no O or 0, no
 * I, 1 or L, no S or 5 — because a gift card gets read down a phone more often
 * than an order number does.
 */
const ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ23456789";

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

  /* Sixteen characters from a thirty-letter alphabet: the code is the whole
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
