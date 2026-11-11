/**
 * A store's documents (`Shared/inventory/storeDocuments.ts`): the list and
 * the removal. The file itself goes up and comes down through plain routes in
 * `Backend/src/core/app.ts`, a file not being JSON.
 *
 * `Backend/src/services/storeDocuments.ts` scopes and guards; this resolves
 * who is asking — for the store named, since somebody in two stores acts for
 * one at a time — and turns a refusal into a message key.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { listStoreDocuments, removeStoreDocument, storeOfDocument, StoreDocumentRefused } from "../services/storeDocuments.js";
import { resolveActor } from "../services/inventory.js";
import { rowId } from "../core/schemas.js";
import { protectedProcedure, router } from "../core/trpc.js";

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StoreDocumentRefused) {
      throw new TRPCError({ code: error.reason === "documents.notFound" ? "NOT_FOUND" : error.reason === "storeDocs.notYours" ? "FORBIDDEN" : "BAD_REQUEST", message: error.reason });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    throw error;
  }
}

export const storeDocumentsRouter = router({
  /** One store's documents: the store named, or — for a store's owner — their own. */
  list: protectedProcedure
    .input(z.object({ vendorId: rowId.optional() }).optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user, input?.vendorId);
      const vendorId = input?.vendorId ?? (actor.kind === "vendor" ? actor.vendorId : null);
      /* An administrator names the store; anybody with no store has none to list. */
      if (vendorId === null) throw new TRPCError({ code: "FORBIDDEN", message: "vendor.editProfile" });
      return guard(() => listStoreDocuments(actor, vendorId));
    }),
  remove: protectedProcedure
    .input(z.object({ id: rowId }))
    .mutation(async ({ ctx, input }) => {
      const vendorId = await storeOfDocument(input.id);
      const actor = await resolveActor(ctx.user, vendorId ?? undefined);
      return guard(() => removeStoreDocument(actor, input.id));
    }),
});
