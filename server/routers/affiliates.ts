/**
 * Affiliate marketing (3.7).
 *
 * `server/affiliates.ts` scopes and guards; this resolves who is asking and
 * turns a refusal into a message key. `lookup` is public because the shopper
 * who arrives through a link is usually signed out, and it answers only the
 * name the affiliate chose to be known by.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MAX_AFFILIATE_PERCENT } from "../../Shared/commerce/affiliate.js";
import {
  AffiliateRefused,
  affiliateDashboard,
  applyAsAffiliate,
  countPendingAffiliates,
  listAffiliates,
  publicAffiliate,
  requestAffiliatePayout,
  updateAffiliate,
} from "../affiliates.js";
import { resolveActor } from "../inventory.js";
import { rowId } from "../_core/schemas.js";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc.js";

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AffiliateRefused) {
      throw new TRPCError({ code: error.reason === "affiliate.notFound" ? "NOT_FOUND" : "BAD_REQUEST", message: error.reason });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    throw error;
  }
}

export const affiliatesRouter = router({
  lookup: publicProcedure
    .input(z.object({ code: z.string().trim().min(3).max(16) }))
    .query(({ input }) => publicAffiliate(input.code)),
  mine: protectedProcedure.query(({ ctx }) => affiliateDashboard(ctx.user.id)),
  join: protectedProcedure
    .input(z.object({
      displayName: z.string().trim().min(1).max(80),
      channel: z.string().trim().max(300).nullish(),
      acceptDisclosure: z.boolean(),
    }))
    .mutation(({ ctx, input }) => guard(() => applyAsAffiliate(ctx.user.id, input))),
  payout: protectedProcedure.mutation(({ ctx }) => guard(() => requestAffiliatePayout(ctx.user.id))),
  list: protectedProcedure
    .input(z.object({ page: z.number().int().min(1).max(100_000).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => listAffiliates(actor, input ?? {}));
    }),
  waiting: protectedProcedure.query(async ({ ctx }) => countPendingAffiliates(await resolveActor(ctx.user))),
  update: protectedProcedure
    .input(z.object({
      affiliateId: rowId,
      status: z.enum(["active", "suspended"]).optional(),
      ratePercent: z.string().trim().max(6).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      await guard(() => updateAffiliate(actor, input.affiliateId, { status: input.status, ratePercent: input.ratePercent }));
      return { ok: true as const, ceiling: MAX_AFFILIATE_PERCENT };
    }),
});
