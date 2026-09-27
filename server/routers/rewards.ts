/**
 * Referrals and loyalty points, as endpoints.
 *
 * Requirements 3.1.14 and 3.1.15. The arithmetic is pure in
 * `shared/commerce/referral.ts`, the queries are in `server/referral.ts` with
 * their guards beside them, and this translates between the two and HTTP.
 *
 * Every procedure but the admin pair is `protectedProcedure`: a balance is a
 * fact about an account, and there is no anonymous version of it. Recording a
 * referral is deliberately *not* here — it happens inside registration, where
 * the code arrives, rather than as a call a signed-in shopper could make
 * afterwards about themselves.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { rowId } from "../_core/schemas.js";
import { pendingCashOuts, requestCashOut, rewardsFor, settleCashOut } from "../referral.js";
import { resolveActor } from "../inventory.js";
import { protectedProcedure, router } from "../_core/trpc.js";

/** The same translation every other router does: `assertCan` throws, this is the 403. */
async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) {
      throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    }
    throw error;
  }
}

export const rewardsRouter = router({
  /** The code, the balance, what it is worth both ways, and the ledger behind it. */
  mine: protectedProcedure.query(({ ctx }) => rewardsFor(ctx.user.id)),

  /**
   * Ask for the balance in cash (3.1.15).
   *
   * Refused rather than silently ignored when the balance is short or has
   * moved: the shopper pressed a button that named a figure, and the honest
   * answers are "done" and "no", not a page that looks unchanged.
   */
  cashOut: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await requestCashOut(ctx.user.id);
    if (!result) throw new TRPCError({ code: "BAD_REQUEST", message: "rewards.cannotCashOut" });
    return result;
  }),

  /** Cash-outs NetLet still owes. Admin-only, guarded inside the query. */
  pendingCashOuts: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional())
    .query(async ({ ctx, input }) => guard(async () =>
      pendingCashOuts(await resolveActor(ctx.user), input?.limit ?? 200))),

  /** Record that one was paid. */
  settleCashOut: protectedProcedure
    .input(z.object({ entryId: rowId }))
    .mutation(async ({ ctx, input }) => guard(async () =>
      ({ settled: await settleCashOut(await resolveActor(ctx.user), input.entryId) }))),
});
