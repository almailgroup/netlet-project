/**
 * NetLet membership (4.1), as endpoints. A shopper reads their own; granting,
 * ending and the programme's terms are NetLet's (`membership.manage`), guarded
 * in `server/membership.ts` beside the queries.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { MAX_GRANT_MONTHS, MAX_GRANT_NOTE } from "../../shared/commerce/membership.js";
import { MembershipRefused, endMembership, getTerms, grantMembership, listMemberships, myMembership, programmeReport, setTerms } from "../membership.js";
import { resolveActor } from "../inventory.js";
import { rowId } from "../_core/schemas.js";
import { protectedProcedure, router } from "../_core/trpc.js";

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof MembershipRefused) {
      throw new TRPCError({ code: error.reason === "membership.notFound" || error.reason === "membership.noSuchAccount" ? "NOT_FOUND" : "BAD_REQUEST", message: error.reason });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    throw error;
  }
}

export const membershipRouter = router({
  mine: protectedProcedure.query(({ ctx }) => guard(() => myMembership(ctx.user.id))),

  /* Over the rule's own ceiling, so the rule — not zod — names the problem. */
  grant: protectedProcedure
    .input(z.object({ email: z.string().trim().min(3).max(320), months: z.number().int().min(0).max(MAX_GRANT_MONTHS + 1), note: z.string().max(MAX_GRANT_NOTE).nullish() }))
    .mutation(async ({ ctx, input }) => guard(async () => grantMembership(await resolveActor(ctx.user), input))),

  end: protectedProcedure
    .input(z.object({ id: rowId }))
    .mutation(async ({ ctx, input }) => guard(async () => endMembership(await resolveActor(ctx.user), input.id))),

  list: protectedProcedure
    .input(z.object({ current: z.boolean().optional(), page: z.number().int().min(1).max(10_000).optional() }).optional())
    .query(async ({ ctx, input }) => guard(async () => listMemberships(await resolveActor(ctx.user), input ?? {}))),

  terms: protectedProcedure.query(async ({ ctx }) => guard(async () => getTerms(await resolveActor(ctx.user)))),

  setTerms: protectedProcedure
    .input(z.object({ freeDeliveryOver: z.string().trim().max(16).nullable() }))
    .mutation(async ({ ctx, input }) => guard(async () => setTerms(await resolveActor(ctx.user), { freeDeliveryOver: input.freeDeliveryOver || null }))),

  report: protectedProcedure.query(async ({ ctx }) => guard(async () => programmeReport(await resolveActor(ctx.user)))),
});
