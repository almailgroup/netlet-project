/**
 * Affiliate marketing (3.7): join in one press, share product links, earn
 * NetLet points.
 *
 * `Backend/src/services/affiliates.ts` scopes and guards; this resolves who is asking and
 * turns a refusal into a message key. `sharers` is public because the
 * shopper who arrives through a link is usually signed out, and it answers
 * only the name each member chose to be known by — under a ceiling per
 * address, since a code is an account's id in letters and the answer is
 * otherwise a list of members anybody could walk.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  AffiliateRefused,
  affiliateDashboard,
  applyAsAffiliate,
  countPendingAffiliates,
  listAffiliateProducts,
  listAffiliates,
  memberCode,
  publicSharers,
  setProductAffiliate,
  requestAffiliatePayout,
  updateAffiliate,
} from "../services/affiliates.js";
import { resolveActor } from "../services/inventory.js";
import { checkSharerLookupAllowed, recordSharerLookup } from "../services/rateLimit.js";
import { rowId } from "../core/schemas.js";
import { protectedProcedure, publicProcedure, router } from "../core/trpc.js";

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
  /** The members whose links a bag's products came through, for checkout's line saying so. */
  sharers: publicProcedure
    .input(z.object({ codes: z.array(z.string().trim().min(3).max(16)).max(20) }))
    .query(async ({ ctx, input }) => {
      if (!input.codes.length) return [];
      const address = ctx.req.ip ?? null;
      const verdict = await checkSharerLookupAllowed(address);
      if (!verdict.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "affiliate.sharersTooMany" });
      await recordSharerLookup(address);
      return publicSharers(input.codes);
    }),
  mine: protectedProcedure.query(({ ctx }) => affiliateDashboard(ctx.user.id)),
  /** The code a member's Share puts on a product's address, or null. */
  code: protectedProcedure.query(({ ctx }) => memberCode(ctx.user.id)),
  /** Join at once; the name shoppers see defaults to the account's first name. */
  join: protectedProcedure
    .input(z.object({
      displayName: z.string().trim().max(80).nullish(),
      channel: z.string().trim().max(300).nullish(),
      acceptDisclosure: z.boolean(),
    }))
    .mutation(({ ctx, input }) => guard(() => applyAsAffiliate(ctx.user.id, input))),
  payout: protectedProcedure.mutation(({ ctx }) => guard(() => requestAffiliatePayout(ctx.user.id))),
  /** The products stores have offered to affiliates, each at its own rate (3.7.1). */
  products: protectedProcedure
    .input(z.object({ page: z.number().int().min(1).max(100_000).optional() }).optional())
    .query(({ ctx, input }) => listAffiliateProducts(ctx.user.id, input ?? {})),
  /** A store offering one of its products to affiliates at a rate it funds, or withdrawing it. */
  setProduct: protectedProcedure
    .input(z.object({ productId: rowId, percent: z.string().trim().max(6).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => setProductAffiliate(actor, input.productId, input.percent));
    }),
  list: protectedProcedure
    .input(z.object({ page: z.number().int().min(1).max(100_000).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => listAffiliates(actor, input ?? {}));
    }),
  waiting: protectedProcedure.query(async ({ ctx }) => countPendingAffiliates(await resolveActor(ctx.user))),
  /* Suspend, reinstate, or let in an application left under the old review.
     An older client's `ratePercent` is dropped by zod: there is no per-member
     rate any more. */
  update: protectedProcedure
    .input(z.object({
      affiliateId: rowId,
      status: z.enum(["active", "suspended"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      await guard(() => updateAffiliate(actor, input.affiliateId, { status: input.status }));
      return { ok: true as const };
    }),
});
