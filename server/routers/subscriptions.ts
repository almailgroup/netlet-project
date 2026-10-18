/**
 * Subscribe & Save (3.1.19), as endpoints.
 *
 * Every procedure is protected and every query is scoped by `ctx.user.id`
 * inside `server/subscriptions.ts`, for the reason orders are: an id is a
 * serial, so another shopper's has to be refused by the query itself.
 * `subscriptions.create` is the feature switch's entry — off stops new
 * standing orders, and the ones already standing keep running, can be paused
 * and can be cancelled, because a switch closes the door and never locks
 * anybody in the room.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { MAX_SUBSCRIPTION_QUANTITY, SUBSCRIPTION_INTERVALS } from "../../Shared/commerce/subscriptions.js";
import { assertCan } from "../../Shared/inventory/permissions.js";
import { changeSubscription, mySubscriptions, runDueSubscriptions, subscribe, subscriptionOverview, SubscriptionRefused } from "../subscriptions.js";
import { ENV } from "../_core/env.js";
import { resolveActor } from "../inventory.js";
import { rowId } from "../_core/schemas.js";
import { protectedProcedure, router } from "../_core/trpc.js";

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SubscriptionRefused) {
      throw new TRPCError({ code: error.reason === "subscriptions.notFound" ? "NOT_FOUND" : error.reason === "subscriptions.alreadyOpen" ? "CONFLICT" : "BAD_REQUEST", message: error.reason });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    throw error;
  }
}

const interval = z.number().int().refine(value => (SUBSCRIPTION_INTERVALS as readonly number[]).includes(value), "subscriptions.badInterval");
const quantity = z.number().int().min(1).max(MAX_SUBSCRIPTION_QUANTITY);

export const subscriptionsRouter = router({
  mine: protectedProcedure.query(({ ctx }) => guard(() => mySubscriptions(ctx.user.id))),

  create: protectedProcedure
    .input(z.object({
      variantId: rowId,
      quantity,
      intervalWeeks: interval,
      addressId: rowId,
      /* The shape only; whether it is tomorrow or later is the rule's answer. */
      firstRunOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .mutation(({ ctx, input }) => guard(() => subscribe(ctx.user.id, input))),

  change: protectedProcedure
    .input(z.object({
      id: rowId,
      change: z.discriminatedUnion("action", [
        z.object({ action: z.literal("pause") }),
        z.object({ action: z.literal("resume") }),
        z.object({ action: z.literal("skip") }),
        z.object({ action: z.literal("cancel") }),
        /* The price the page showed, so a price that moved again is not
           accepted on the shopper's behalf. */
        z.object({ action: z.literal("acceptPrice"), price: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/) }),
        z.object({ action: z.literal("edit"), quantity: quantity.optional(), intervalWeeks: interval.optional(), addressId: rowId.optional() }),
      ]),
    }))
    .mutation(({ ctx, input }) => guard(() => changeSubscription(ctx.user.id, input.id, input.change))),

  /** Counts, and whether a scheduler is configured at all — an administrator's question. */
  overview: protectedProcedure.query(async ({ ctx }) => guard(async () => {
    assertCan(await resolveActor(ctx.user), "platform.configure");
    return { ...(await subscriptionOverview()), scheduled: ENV.cronSecret.length > 0 };
  })),

  /**
   * Run every standing order that has come due, now. The scheduler is the
   * usual caller; this is for an administrator with no scheduler configured,
   * or checking one. Safe to press twice: each run is claimed before it is
   * placed.
   */
  runDue: protectedProcedure.mutation(async ({ ctx }) => guard(async () => {
    assertCan(await resolveActor(ctx.user), "platform.configure");
    return runDueSubscriptions();
  })),
});
