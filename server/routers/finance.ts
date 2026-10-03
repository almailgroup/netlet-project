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
import { payoutHistory, PayoutRefused, readyBatches, recordPayout } from "../payoutRuns.js";
import { rowId } from "../_core/schemas.js";
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
    if (error instanceof PayoutRefused) {
      throw new TRPCError({ code: error.reason === "payouts.notFound" ? "NOT_FOUND" : error.reason === "payouts.nothingDue" ? "CONFLICT" : "BAD_REQUEST", message: error.reason });
    }
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
    /* Through `guard`, like the three below it. It was the one procedure in
       this file that skipped the translator the file's own comment explains —
       so a shopper or a vendor asking for the platform's figures got exactly
       the 500 that looks like a bug, rather than the 403 they are owed. */
    .query(async ({ ctx, input }) => guard(async () =>
      financeReport(await resolveActor(ctx.user), { from: input?.from ?? null, to: input?.to ?? null }))),

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

  /**
   * Payout runs (3.3.21): each seller's next batch, assembled by the schedule;
   * recording one as sent; and the payouts already made. A store's manager
   * reads their own; recording is NetLet's alone.
   */
  payoutBatches: protectedProcedure.query(async ({ ctx }) => guard(async () => readyBatches(await resolveActor(ctx.user)))),
  recordPayout: protectedProcedure
    .input(z.object({ vendorId: rowId, bankReference: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => guard(async () => recordPayout(await resolveActor(ctx.user), input.vendorId, input.bankReference))),
  payoutHistory: protectedProcedure
    .input(z.object({ page: z.number().int().min(1).max(100_000).optional() }).optional())
    .query(async ({ ctx, input }) => guard(async () => payoutHistory(await resolveActor(ctx.user), input ?? {}))),

  /** Which sellers trade under NetLet's own licence. Admin-only. */
  platformLicensed: protectedProcedure
    .query(async ({ ctx }) => guard(async () => sellersUnderPlatformLicence(await resolveActor(ctx.user)))),
});
