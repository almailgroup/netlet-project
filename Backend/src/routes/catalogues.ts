/**
 * A product's catalogues (`Shared/inventory/productCatalogues.ts`): what a
 * product's page lists, what its editor lists, taking one off, and NetLet's
 * review of those waiting. The file itself goes up in parts and comes down
 * through plain routes in `Backend/src/core/app.ts`, a file not being JSON.
 *
 * `Backend/src/services/productCatalogues.ts` scopes and guards; this
 * resolves who is asking — for the product's own store, since somebody in two
 * stores acts for one at a time — and turns a refusal into a message key.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { CATALOGUE_NOTE_MAX } from "../../../Shared/inventory/productCatalogues.js";
import {
  CatalogueRefused,
  cataloguesForEditor,
  cataloguesForProduct,
  decideCatalogue,
  removeCatalogue,
  storeOfCatalogue,
  storeOfProduct,
  waitingCatalogueCount,
  waitingCatalogues,
} from "../services/productCatalogues.js";
import { resolveActor } from "../services/inventory.js";
import { rowId, rowIdText } from "../core/schemas.js";
import { protectedProcedure, publicProcedure, router } from "../core/trpc.js";

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CatalogueRefused) {
      const code = error.reason === "catalogue.notFound" ? "NOT_FOUND" : error.reason === "catalogue.notWaiting" ? "CONFLICT" : "BAD_REQUEST";
      throw new TRPCError({ code, message: error.reason });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    throw error;
  }
}

export const cataloguesRouter = router({
  /**
   * The catalogues on a product's page. The storefront's product id is a
   * string, and one that is not a row's (a demo handle, a number no column
   * holds) simply has none.
   */
  forProduct: publicProcedure
    .input(z.object({ productId: z.string().max(191) }))
    .query(async ({ input }) => {
      const parsed = rowIdText.safeParse(input.productId);
      if (!parsed.success) return [];
      return cataloguesForProduct(Number(parsed.data));
    }),
  /** Every catalogue on a product, with where each stands, for its editor. */
  editor: protectedProcedure
    .input(z.object({ productId: rowId }))
    .query(async ({ ctx, input }) => {
      const vendorId = await storeOfProduct(input.productId);
      const actor = await resolveActor(ctx.user, vendorId ?? undefined);
      return guard(() => cataloguesForEditor(actor, input.productId));
    }),
  remove: protectedProcedure
    .input(z.object({ id: rowId }))
    .mutation(async ({ ctx, input }) => {
      const vendorId = await storeOfCatalogue(input.id);
      const actor = await resolveActor(ctx.user, vendorId ?? undefined);
      return guard(() => removeCatalogue(actor, input.id));
    }),
  /** Waiting for NetLet to look at them, oldest first. */
  waiting: protectedProcedure.query(async ({ ctx }) => guard(async () => waitingCatalogues(await resolveActor(ctx.user)))),
  waitingCount: protectedProcedure.query(async ({ ctx }) => guard(async () => waitingCatalogueCount(await resolveActor(ctx.user)))),
  /** On the page, or turned down with a reason the store reads. */
  decide: protectedProcedure
    .input(z.object({ id: rowId, approve: z.boolean(), note: z.string().max(CATALOGUE_NOTE_MAX * 2).optional() }))
    .mutation(async ({ ctx, input }) => guard(async () => decideCatalogue(await resolveActor(ctx.user), input.id, { approve: input.approve, note: input.note }))),
});
