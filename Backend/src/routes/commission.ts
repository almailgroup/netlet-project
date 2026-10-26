/**
 * Commission proposals and the commission desk (3.3.2, 3.3.9).
 *
 * `Backend/src/services/commissionProposals.ts` scopes and guards; this
 * resolves who is asking and turns a refusal into a message key.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MAX_DECISION_NOTE, MAX_PROPOSAL_REASON, PROPOSAL_STATUSES } from "../../../Shared/inventory/commissionProposals.js";
import {
  CommissionRefused,
  commissionStores,
  countOpenProposals,
  decideProposal,
  listProposals,
  proposeCommission,
  withdrawProposal,
} from "../services/commissionProposals.js";
import { resolveActor } from "../services/inventory.js";
import { rowId } from "../core/schemas.js";
import { protectedProcedure, router } from "../core/trpc.js";

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CommissionRefused) {
      throw new TRPCError({ code: error.reason === "commission.notFound" ? "NOT_FOUND" : error.reason === "commission.moved" || error.reason === "commission.alreadyOpen" ? "CONFLICT" : "BAD_REQUEST", message: error.reason });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    throw error;
  }
}

const figure = z.string().trim().max(14).nullable();

export const commissionRouter = router({
  propose: protectedProcedure
    .input(z.object({
      vendorId: rowId,
      productId: rowId.nullable(),
      percent: figure,
      fixed: figure,
      reason: z.string().max(MAX_PROPOSAL_REASON + 100).nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user, input.vendorId);
      return guard(() => proposeCommission(actor, input));
    }),
  withdraw: protectedProcedure
    .input(z.object({ proposalId: rowId }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      await guard(() => withdrawProposal(actor, input.proposalId));
      return { ok: true as const };
    }),
  list: protectedProcedure
    .input(z.object({
      status: z.enum(PROPOSAL_STATUSES).optional(),
      vendorId: rowId.optional(),
      productId: rowId.optional(),
      page: z.number().int().min(1).max(100_000).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user, input?.vendorId);
      return guard(() => listProposals(actor, input ?? {}));
    }),
  decide: protectedProcedure
    .input(z.object({ proposalId: rowId, accept: z.boolean(), note: z.string().max(MAX_DECISION_NOTE + 100).nullish() }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => decideProposal(actor, input.proposalId, { accept: input.accept, note: input.note }));
    }),
  waiting: protectedProcedure.query(async ({ ctx }) => countOpenProposals(await resolveActor(ctx.user))),
  stores: protectedProcedure
    .input(z.object({ query: z.string().trim().max(160).optional(), page: z.number().int().min(1).max(100_000).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => commissionStores(actor, input ?? {}));
    }),
});
