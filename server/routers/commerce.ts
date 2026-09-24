/**
 * Commerce router — the storefront's tRPC surface.
 *
 * Thin on purpose: zod validates, then `server/catalog.ts` does the work. The
 * procedure names and their output shapes are the contract the whole client
 * is written against, so they outlived the Shopify backend that first defined
 * them and would outlive this one too.
 *
 * Every procedure is public. Browsing and filling a bag do not require an
 * account — NetLet asks for one at checkout, not at the door.
 */

import { z } from "zod";
import {
  addCartLines,
  createCart,
  getCart,
  getCollectionByHandle,
  getProductByHandle,
  listCollections,
  listProducts,
  removeCartLines,
  updateCartLines,
} from "../catalog.js";
import { publicProcedure, router } from "../_core/trpc.js";
import { bundlesForVariant } from "../bundles.js";

/**
 * Which language to read merchant data in.
 *
 * Product titles and descriptions have their own Arabic columns, so unlike UI
 * copy they are chosen server-side. Absent, English.
 */
const localeSchema = z.enum(["en", "ar"]).optional();

const cartLineInputSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().min(1).max(99),
  /* The optional extras ticked on this line (3.1.2). Ids only — the price is
     read from the catalog, and an id the product does not offer is dropped. */
  addonIds: z.array(z.string().min(1)).max(20).optional(),
  /* Which bundle put this line here (3.3.11). The *price* is never sent: the
     server reads the bundle and splits its price itself. */
  bundleId: z.number().int().positive().optional(),
});

const cartLineUpdateSchema = z.object({
  lineId: z.string().min(1),
  /** 0 means "remove this line" — the route forwards to removeLines. */
  quantity: z.number().int().min(0).max(99),
});

export const commerceRouter = router({
  products: router({
    list: publicProcedure
      .input(
        z
          .object({
            first: z.number().int().min(1).max(100).optional(),
            collectionHandle: z.string().min(1).optional(),
            locale: localeSchema,
          })
          .optional()
      )
      .query(async ({ input }) => {
        return listProducts(input ?? {});
      }),
    byHandle: publicProcedure
      .input(z.object({ handle: z.string().min(1), locale: localeSchema }))
      .query(async ({ input }) => {
        return getProductByHandle(input.handle, input.locale ?? "en");
      }),
  }),
  collections: router({
    list: publicProcedure
      .input(z.object({ first: z.number().int().min(1).max(50).optional(), locale: localeSchema }).optional())
      .query(async ({ input }) => {
        return listCollections(input?.first ?? 50, input?.locale ?? "en");
      }),
    byHandle: publicProcedure
      .input(z.object({ handle: z.string().min(1), locale: localeSchema }))
      .query(async ({ input }) => {
        return getCollectionByHandle(input.handle, input.locale ?? "en");
      }),
  }),
  /**
   * Bundles a shopper could buy (3.3.11).
   *
   * Public, because it is shelf information: what is in the set, what it
   * saves, and whether every member can still be bought. The permit rule and
   * the availability rule are both applied on the read in `loadBundles`, so a
   * page cannot show a set the shop may not advertise.
   */
  bundlesForVariant: publicProcedure
    .input(z.object({ variantId: z.string().min(1) }))
    .query(({ input }) => bundlesForVariant(Number(input.variantId))),

  cart: router({
    create: publicProcedure
      .input(z.object({ lines: z.array(cartLineInputSchema).min(1).max(50) }))
      .mutation(async ({ ctx, input }) => {
        // A signed-in shopper's cart is attached to the account as it is
        // created, so it is already theirs on the next device.
        return createCart(input.lines, ctx.user?.id ?? null);
      }),
    get: publicProcedure
      .input(z.object({ cartId: z.string().min(1) }))
      .query(async ({ input }) => {
        return getCart(input.cartId);
      }),
    addLines: publicProcedure
      .input(
        z.object({
          cartId: z.string().min(1),
          lines: z.array(cartLineInputSchema).min(1).max(50),
        })
      )
      .mutation(async ({ input }) => {
        return addCartLines(input.cartId, input.lines);
      }),
    updateLines: publicProcedure
      .input(
        z.object({
          cartId: z.string().min(1),
          lines: z.array(cartLineUpdateSchema).min(1).max(50),
        })
      )
      .mutation(async ({ input }) => {
        // qty 0 means "remove this line" — split the request so the client
        // never has to call two procedures for a single user gesture.
        const toRemove = input.lines.filter(l => l.quantity === 0).map(l => l.lineId);
        const toUpdate = input.lines.filter(l => l.quantity > 0);

        let cart = null;
        if (toUpdate.length) {
          cart = await updateCartLines(input.cartId, toUpdate);
        }
        if (toRemove.length) {
          cart = await removeCartLines(input.cartId, toRemove);
        }
        if (!cart) cart = await getCart(input.cartId);
        return cart;
      }),
    removeLines: publicProcedure
      .input(
        z.object({
          cartId: z.string().min(1),
          lineIds: z.array(z.string().min(1)).min(1).max(50),
        })
      )
      .mutation(async ({ input }) => {
        return removeCartLines(input.cartId, input.lineIds);
      }),
  }),
});

export type CommerceRouter = typeof commerceRouter;
