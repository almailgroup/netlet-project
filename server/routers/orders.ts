/**
 * A shopper's own orders and returns.
 *
 * `server/orders.ts` has had `listOrdersForUser` and `getOrderForUser` since
 * the orders tables landed, and nothing could call them: there was no router,
 * so the account page had no way to ask. This is that missing half.
 *
 * Every procedure is `protectedProcedure` and every query is scoped by
 * `ctx.user.id` inside the data layer rather than filtered here. An order id is
 * a serial and a reference is guessable enough to try, so "show me order 4"
 * must not be a way to read somebody else's purchase — and a scope applied in
 * the router is one a second caller added later skips silently, which is the
 * same argument that puts the inventory guards next to their queries.
 */
import { z } from "zod";
import { rowId } from "../_core/schemas.js";
import {
  FulfilmentRefused,
  getOrderFor,
  getOrderForUser,
  listOrdersFor,
  listOrdersForUser,
  OrderRefused,
  placeOrder,
  recordCashCollected,
  quoteVoucherForCart,
  setLineFulfilment,
} from "../orders.js";
import { resolveActor } from "../inventory.js";
import { fileClaim, parcelsForShopper, ParcelCareRefused, rateDelivery } from "../parcelCare.js";
import { MAX_DELIVERY_COMMENT } from "../../shared/commerce/deliveryRatings.js";
import { MAX_CLAIM_DESCRIPTION } from "../../shared/commerce/damageClaims.js";
import { cancelReturn, requestReturn, returnsForShopperOrder, ReturnRefused } from "../returns.js";
import { MAX_RETURN_NOTE, RETURN_KINDS, RETURN_REASONS } from "../../shared/commerce/returnRequests.js";
import { riskForOrders } from "../fraud.js";
import { createGiftCard, listVouchers, saveDiscountCode } from "../vouchers.js";
import { VOUCHER_KINDS } from "../../shared/commerce/vouchers.js";
import { PAYMENT_METHODS } from "../../shared/commerce/payment.js";
import { FULFILMENT_STATES } from "../../shared/commerce/fulfilment.js";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc.js";
import { returnStateFor, RETURN_WINDOW_DAYS } from "../../shared/commerce/returns.js";

export const ordersRouter = router({
  /**
   * The shopper's orders, newest first and paged.
   *
   * Paged from the start rather than when somebody complains: this is the one
   * list on the site that only grows, and an unbounded query over a decade of
   * orders is the admin lists' ceiling problem with a longer fuse.
   */
  list: protectedProcedure
    .input(z.object({ page: z.number().int().min(1).optional(), pageSize: z.number().int().min(1).max(100).optional() }).optional())
    .query(({ ctx, input }) => listOrdersForUser(ctx.user.id, input ?? {})),

  /**
   * One order with its lines, and what each line's return looks like.
   *
   * The return state is resolved here rather than on the client for the reason
   * the password floor is: `returnStateFor` is the same function both sides
   * import, so a page cannot offer a return the API would refuse. Sending the
   * decision rather than the ingredients also means the clock is the server's,
   * and a shopper cannot reopen a closed window by changing their system date.
   */
  get: protectedProcedure
    .input(z.object({ reference: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const found = await getOrderForUser(ctx.user.id, input.reference);
      if (!found) return null;

      const now = new Date();
      return {
        order: found.order,
        windowDays: RETURN_WINDOW_DAYS,
        /* What can be done about each parcel once it is at the door — rate the
           delivery (3.4.4), report damage (3.4.2) — resolved with the server's
           clock for the reason the return window is. */
        parcels: await parcelsForShopper(ctx.user.id, input.reference, now),
        /* Each line's return requests (3.2.8), newest first, so a line can say
           where its return stands rather than only whether one is allowed. */
        returns: await returnsForShopperOrder(ctx.user.id, found.order.id),
        lines: found.lines.map(line => ({
          ...line,
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
          ),
        })),
      };
    }),

  /**
   * Rate how one parcel was delivered (3.4.4), or change the rating.
   *
   * Apart from the product review on purpose: a lamp does not earn one star
   * because the van was late. The order is resolved by reference *and* the
   * shopper's id inside the data layer, so another shopper's reference is not
   * found rather than refused.
   */
  rateDelivery: protectedProcedure
    .input(z.object({
      reference: z.string().min(1).max(64),
      parcelKey: z.string().min(1).max(600),
      rating: z.number().int().min(1).max(5),
      comment: z.string().max(MAX_DELIVERY_COMMENT).nullish(),
    }))
    .mutation(async ({ ctx, input }) => careGuard(async () => {
      await rateDelivery(ctx.user.id, input);
      return { success: true } as const;
    })),

  /**
   * Ask to send a line back for a refund or an exchange (3.2.8). Decided
   * automatically where a rule can decide it (3.5.2); the reply says what.
   */
  requestReturn: protectedProcedure
    .input(z.object({
      reference: z.string().min(1).max(64),
      orderItemId: rowId,
      kind: z.enum(RETURN_KINDS),
      reason: z.enum(RETURN_REASONS),
      note: z.string().max(MAX_RETURN_NOTE + 100).nullish(),
    }))
    .mutation(async ({ ctx, input }) => returnGuard(() => requestReturn(ctx.user.id, input))),

  /** Withdraw a return before the item has been collected. */
  cancelReturn: protectedProcedure
    .input(z.object({ requestId: rowId }))
    .mutation(async ({ ctx, input }) => returnGuard(async () => {
      await cancelReturn(ctx.user.id, input.requestId);
      return { success: true } as const;
    })),

  /**
   * Report that a parcel arrived damaged (3.4.2).
   *
   * The amount is checked against what the named lines were sold for, read
   * from the order rather than from this input; the claim is against whichever
   * company carried the parcel, which the shopper does not need to know.
   */
  claimDamage: protectedProcedure
    .input(z.object({
      reference: z.string().min(1).max(64),
      lineIds: z.array(rowId).min(1).max(100),
      amount: z.string().max(16),
      description: z.string().max(MAX_CLAIM_DESCRIPTION),
      evidenceUrl: z.string().trim().max(2000).nullish(),
    }))
    .mutation(async ({ ctx, input }) => careGuard(async () =>
      fileClaim({ kind: "shopper", userId: ctx.user.id, reference: input.reference }, input))),

  /**
   * Place the basket as a cash-on-delivery order (3.2.2).
   *
   * This is the first thing in NetLet that creates a real order, and it is
   * possible only because cash needs no provider: nothing is authorised or
   * captured. The order is written `pending_payment` and stays there until a
   * seller records that the driver collected — saying `paid` here would put
   * revenue in the finance panel that nobody has.
   *
   * `protectedProcedure`, because an order somebody can neither find nor
   * return is not an order. The address and contact come from the form; the
   * prices, the delivery and whether cash is even available are all decided
   * server-side, so the caller cannot set their own.
   */
  place: protectedProcedure
    .input(z.object({
      cartId: z.string().min(1).max(64),
      paymentMethod: z.enum(PAYMENT_METHODS),
      contactName: z.string().trim().max(255).nullish(),
      contactPhone: z.string().trim().max(40).nullish(),
      deliveryZoneId: z.string().trim().max(64).nullish(),
      addressLine: z.string().trim().min(1).max(500),
      addressNotes: z.string().trim().max(500).nullish(),
      /* Whether to spend the balance (3.1.15). How much it covers is the
         server's arithmetic — a figure sent from a browser is a figure to
         check against the one read here anyway. */
      usePoints: z.boolean().optional(),
      /* A discount code or a gift card, in one field (3.2.3): a shopper
         holding a code does not necessarily know which it is. */
      voucherCode: z.string().trim().max(40).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const placed = await placeOrder(input.cartId, {
          email: ctx.user.email,
          userId: ctx.user.id,
          paymentMethod: input.paymentMethod,
          contactName: input.contactName ?? ctx.user.name ?? null,
          contactPhone: input.contactPhone ?? null,
          deliveryZoneId: input.deliveryZoneId ?? null,
          addressLine: input.addressLine,
          addressNotes: input.addressNotes ?? null,
          usePoints: input.usePoints ?? false,
          voucherCode: input.voucherCode ?? null,
        });
        return {
          reference: placed.order.reference,
          total: placed.totals.grandTotal,
          pointsSpent: placed.totals.pointsSpent,
          pointsValue: placed.totals.pointsValue,
          discountValue: placed.totals.discountValue,
          giftCardValue: placed.totals.giftCardValue,
        };
      } catch (error) {
        /* Every refusal is already a message key, so the client says it in the
           shopper's own language rather than showing an English sentence. */
        if (error instanceof OrderRefused) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.reason });
        }
        throw error;
      }
    }),

  /**
   * What a typed code is worth on this basket (3.2.3).
   *
   * A query rather than a mutation, and nothing is reserved: this is the same
   * arithmetic the order will do, run early so the summary can show it. The
   * figure is read again at the moment of sale, the way every price is.
   *
   * `publicProcedure`, because a gift card belongs to whoever holds it — the
   * whole point of one — and a guest basket may carry a discount code too.
   */
  quoteVoucher: publicProcedure
    .input(z.object({ cartId: z.string().min(1).max(64), code: z.string().trim().min(1).max(40) }))
    .query(({ ctx, input }) => quoteVoucherForCart(input.cartId, input.code, ctx.user?.id ?? null)),

  /* ----------------------------------------------------------- minting --- */

  /** Every code and card, for the promotions page. Admin-only, guarded inside. */
  vouchers: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(async ({ ctx, input }) => guard(async () =>
      listVouchers(await resolveActor(ctx.user), input?.limit ?? 100))),

  /** Create or edit a discount code. Editing a live campaign is ordinary. */
  saveDiscountCode: protectedProcedure
    .input(z.object({
      code: z.string().trim().min(3).max(40),
      kind: z.enum(VOUCHER_KINDS),
      value: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/),
      minSpend: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/).nullable().optional(),
      startsAt: z.coerce.date().nullable().optional(),
      endsAt: z.coerce.date().nullable().optional(),
      maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
      perShopper: z.number().int().min(1).max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => guard(async () =>
      saveDiscountCode(await resolveActor(ctx.user), input))),

  /** Mint a gift card. The code is generated: it is the whole credential. */
  createGiftCard: protectedProcedure
    .input(z.object({
      amount: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/),
      note: z.string().trim().max(200).nullable().optional(),
      expiresAt: z.coerce.date().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => guard(async () =>
      createGiftCard(await resolveActor(ctx.user), input))),

  /* ------------------------------------------------------------- selling --- */

  /**
   * The orders a seller has to act on, or every order for an admin.
   *
   * `listOrdersFor` and `getOrderFor` were written the day the tables landed
   * and nothing could call them — the same gap `listOrdersForUser` had, and
   * with a sharper cost: without this nobody can mark a parcel shipped or a
   * driver's cash collected, so `delivered_at` never gets set, reviews never
   * open, payouts never start and a referral never pays. The functions already
   * scope themselves by vendor and guard beside the query; this is the missing
   * half.
   */
  forSeller: protectedProcedure
    .input(z.object({ page: z.number().int().min(1).optional(), pageSize: z.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => guard(async () =>
      listOrdersFor(await resolveActor(ctx.user), input ?? {}))),

  /**
   * One order, as whoever is asking may see it.
   *
   * A vendor gets their own lines and the address to deliver to; an admin gets
   * every line. The slicing is the data layer's, not this router's, and an
   * order holding none of a vendor's lines comes back null rather than empty —
   * an order with no lines would confirm that the order exists.
   */
  forSellerDetail: protectedProcedure
    .input(z.object({ orderId: rowId }))
    .query(async ({ ctx, input }) => guard(async () =>
      getOrderFor(await resolveActor(ctx.user), input.orderId))),

  /**
   * How much attention each of these orders wants (3.6.5).
   *
   * Admin-only and guarded inside the query: the signals name other accounts'
   * behaviour, so a vendor reading their own order desk does not get them.
   * Takes the ids already on screen rather than running its own view.
   */
  risk: protectedProcedure
    .input(z.object({ ids: z.array(rowId).max(100) }))
    .query(async ({ ctx, input }) => guard(async () =>
      riskForOrders(await resolveActor(ctx.user), input.ids))),

  /**
   * Move one line along (3.2.8).
   *
   * Per line rather than per order, because that is where fulfilment lives:
   * two items from one seller, one on the shelf and one not, is ordinary.
   */
  setFulfilment: protectedProcedure
    .input(z.object({
      lineId: rowId,
      fulfilment: z.enum(FULFILMENT_STATES),
    }))
    .mutation(async ({ ctx, input }) => guard(async () =>
      setLineFulfilment(await resolveActor(ctx.user), input.lineId, input.fulfilment))),

  /**
   * Record that the driver collected the cash (3.2.2).
   *
   * This is the moment a cash order becomes paid, and the predicate is inside
   * the `UPDATE`, so two people pressing it cannot both be told they were the
   * one who recorded it. `false` is the honest answer for an order that was
   * already paid, is not a cash order, or is not theirs.
   */
  markCollected: protectedProcedure
    .input(z.object({ orderId: rowId }))
    .mutation(async ({ ctx, input }) => guard(async () =>
      ({ recorded: await recordCashCollected(await resolveActor(ctx.user), input.orderId) }))),
});

/** A return refused for a reason the shopper can act on. */
async function returnGuard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ReturnRefused) {
      throw new TRPCError({ code: error.reason === "returns.notFound" ? "NOT_FOUND" : error.reason === "returns.moved" ? "CONFLICT" : "BAD_REQUEST", message: error.reason });
    }
    throw error;
  }
}

/** A rating or a claim refused for a reason the shopper can act on. */
async function careGuard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ParcelCareRefused) {
      throw new TRPCError({ code: error.reason === "parcel.notFound" ? "NOT_FOUND" : "BAD_REQUEST", message: error.reason });
    }
    throw error;
  }
}

/** The same translation every other router does: `assertCan` throws, this is the 403. */
async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) {
      throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    }
    if (message === "NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND", message: "orders.lineGone" });
    /* A move the line's own rules refuse is the caller's to fix, and says why —
       it used to have nowhere to go but a 500. */
    if (error instanceof FulfilmentRefused) {
      throw new TRPCError({ code: error.reason === "orders.lineMoved" ? "CONFLICT" : "BAD_REQUEST", message: error.reason });
    }
    throw error;
  }
}
