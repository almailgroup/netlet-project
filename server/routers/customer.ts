import { z } from "zod";
import {
  countFollowers,
  getCustomerProfile,
  listFollowedProducts,
  setFollowedProduct,
  listNotificationPreferences,
  listOrderTrackingEvents,
  listSavedProductIds,
  setNotificationPreference,
  setSavedProduct,
  upsertCustomerProfile,
} from "../db.js";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc.js";
import { kuwaitDeliveryZones, notificationKinds } from "../../shared/customer.js";
import { TRPCError } from "@trpc/server";
import {
  AddressError,
  addAddress,
  listAddresses,
  removeAddress,
  updateAddress,
} from "../addresses.js";
import { MAX_LABEL, MAX_LINE, MAX_NOTES } from "../../shared/commerce/addresses.js";

const zoneIdSchema = z.string().refine(value => kuwaitDeliveryZones.some(zone => zone.id === value), "Unknown delivery zone");
const notificationKindSchema = z.enum(notificationKinds);

/**
 * What a shopper may type into an address.
 *
 * The lengths are the schema's, so the form, the API and the column all refuse
 * at the same point; *which* of them is wrong is `addressProblems`, the same
 * pure function the page runs, so the API cannot accept what the form refuses
 * or refuse what it accepts.
 */
const addressInput = z.object({
  label: z.string().min(1).max(MAX_LABEL),
  contactName: z.string().max(160).nullable().optional(),
  contactPhone: z.string().max(40).nullable().optional(),
  governorate: zoneIdSchema.nullable().optional(),
  addressLine: z.string().min(1).max(MAX_LINE),
  addressNotes: z.string().max(MAX_NOTES).nullable().optional(),
});

export const customerRouter = router({
  profile: router({
    /**
     * The shopper's stored preferences, or nulls where they have none.
     *
     * `locale` is null when there is no row, and that is the point: this used
     * to answer "en" for somebody who had never chosen, which the client then
     * adopted — so signing in while reading Arabic silently flipped the whole
     * site to English. "Never chose" and "chose English" have to be different
     * answers, or the default overrules the person using it.
     */
    get: protectedProcedure.query(async ({ ctx }) => {
      const profile = await getCustomerProfile(ctx.user.id);
      return profile
        ? { locale: profile.locale, deliveryZoneId: profile.deliveryZoneId, cartId: profile.cartId }
        : { locale: null, deliveryZoneId: null, cartId: null };
    }),
    update: protectedProcedure.input(z.object({
      locale: z.enum(["en", "ar"]).optional(),
      deliveryZoneId: zoneIdSchema.nullable().optional(),
      cartId: z.string().min(1).nullable().optional(),
    })).mutation(({ ctx, input }) => upsertCustomerProfile(ctx.user.id, input)),
  }),
  /**
   * Products the shopper asked to be told about.
   *
   * `demand` is public on purpose: it is the "N people are waiting for this"
   * line a shopper sees on an out-of-stock product, and the signal the
   * requirements want to reach the vendor. It is a count, never a list.
   */
  follows: router({
    list: protectedProcedure.query(({ ctx }) => listFollowedProducts(ctx.user.id)),
    set: protectedProcedure
      .input(z.object({
        productId: z.string().min(1).max(191),
        priceDrop: z.boolean().optional(),
        backInStock: z.boolean().optional(),
      }))
      .mutation(({ ctx, input }) => setFollowedProduct(ctx.user.id, input.productId, input)),
    demand: publicProcedure
      .input(z.object({ productId: z.string().min(1).max(191) }))
      .query(({ input }) => countFollowers(input.productId)),
  }),
  saved: router({
    list: protectedProcedure.query(({ ctx }) => listSavedProductIds(ctx.user.id)),
    set: protectedProcedure.input(z.object({ productId: z.string().min(1), saved: z.boolean() }))
      .mutation(({ ctx, input }) => setSavedProduct(ctx.user.id, input.productId, input.saved)),
  }),
  notifications: router({
    list: protectedProcedure.query(({ ctx }) => listNotificationPreferences(ctx.user.id)),
    set: protectedProcedure.input(z.object({ kind: notificationKindSchema, enabled: z.boolean() }))
      .mutation(({ ctx, input }) => setNotificationPreference(ctx.user.id, input.kind, input.enabled)),
  }),
  tracking: router({
    list: protectedProcedure.query(({ ctx }) => listOrderTrackingEvents(ctx.user.id)),
  }),

  /**
   * The shopper's address book (3.2.6).
   *
   * Protected throughout, because the book belongs to an account: an anonymous
   * bag has no owner to keep one for. Every procedure passes `ctx.user.id`
   * into the data layer rather than filtering after the fact — an address id
   * is a serial and short enough to paste, so "update address 4" has to be
   * refused by the query itself.
   */
  addresses: router({
    list: protectedProcedure.query(({ ctx }) => listAddresses(ctx.user.id)),
    add: protectedProcedure
      .input(addressInput)
      .mutation(({ ctx, input }) => refusable(() => addAddress(ctx.user.id, input))),
    update: protectedProcedure
      .input(addressInput.extend({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) => refusable(() => updateAddress(ctx.user.id, input.id, input))),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) => refusable(() => removeAddress(ctx.user.id, input.id))),
  }),
});


/**
 * Turn a refusal the shopper can act on into a 400 carrying its message key.
 *
 * The same shape the offer and bundle routers use: the data layer throws a key
 * rather than a sentence, because the storefront is read in two languages and
 * a server that composes English prose has already picked one.
 */
async function refusable<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AddressError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}
