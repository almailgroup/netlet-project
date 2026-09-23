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
import {
  getOrderFor,
  getOrderForUser,
  listOrdersFor,
  listOrdersForUser,
  OrderRefused,
  placeOrder,
  recordCashCollected,
  setLineFulfilment,
} from "../orders.js";
import { resolveActor } from "../inventory.js";
import { PAYMENT_METHODS } from "../../shared/commerce/payment.js";
import { FULFILMENT_STATES } from "../../shared/commerce/fulfilment.js";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc.js";
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
        });
        return {
          reference: placed.order.reference,
          total: placed.totals.grandTotal,
          pointsSpent: placed.totals.pointsSpent,
          pointsValue: placed.totals.pointsValue,
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
    .input(z.object({ orderId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => guard(async () =>
      getOrderFor(await resolveActor(ctx.user), input.orderId))),

  /**
   * Move one line along (3.2.8).
   *
   * Per line rather than per order, because that is where fulfilment lives:
   * two items from one seller, one on the shelf and one not, is ordinary.
   */
  setFulfilment: protectedProcedure
    .input(z.object({
      lineId: z.number().int().positive(),
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
    .input(z.object({ orderId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => guard(async () =>
      ({ recorded: await recordCashCollected(await resolveActor(ctx.user), input.orderId) }))),
});

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
    throw error;
  }
}
