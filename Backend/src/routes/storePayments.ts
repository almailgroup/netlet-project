/**
 * The ways a store lets its shoppers pay (`Shared/commerce/storePayments.ts`):
 * read and saved by the store's owner and managers on the vendor portal's
 * page, and by NetLet on the store's own page.
 *
 * `Backend/src/services/storePayments.ts` scopes and guards; this resolves who
 * is asking — for the store named, since somebody in two stores acts for one
 * at a time — and turns a refusal into a message key.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getStorePayments, setStorePayments, StorePaymentsRefused } from "../services/storePayments.js";
import { resolveActor } from "../services/inventory.js";
import { rowId } from "../core/schemas.js";
import { protectedProcedure, router } from "../core/trpc.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StorePaymentsRefused) {
      throw new TRPCError({ code: error.reason === "storePay.notFound" ? "NOT_FOUND" : "BAD_REQUEST", message: error.reason });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    throw error;
  }
}

/** The store named, or — for somebody acting for one store — their own. */
function storeOf(actor: Actor, named: number | undefined): number {
  const vendorId = named ?? (actor.kind === "vendor" ? actor.vendorId : null);
  if (vendorId === null) throw new TRPCError({ code: "FORBIDDEN", message: "vendor.payments" });
  return vendorId;
}

/* An amount like 24.500, or blank for no ceiling — the store page's rule. */
const ceiling = z
  .union([z.string().trim().regex(/^\d{1,9}(\.\d{1,3})?$/, "storePay.badCeiling"), z.literal(""), z.null()])
  .optional()
  .transform(value => (value ? value : null));

export const storePaymentsRouter = router({
  get: protectedProcedure
    .input(z.object({ vendorId: rowId.optional() }).optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user, input?.vendorId);
      return guard(() => getStorePayments(actor, storeOf(actor, input?.vendorId)));
    }),
  set: protectedProcedure
    .input(z.object({
      vendorId: rowId.optional(),
      cod: z.boolean(),
      codCeiling: ceiling,
      online: z.array(z.string().max(16)).max(8),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user, input.vendorId);
      return guard(() => setStorePayments(actor, storeOf(actor, input.vendorId), {
        cod: input.cod,
        codCeiling: input.codCeiling,
        online: input.online,
      }));
    }),
});
