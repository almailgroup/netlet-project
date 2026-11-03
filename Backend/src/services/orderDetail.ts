/**
 * One of the shopper's own orders as the opened order page reads it
 * (`orders.get`): the lines with what each can have done now, the returns,
 * the claims, the parcels' steps and what can still be changed. The help
 * centre reads the same answer, so a solution it offers is exactly what the
 * page would offer — and both are scoped by account in the query.
 */
import { addressChangeState, lineMayChange, shopperChangeState } from "../../../Shared/commerce/orderChanges.js";
import { shopperCancelState } from "../../../Shared/commerce/orderCancel.js";
import { returnStateFor } from "../../../Shared/commerce/returns.js";
import { documentsForShopperOrder } from "./invoices.js";
import { getOrderForUser, lineForShopper, orderForShopper, orderStepsFor } from "./orders.js";
import { parcelsForShopper } from "./parcelCare.js";
import { returnsForShopperOrder } from "./returns.js";
import { lineEligibility, myReviewsForLines } from "./reviews.js";
import { returnWindowDays } from "./settings.js";
import { claimsForShopperOrder, warrantyStateForLines } from "./warranty.js";

export async function orderDetailForShopper(userId: number, reference: string) {
  const found = await getOrderForUser(userId, reference);
  if (!found) return null;

  const now = new Date();
  /* The administrator's return window, so the button and the refusal agree. */
  const windowDays = await returnWindowDays();
  /* The shopper's own reviews of these lines, so each says "Rate this
     item" or what was written and whether it is shown yet. */
  const reviewed = await myReviewsForLines(userId, found.lines.map(line => line.id));
  /* Whether each delivered item may be claimed on, and the store's own warranty words. */
  const warrantyFor = await warrantyStateForLines(found.lines);
  return {
    order: orderForShopper(found.order),
    /* What the driver collects now — the figure every page quotes (`owed.ts`). */
    owedNow: found.owed?.owed ?? found.order.grandTotal,
    windowDays,
    /* What can be done about each parcel once it is at the door — rate the
       delivery (3.4.4), report damage (3.4.2) — resolved with the server's
       clock for the reason the return window is. */
    parcels: await parcelsForShopper(userId, reference, now),
    /* Each line's return requests (3.2.8), newest first, so a line can say
       where its return stands rather than only whether one is allowed. */
    returns: await returnsForShopperOrder(userId, found.order.id),
    /* The invoice and any credit notes (3.6.6), issued here if a write
       at collection or refund missed them. */
    documents: await documentsForShopperOrder(userId, reference),
    /* Whether the shopper may take it back themselves, and if not why —
       the rule `orders.cancel` asks again under a lock. */
    cancel: shopperCancelState(found.order, found.lines),
    /* What else can still be changed before a driver has it — an item, a
       quantity, the address — each the rule `orders.change` and
       `orders.changeAddress` ask again under a lock. */
    change: shopperChangeState(found.order, found.lines),
    changeAddress: addressChangeState(found.order, found.lines),
    /* Each parcel as steps for "Track order", with the store's estimate. */
    steps: await orderStepsFor(found.order, found.lines),
    /* Warranty claims on its lines (migration 0072), newest first, with where each stands. */
    warranty: await claimsForShopperOrder(userId, found.order.id),
    lines: found.lines.map(line => ({
      ...lineForShopper(line),
      /*
       * `order_items.delivered_at` is real now, so the window is measured
       * from when the goods arrived rather than from `updatedAt`. That
       * stand-in was wrong in a known direction — a vendor editing the
       * line pushed the window out — and this is the one line the old
       * comment promised would change when the column landed.
       *
       * The date outlives the status on purpose: a line delivered and then
       * returned keeps its arrival date, which is what lets the return
       * window and a review both still make sense afterwards.
       */
      returnState: returnStateFor(
        found.order,
        { fulfilment: line.fulfilment, deliveredAt: line.deliveredAt },
        now,
        windowDays,
      ),
      review: reviewed.get(line.id) ?? null,
      /* Whether it may be rated now — `eligibilityFor`, the rule `reviews.write` refuses with. */
      reviewEligibility: lineEligibility(found.order, line, reviewed.has(line.id)),
      /* A warranty claim: whether one may be filed now, and what the store says it covers. */
      warrantyEligibility: warrantyFor.get(line.id)?.eligibility ?? { allowed: false as const, reason: "warranty.notDelivered" as const },
      warrantyTerms: warrantyFor.get(line.id)?.terms ?? null,
      /* Whether the shopper may still cancel it or lower its quantity: in
         the store's hands, unpaid, and not part of a set. */
      changeable: found.order.status === "pending_payment" && lineMayChange(line) && line.bundleId === null,
    })),
  };
}

export type ShopperOrderDetail = NonNullable<Awaited<ReturnType<typeof orderDetailForShopper>>>;
