/**
 * Invoices and credit notes (3.6.6).
 *
 * `Backend/src/services/invoices.ts` scopes; this resolves who is asking. A document the
 * caller may not read is "not found", never "forbidden" — an invoice number is
 * short enough to guess, and the difference would say it exists.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { documentFor, listInvoices, verifyDocument } from "../services/invoices.js";
import { resolveActor } from "../services/inventory.js";
import { protectedProcedure, publicProcedure, router } from "../core/trpc.js";

/** The shape `invoiceNumber` writes, and nothing longer. */
const number = z.string().regex(/^(INV|CRN)-\d{4}-\d{6,9}$/);

export const invoicesRouter = router({
  /** Is this printed document genuine? Public; answers only what the paper shows. */
  verify: publicProcedure
    .input(z.object({ number, code: z.string().trim().min(1).max(16) }))
    .query(({ input }) => verifyDocument(input.number, input.code)),
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
