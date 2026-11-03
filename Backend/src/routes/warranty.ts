/**
 * Warranty claims (migration 0072): the shopper files and withdraws from the
 * opened order; the store's desk and NetLet answer.
 *
 * `Backend/src/services/warranty.ts` scopes and guards; this resolves who is
 * asking and turns a refusal into a message key the page says in words.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { rowId } from "../core/schemas.js";
import { protectedProcedure, router } from "../core/trpc.js";
import { resolveActor } from "../services/inventory.js";
import { completeClaim, countOpenClaims, decideClaim, fileClaim, listClaims, withdrawClaim, WarrantyRefused } from "../services/warranty.js";
import { MAX_WARRANTY_PHOTOS, MAX_WARRANTY_PROBLEM, MAX_WARRANTY_RESPONSE, WARRANTY_REMEDIES } from "../../../Shared/commerce/warranty.js";

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof WarrantyRefused) {
      throw new TRPCError({ code: error.reason === "warranty.notFound" ? "NOT_FOUND" : error.reason === "warranty.openClaim" || error.reason === "warranty.alreadyAnswered" ? "CONFLICT" : "BAD_REQUEST", message: error.reason });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    throw error;
  }
}

export const warrantyRouter = router({
  /** A claim on one delivered item of the shopper's own order. */
  file: protectedProcedure
    .input(z.object({
      reference: z.string().min(1).max(64),
      orderItemId: rowId,
      problem: z.string().max(MAX_WARRANTY_PROBLEM + 200),
      /* `/media/…` paths the shopper uploaded; the data layer checks they are theirs. */
      photos: z.array(z.string().max(120)).max(MAX_WARRANTY_PHOTOS).default([]),
    }))
    .mutation(({ ctx, input }) => guard(() => fileClaim(ctx.user.id, input))),

  /** Take back a claim nobody has answered. */
  withdraw: protectedProcedure
    .input(z.object({ id: rowId }))
    .mutation(({ ctx, input }) => guard(() => withdrawClaim(ctx.user.id, input.id))),

  /** The desk: this store's claims, or every store's for NetLet. */
  list: protectedProcedure
    .input(z.object({ waiting: z.boolean().default(true) }).optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => listClaims(actor, { waiting: input?.waiting ?? true }));
    }),

  /** Claims nobody has answered yet, for the overview's tile. */
  waitingCount: protectedProcedure.query(async ({ ctx }) => countOpenClaims(await resolveActor(ctx.user))),

  /** A remedy, or a refusal with its reason. */
  decide: protectedProcedure
    .input(z.object({
      id: rowId,
      accept: z.boolean(),
      remedy: z.enum(WARRANTY_REMEDIES).nullable().optional(),
      response: z.string().max(MAX_WARRANTY_RESPONSE + 200).default(""),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => decideClaim(actor, input.id, { accept: input.accept, remedy: input.remedy ?? null, response: input.response }));
    }),

  /** A repair done. */
  complete: protectedProcedure
    .input(z.object({ id: rowId, note: z.string().max(MAX_WARRANTY_RESPONSE + 200).default("") }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => completeClaim(actor, input.id, input.note));
    }),
});
