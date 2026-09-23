/**
 * The finance panel, as an endpoint.
 *
 * One procedure. The guard is inside `server/finance.ts`, next to the query,
 * rather than only here — a second caller added later would skip a
 * router-level check silently, which is the rule every other guard in this
 * codebase follows.
 */
import { z } from "zod";
import { financeReport } from "../finance.js";
import { payoutDueList, payoutReport, sellersUnderPlatformLicence } from "../payouts.js";
import { TRPCError } from "@trpc/server";
import { resolveActor } from "../inventory.js";
import { protectedProcedure, router } from "../_core/trpc.js";

/**
 * `assertCan` is pure and knows nothing about tRPC, so a refusal becomes a 403
 * here rather than a 500 that looks like a bug — the same arrangement the
 * inventory router uses.
 */
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

export const financeRouter = router({
  report: protectedProcedure
    .input(z.object({
      from: z.coerce.date().nullish(),
      to: z.coerce.date().nullish(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return financeReport(actor, { from: input?.from ?? null, to: input?.to ?? null });
    }),

  /**
   * What each seller is owed, by week (3.3.16).
   *
   * Deliberately on the finance router rather than a third one: it reads the
   * same frozen lines the report does, and two routers over one table is how
   * two answers about one figure appear.
   *
   * Scoped inside the query — a vendor sees their own weeks, an admin sees
   * every seller's — so a vendor asking cannot read a competitor's revenue.
   */
  payouts: protectedProcedure
    .input(z.object({ from: z.coerce.date().nullish(), to: z.coerce.date().nullish() }).optional())
    .query(async ({ ctx, input }) => guard(async () =>
      payoutReport(await resolveActor(ctx.user), { from: input?.from, to: input?.to }))),

  /**
   * When each completed order's money is due to its seller (3.3.21).
   *
   * Beside the weekly report rather than on a page of its own: "what am I
   * owed" and "when does it arrive" are one question a seller asks twice.
   */
  payoutsDue: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional())
    .query(async ({ ctx, input }) => guard(async () =>
      payoutDueList(await resolveActor(ctx.user), input?.limit ?? 200))),

  /** Which sellers trade under NetLet's own licence. Admin-only. */
  platformLicensed: protectedProcedure
    .query(async ({ ctx }) => guard(async () => sellersUnderPlatformLicence(await resolveActor(ctx.user)))),
});
