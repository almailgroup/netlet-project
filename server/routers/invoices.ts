/**
 * Invoices and credit notes (3.6.6).
 *
 * `server/invoices.ts` scopes; this resolves who is asking. A document the
 * caller may not read is "not found", never "forbidden" — an invoice number is
 * short enough to guess, and the difference would say it exists.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { documentFor, listInvoices } from "../invoices.js";
import { resolveActor } from "../inventory.js";
import { protectedProcedure, router } from "../_core/trpc.js";

/** The shape `invoiceNumber` writes, and nothing longer. */
const number = z.string().regex(/^(INV|CRN)-\d{4}-\d{6,9}$/);

export const invoicesRouter = router({
  get: protectedProcedure.input(z.object({ number })).query(async ({ ctx, input }) => {
    const found = await documentFor({ userId: ctx.user.id, isAdmin: ctx.user.role === "admin" }, input.number);
    if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "invoice.notFound" });
    return found;
  }),
  list: protectedProcedure
    .input(z.object({
      page: z.number().int().min(1).max(100_000).optional(),
      pageSize: z.number().int().min(1).max(200).optional(),
      query: z.string().trim().max(40).nullish(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      try {
        return await listInvoices(actor, input ?? {});
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.startsWith("FORBIDDEN:")) throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
        throw error;
      }
    }),
});
