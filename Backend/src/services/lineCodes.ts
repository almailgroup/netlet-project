/**
 * A discount code on one line of the bag (migration 0074), the half that needs
 * a database: finding a code with what it covers and how often it has been
 * used, and judging it against the line it is typed on.
 *
 * `Shared/commerce/lineCodes.ts` is the rule and is pure. The bag
 * (`getCart`) and the order (`priceableLines`) both judge through
 * `judgeLineCodes` here, each with the line's value as it prices it, so the
 * figure the checkout shows beside a line is the figure the order freezes.
 *
 * Outside `db.ts` for the reason `vouchers.ts` is: a function there reaches
 * its module-local `getDb`, which a test cannot redirect.
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { discountCodeProducts, discountCodes, discountRedemptions, giftCards, orderItems, products } from "../../database/schema.js";
import {
  isCodeFunder,
  isCodeScope,
  lineCodeDiscount,
  lineCodeRefusal,
  type CodeFunder,
  type CodeLine,
  type LineCodeRefusal,
  type ScopedCode,
} from "../../../Shared/commerce/lineCodes.js";
import { normaliseCode, type VoucherKind } from "../../../Shared/commerce/vouchers.js";
import type { getDb } from "./db.js";
import { outer } from "./sqlRefs.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** A code as the rule needs it, with how often it has gone. */
export type LoadedCode = { id: number; code: ScopedCode; used: number; usedByShopper: number };

/** What a line's code does to it. */
export type LineCodeVerdict =
  | { ok: true; codeId: number; code: string; amount: string; fundedBy: CodeFunder }
  | { ok: false; codeId: number | null; code: string; reason: LineCodeRefusal };

async function load(db: Db, where: SQL | undefined, userId: number | null): Promise<LoadedCode[]> {
  const rows = await db
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
      scope: discountCodes.scope,
      vendorId: discountCodes.vendorId,
      fundedBy: discountCodes.fundedBy,
      used: sql<string>`(select count(*) from ${discountRedemptions} where ${discountRedemptions.codeId} = ${outer(discountCodes.id)})`,
      mine: sql<string>`(select count(*) from ${discountRedemptions} where ${discountRedemptions.codeId} = ${outer(discountCodes.id)} and ${discountRedemptions.userId} = ${userId ?? -1})`,
    })
    .from(discountCodes)
    .where(where);
  if (rows.length === 0) return [];

  const listed = rows.filter(row => row.scope === "products").map(row => row.id);
  const covered = listed.length
    ? await db
        .select({ codeId: discountCodeProducts.codeId, productId: discountCodeProducts.productId })
        .from(discountCodeProducts)
        .where(inArray(discountCodeProducts.codeId, listed))
    : [];

  return rows.map(row => ({
    id: row.id,
    used: Number(row.used),
    usedByShopper: Number(row.mine),
    code: {
      code: row.code,
      kind: row.kind as VoucherKind,
      value: row.value,
      minSpend: row.minSpend,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      maxRedemptions: row.maxRedemptions,
      perShopper: row.perShopper,
      /* A value the rule does not know reads as the whole order's, which no
         line accepts — never as a wider reach than the row says. */
      scope: isCodeScope(row.scope) ? row.scope : "order",
      vendorId: row.vendorId,
      fundedBy: isCodeFunder(row.fundedBy) ? row.fundedBy : "netlet",
      productIds: covered.filter(item => item.codeId === row.id).map(item => item.productId),
    },
  }));
}

/** The codes these lines carry, by id. */
export async function codesByIds(db: Db, ids: readonly number[], userId: number | null): Promise<Map<number, LoadedCode>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  return new Map((await load(db, inArray(discountCodes.id, unique), userId)).map(code => [code.id, code]));
}

/**
 * A typed code, as the shop knows it — or what it is instead: nothing, or a
 * gift card, which pays the whole bill and belongs in its own box.
 */
export async function codeByText(
  db: Db,
  typed: string,
  userId: number | null,
): Promise<{ found: LoadedCode } | { refused: "voucher.unknown" | "voucher.giftOnLine" }> {
  const code = normaliseCode(typed);
  if (!code) return { refused: "voucher.unknown" };
  const [found] = await load(db, eq(discountCodes.code, code), userId);
  if (found) return { found };
  const [card] = await db.select({ id: giftCards.id }).from(giftCards).where(eq(giftCards.code, code)).limit(1);
  return { refused: card ? "voucher.giftOnLine" : "voucher.unknown" };
}

/** One line, judged: what its code takes off, or why it takes nothing. */
export function judgeLineCode(
  loaded: LoadedCode,
  line: CodeLine,
  context: { permitValid: boolean; now?: Date },
): LineCodeVerdict {
  const reason = lineCodeRefusal(loaded.code, line, {
    used: loaded.used,
    usedByShopper: loaded.usedByShopper,
    permitValid: context.permitValid,
    now: context.now,
  });
  if (reason) return { ok: false, codeId: loaded.id, code: loaded.code.code, reason };
  return {
    ok: true,
    codeId: loaded.id,
    code: loaded.code.code,
    amount: lineCodeDiscount(loaded.code, line.value),
    fundedBy: loaded.code.fundedBy,
  };
}

/**
 * Every line of a bag that carries a code, judged — the bag and the order's
 * one door onto the rule. Keyed by the bag's line id. A code deleted since is
 * `set null` on the line already, so it never reaches here.
 */
export async function judgeLineCodes(
  db: Db,
  userId: number | null,
  lines: readonly (CodeLine & { key: number; codeId: number | null; permitValid: boolean })[],
): Promise<Map<number, LineCodeVerdict>> {
  const coded = lines.filter(line => line.codeId !== null);
  const loaded = await codesByIds(db, coded.map(line => line.codeId!), userId);
  const verdicts = new Map<number, LineCodeVerdict>();
  for (const line of coded) {
    const code = loaded.get(line.codeId!);
    if (!code) continue;
    verdicts.set(line.key, judgeLineCode(code, line, { permitValid: line.permitValid }));
  }
  return verdicts;
}

/** The products a code may name: a store's own, never another's. */
export async function ownedBy(db: Db, productIds: readonly number[], vendorId: number): Promise<boolean> {
  if (productIds.length === 0) return true;
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(products)
    .where(and(inArray(products.id, [...new Set(productIds)]), eq(products.vendorId, vendorId)));
  return Number(row?.n ?? 0) === new Set(productIds).size;
}

/**
 * Hand back the use of any line code no line of this order still carries
 * (0074): every line it came off has been cancelled, so the order no longer
 * used it, and the shopper may use it again — the rule `closeIfNothingLeft`
 * follows for the order's own code. Only line codes: the order code is the
 * order's to keep or give back.
 */
export async function releaseLineCodes(db: Db, orderId: number): Promise<void> {
  const lines = await db
    .select({ codeId: orderItems.discountCodeId, fulfilment: orderItems.fulfilment })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  const carried = new Set(lines.filter(line => line.codeId !== null && line.fulfilment !== "cancelled").map(line => line.codeId!));
  const gone = [...new Set(lines.filter(line => line.codeId !== null && !carried.has(line.codeId!)).map(line => line.codeId!))];
  if (gone.length === 0) return;
  await db.delete(discountRedemptions).where(and(eq(discountRedemptions.orderId, orderId), inArray(discountRedemptions.codeId, gone)));
}
