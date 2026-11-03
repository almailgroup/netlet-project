/**
 * The shopper's own changes to an order before a driver collects it — the
 * database half of `Shared/commerce/orderChanges.ts`, on the owner's word:
 * cancel an item, lower a quantity, change the address, and buy it all again.
 *
 * **A quote first, then the change, and the two must agree.** `quote` prices
 * the change and changes nothing; `apply` asks the same question again inside
 * one transaction, under a lock on the order and its lines, and refuses if
 * what the driver will collect is not the figure the shopper was shown
 * (`orders.changeMoved`) — a store moving a line to the driver, or changing
 * its delivery fee, between the two presses.
 *
 * **Every figure written is the rule's**: the kept part of a lowered line by
 * the line's own frozen terms and a cancelled sibling carrying the difference,
 * the order's frozen total restated so `stillOwed` reads the new figure off
 * it, the stores' fees a smaller order no longer clears, a code below its
 * minimum taken off (its use handed back), and stored value that no longer
 * fits handed back — the card's balance, then the points as an
 * `order_changed` entry. Units go back to the pool they were sold from.
 *
 * Recorded on the trail as the shopper's act (`order.shopperChange`,
 * `order.shopperAddress`), with what was and what is, since the order keeps no
 * history table of its own. A store is not sent a notice — the notice kinds
 * are the schema's and none was approved — so its desk shows the lines as
 * they now are.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  customerAddresses,
  discountCodes,
  discountRedemptions,
  giftCardUses,
  orderItemAddons,
  orderItems,
  orders,
  pointEntries,
  productVariants,
  users,
  vendors,
} from "../../database/schema.js";
import { addMoney, fromFils, toFils } from "../../../Shared/money.js";
import { stillOwed } from "../../../Shared/commerce/collection.js";
import type { DeliveryRule, FrozenDelivery } from "../../../Shared/commerce/delivery.js";
import { cleanParts, composeAddressLine, missingParts } from "../../../Shared/commerce/kuwaitAddress.js";
import { storedPin } from "../../../Shared/commerce/geo.js";
import {
  addressChangeState,
  quoteChange,
  type ChangeLine,
  type ChangeQuote,
  type ChangeRefusal,
  type LineChange,
} from "../../../Shared/commerce/orderChanges.js";
import { FILS_PER_POINT } from "../../../Shared/commerce/referral.js";
import { MAX_LINE_QUANTITY } from "../../../Shared/commerce/types.js";
import { recordAudit } from "./audit.js";
import { addCartLines, createCart, getCart } from "./catalog.js";
import { getDb } from "./db.js";
import { withProductAlerts } from "./notifications.js";
import { closeIfNothingLeft, returnUnits } from "./orders.js";
import { refundGiftCard } from "./vouchers.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** A refusal the page says in words. */
export class OrderChangeRefused extends Error {
  constructor(public readonly reason: ChangeRefusal | "orders.detailMissing" | "orders.addressUnknown" | "address.needsParts") {
    super(reason);
    this.name = "OrderChangeRefused";
  }
}

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

/** The order and its lines as the rules read them, locked when the change is for real. */
async function load(db: Db, userId: number, reference: string, lock: boolean) {
  const orderQuery = db
    .select()
    .from(orders)
    .where(and(eq(orders.reference, reference), eq(orders.userId, userId)))
    .limit(1);
  const [order] = lock ? await orderQuery.for("update") : await orderQuery;
  if (!order) throw new OrderChangeRefused("orders.detailMissing");

  const lineQuery = db.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(orderItems.id);
  const rows = lock ? await lineQuery.for("update") : await lineQuery;
  const addons = rows.length
    ? await db
        .select({ orderItemId: orderItemAddons.orderItemId, price: orderItemAddons.price })
        .from(orderItemAddons)
        .where(inArray(orderItemAddons.orderItemId, rows.map(row => row.id)))
    : [];
  const perUnit = new Map<number, bigint>();
  for (const addon of addons) perUnit.set(addon.orderItemId, (perUnit.get(addon.orderItemId) ?? 0n) + toFils(addon.price));

  const lines: ChangeLine[] = rows.map(row => ({
    id: row.id,
    fulfilment: row.fulfilment,
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    lineTotal: row.lineTotal,
    commissionPercent: row.commissionPercent,
    commissionFixed: row.commissionFixed,
    commissionAmount: row.commissionAmount,
    vendorNet: row.vendorNet,
    affiliateVendorPercent: row.affiliateVendorPercent,
    addonsPerUnit: fromFils(perUnit.get(row.id) ?? 0n),
    bundleId: row.bundleId,
    deliveryChoice: row.deliveryChoice,
    destinationLabel: (row.destination as { label?: string } | null)?.label ?? null,
  }));

  const vendorIds = [...new Set(rows.map(row => row.vendorId).filter((id): id is number => id !== null))];
  const ruleRows = vendorIds.length
    ? await db
        .select({ id: vendors.id, flat: vendors.deliveryFlat, freeOver: vendors.deliveryFreeOver, fast: vendors.fastDeliveryFee })
        .from(vendors)
        .where(inArray(vendors.id, vendorIds))
    : [];
  const rules = new Map<number | null, DeliveryRule>(ruleRows.map(row => [row.id, { flat: row.flat, freeOver: row.freeOver, fastFlat: row.fast }]));

  const [code] = order.discountCode
    ? await db
        .select({ kind: discountCodes.kind, value: discountCodes.value, minSpend: discountCodes.minSpend })
        .from(discountCodes)
        .where(eq(discountCodes.code, order.discountCode))
        .limit(1)
    : [];

  return { order, rows, lines, rules, code: code ? { kind: code.kind === "fixed" ? "fixed" as const : "percent" as const, value: code.value, minSpend: code.minSpend } : null };
}

function priced(loaded: Awaited<ReturnType<typeof load>>, changes: LineChange[]) {
  const { order } = loaded;
  return quoteChange({
    order: {
      status: order.status,
      grandTotal: order.grandTotal,
      member: order.member,
      discountCode: order.discountCode,
      discountValue: order.discountValue,
      pointsValue: order.pointsValue,
      giftCardValue: order.giftCardValue,
      deliveryBreakdown: (order.deliveryBreakdown as FrozenDelivery | null) ?? null,
    },
    lines: loaded.lines,
    changes,
    code: loaded.code,
    rules: loaded.rules,
  });
}

/** What the change would do, and nothing else. */
export async function quoteOrderChange(userId: number, reference: string, changes: LineChange[]): Promise<ChangeQuote> {
  const db = await handle();
  const done = priced(await load(db, userId, reference, false), changes);
  if ("refused" in done) throw new OrderChangeRefused(done.refused);
  return done.quote;
}

/**
 * The change, for real: asked again under the lock, refused if the figure
 * moved, and written in one transaction so a failure half-way hands nothing
 * back twice.
 */
export async function applyOrderChange(userId: number, reference: string, changes: LineChange[], expectOwed: string): Promise<ChangeQuote> {
  const db = await handle();
  const peek = await db
    .select({ productId: orderItems.productId })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.reference, reference), eq(orders.userId, userId)));

  const changed = await withProductAlerts(peek.map(row => row.productId), () => db.transaction(async tx => {
    const w = tx as unknown as Db;
    const loaded = await load(w, userId, reference, true);
    const done = priced(loaded, changes);
    if ("refused" in done) throw new OrderChangeRefused(done.refused);
    if (toFils(done.quote.owedAfter) !== toFils(expectOwed)) throw new OrderChangeRefused("orders.changeMoved");

    const { order, rows } = loaded;
    const byId = new Map(rows.map(row => [row.id, row]));
    for (const change of done.quote.lines) {
      const row = byId.get(change.lineId)!;
      const pool = row.preordered ? "preorder" as const : "stock" as const;
      if (change.to === 0) {
        const [moved] = await w
          .update(orderItems)
          .set({ fulfilment: "cancelled", deliveredAt: null })
          .where(and(eq(orderItems.id, row.id), inArray(orderItems.fulfilment, ["pending", "preparing"])))
          .returning({ id: orderItems.id });
        if (!moved) throw new OrderChangeRefused("orders.changeLineGone");
        if (row.variantId !== null) await returnUnits(w, row.variantId, row.quantity, pool, row.centreId);
        continue;
      }
      const kept = done.lines.find(line => line.id === row.id)!;
      const gone = done.lines.find(line => line.id === -row.id)!;
      const [moved] = await w
        .update(orderItems)
        .set({ quantity: kept.quantity, lineTotal: kept.lineTotal, commissionAmount: kept.commissionAmount, vendorNet: kept.vendorNet })
        .where(and(eq(orderItems.id, row.id), inArray(orderItems.fulfilment, ["pending", "preparing"])))
        .returning({ id: orderItems.id });
      if (!moved) throw new OrderChangeRefused("orders.changeLineGone");
      /* The units not coming, as a cancelled line of their own: the order still
         shows what was ordered and what became of it. */
      const { id: _id, createdAt: _created, updatedAt: _updated, ...copy } = row;
      const [sibling] = await w
        .insert(orderItems)
        .values({ ...copy, quantity: gone.quantity, lineTotal: gone.lineTotal, commissionAmount: gone.commissionAmount, vendorNet: gone.vendorNet, fulfilment: "cancelled", deliveredAt: null })
        .returning({ id: orderItems.id });
      const extras = await w.select().from(orderItemAddons).where(eq(orderItemAddons.orderItemId, row.id));
      if (extras.length) {
        await w.insert(orderItemAddons).values(extras.map(({ id: _addon, ...extra }) => ({ ...extra, orderItemId: sibling.id })));
      }
      if (row.variantId !== null) await returnUnits(w, row.variantId, gone.quantity, pool, row.centreId);
    }

    /* The order's figures, restated so every page reads the new total. */
    const pointsBackFils = toFils(done.quote.pointsBack);
    const pointsBack = Number(pointsBackFils / FILS_PER_POINT);
    await w
      .update(orders)
      .set({
        deliveryBreakdown: done.write.breakdown,
        deliveryTotal: addMoney(order.deliveryTotal, done.write.deliveryAdded),
        deliveryWaived: addMoney(order.deliveryWaived, done.write.waivedAdded),
        discountValue: done.write.discountValue,
        pointsValue: done.write.pointsValue,
        pointsSpent: Math.max(0, order.pointsSpent - pointsBack),
        giftCardValue: done.write.giftCardValue,
        grandTotal: done.write.grandTotal,
      })
      .where(eq(orders.id, order.id));

    if (order.giftCardCode && toFils(done.quote.giftCardBack) > 0n) {
      await refundGiftCard(w, order.giftCardCode, done.quote.giftCardBack);
      if (toFils(done.write.giftCardValue) === 0n) {
        await w.delete(giftCardUses).where(eq(giftCardUses.orderId, order.id));
      } else {
        await w.update(giftCardUses).set({ amount: done.write.giftCardValue }).where(eq(giftCardUses.orderId, order.id));
      }
    }
    if (pointsBack > 0 && order.userId !== null) {
      await w.insert(pointEntries).values({ userId: order.userId, points: pointsBack, reason: "order_changed", orderId: order.id });
    }
    /* A code the smaller order no longer earns is the shopper's to use again. */
    if (done.quote.codeLost) await w.delete(discountRedemptions).where(eq(discountRedemptions.orderId, order.id));

    await closeIfNothingLeft(w, order.id);
    return { quote: done.quote, orderId: order.id };
  }));

  /* On the trail once it has happened — after the commit, so a change that
     rolled back is never recorded as made. */
  const { quote } = changed;
  await recordAudit(await shopperOnTrail(db, userId), {
    action: "order.shopperChange",
    subjectType: "order",
    subjectId: changed.orderId,
    subjectLabel: reference,
    before: { lines: quote.lines.map(line => ({ id: line.lineId, quantity: line.from })), owed: quote.owedBefore },
    after: {
      lines: quote.lines.map(line => ({ id: line.lineId, quantity: line.to })),
      owed: quote.owedAfter,
      addedFees: quote.addedFees.map(fee => ({ store: fee.vendorName, fee: fee.fee, waived: fee.waived })),
      discount: quote.discountAfter,
      giftCardBack: quote.giftCardBack,
      pointsBack: quote.pointsBack,
    },
  });
  return quote;
}

/** The shopper as the trail names them. */
async function shopperOnTrail(db: Db, userId: number) {
  const [who] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return { id: userId, email: who?.email ?? null, role: "customer" };
}

/**
 * The order's own address, moved to another of the shopper's saved addresses
 * while nothing going there has left. A store charges the same anywhere in
 * Kuwait (a fee is a store's and a door's, never an area's), so what the
 * driver collects is asked again and is the same figure — and a line sent to
 * an address of its own keeps its own.
 */
export async function changeOrderAddress(userId: number, reference: string, addressId: number): Promise<{ addressLine: string; owed: string }> {
  const db = await handle();
  const changed = await db.transaction(async tx => {
    const w = tx as unknown as Db;
    const [order] = await w
      .select()
      .from(orders)
      .where(and(eq(orders.reference, reference), eq(orders.userId, userId)))
      .limit(1)
      .for("update");
    if (!order) throw new OrderChangeRefused("orders.detailMissing");
    const lines = await w
      .select({ fulfilment: orderItems.fulfilment, destination: orderItems.destination, vendorId: orderItems.vendorId, lineTotal: orderItems.lineTotal, deliveryChoice: orderItems.deliveryChoice })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id))
      .for("update");
    const state = addressChangeState(order, lines);
    if (!state.changeable) throw new OrderChangeRefused(state.reason);

    const [address] = await w
      .select()
      .from(customerAddresses)
      .where(and(eq(customerAddresses.id, addressId), eq(customerAddresses.userId, userId)))
      .limit(1);
    if (!address) throw new OrderChangeRefused("orders.addressUnknown");
    const parts = cleanParts({
      area: address.area,
      block: address.block,
      street: address.street,
      avenue: address.avenue,
      building: address.building,
      floor: address.floor,
      apartment: address.apartment,
      paciNumber: address.paciNumber,
    });
    /* A saved address from before the parts keeps its line; one with parts
       must have the ones a driver needs, the checkout's own rule. */
    if (parts && missingParts(parts).length) throw new OrderChangeRefused("address.needsParts");
    const addressLine = parts ? composeAddressLine(parts) : address.addressLine;

    await w
      .update(orders)
      .set({
        contactName: address.contactName ?? order.contactName,
        contactPhone: address.contactPhone ?? order.contactPhone,
        deliveryZoneId: address.governorate ?? order.deliveryZoneId,
        addressLine,
        addressNotes: address.addressNotes ?? null,
        deliveryPin: storedPin(address.pin),
        deliveryAddressParts: parts,
      })
      .where(eq(orders.id, order.id));

    const owed = stillOwed(
      { grandTotal: order.grandTotal, deliveryBreakdown: (order.deliveryBreakdown as FrozenDelivery | null) ?? null },
      lines.map(line => ({ vendorId: line.vendorId, destinationLabel: (line.destination as { label?: string } | null)?.label ?? null, lineTotal: line.lineTotal, fulfilment: line.fulfilment, choice: line.deliveryChoice })),
    ).owed;

    return {
      addressLine,
      owed,
      audit: {
        subjectId: order.id,
        before: { address: order.addressLine, area: order.deliveryZoneId },
        after: { address: addressLine, area: address.governorate ?? order.deliveryZoneId },
      },
    };
  });
  await recordAudit(await shopperOnTrail(db, userId), {
    action: "order.shopperAddress",
    subjectType: "order",
    subjectId: changed.audit.subjectId,
    subjectLabel: reference,
    before: changed.audit.before,
    after: changed.audit.after,
  });
  return { addressLine: changed.addressLine, owed: changed.owed };
}

export type BuyAgainSkip = { title: string; reason: "unavailable" | "soldOut" };

/**
 * Everything on an order back in the bag, at today's prices — the bag stores
 * no price, so nothing old is carried over. A product no longer on sale, or
 * sold out, is named rather than dropped in silence; a quantity larger than
 * what is left is what is left. Plain lines: extras and sets are chosen again
 * on the product page, where their prices are.
 */
export async function buyAgain(userId: number, reference: string, cartId: string | null): Promise<{ cartId: string | null; added: number; skipped: BuyAgainSkip[] }> {
  const db = await handle();
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.reference, reference), eq(orders.userId, userId)))
    .limit(1);
  if (!order) throw new OrderChangeRefused("orders.detailMissing");

  const lines = await db
    .select({ variantId: orderItems.variantId, title: orderItems.productTitle, quantity: orderItems.quantity, fulfilment: orderItems.fulfilment })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(orderItems.id);
  /* One wish per variant: a lowered line's cancelled half is the same thing. */
  const wanted = new Map<number, { title: string; quantity: number }>();
  const skipped: BuyAgainSkip[] = [];
  for (const line of lines) {
    if (line.variantId === null) {
      if (line.fulfilment !== "cancelled") skipped.push({ title: line.title, reason: "unavailable" });
      continue;
    }
    const had = wanted.get(line.variantId);
    if (line.fulfilment === "cancelled" && had) continue;
    wanted.set(line.variantId, { title: line.title, quantity: Math.max(had?.quantity ?? 0, line.fulfilment === "cancelled" ? 0 : line.quantity) || line.quantity });
  }
  if (wanted.size === 0) return { cartId, added: 0, skipped };

  const levels = await db
    .select({ id: productVariants.id, stock: productVariants.stock, preorder: productVariants.preorderStock })
    .from(productVariants)
    .where(inArray(productVariants.id, [...wanted.keys()]));
  const left = new Map(levels.map(row => [row.id, Math.max(row.stock, row.preorder)]));

  const toAdd: { variantId: string; quantity: number }[] = [];
  for (const [variantId, want] of wanted) {
    const available = left.get(variantId);
    if (available === undefined) { skipped.push({ title: want.title, reason: "unavailable" }); continue; }
    if (available < 1) { skipped.push({ title: want.title, reason: "soldOut" }); continue; }
    toAdd.push({ variantId: String(variantId), quantity: Math.min(want.quantity, available, MAX_LINE_QUANTITY) });
  }
  if (!toAdd.length) return { cartId, added: 0, skipped };

  /* The shopper's bag, or a new one that is theirs from the start. */
  const existing = cartId ? await getCart(cartId) : null;
  const cart = existing ? await addCartLines(existing.id, toAdd) : await createCart(toAdd, userId);
  if (!cart) throw new Error("The bag could not be read");
  /* Only what actually went in counts: a product unpublished since is refused
     by the bag's own check and named. */
  const inBag = new Set(cart.items.map(item => item.variantId));
  let added = 0;
  for (const line of toAdd) {
    if (inBag.has(line.variantId)) added += 1;
    else skipped.push({ title: wanted.get(Number(line.variantId))!.title, reason: "unavailable" });
  }
  return { cartId: cart.id, added, skipped };
}
