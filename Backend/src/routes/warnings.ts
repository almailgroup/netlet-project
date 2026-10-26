/**
 * Warnings NetLet gives a store (3.3.18).
 *
 * `Backend/src/services/warnings.ts` scopes and guards; this resolves who is
 * asking and turns a refusal into a message key.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MAX_WARNING_REASON } from "../../../Shared/inventory/warnings.js";
import { issueWarning, listWarnings, WarningRefused, withdrawWarning } from "../services/warnings.js";
import { resolveActor } from "../services/inventory.js";
import { rowId } from "../core/schemas.js";
import { protectedProcedure, router } from "../core/trpc.js";

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof WarningRefused) {
      throw new TRPCError({ code: error.reason === "warnings.notFound" ? "NOT_FOUND" : error.reason === "warnings.alreadyWithdrawn" ? "CONFLICT" : "BAD_REQUEST", message: error.reason });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    throw error;
  }
}

export const warningsRouter = router({
  list: protectedProcedure
    .input(z.object({ vendorId: rowId.optional() }).optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user, input?.vendorId);
      return guard(() => listWarnings(actor, input?.vendorId));
    }),
  issue: protectedProcedure
    .input(z.object({ vendorId: rowId, productId: rowId.nullish(), reason: z.string().max(MAX_WARNING_REASON + 100) }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => issueWarning(actor, input));
    }),
  withdraw: protectedProcedure
    .input(z.object({ warningId: rowId }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => withdrawWarning(actor, input.warningId));
    }),
});
