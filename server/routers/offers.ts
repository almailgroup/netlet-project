/**
 * Asking a seller for a special price, and the seller answering.
 *
 * Requirement 3.1.13. The rules are pure in `Shared/commerce/priceOffers.ts`,
 * the queries are in `server/offers.ts` with their guards beside them, and this
 * translates between the two and HTTP.
 *
 * **Asking requires signing in.** A grant is attached to an account because a
 * discount somebody can collect again by clearing their cookies is not a
 * discount — so every shopper procedure here is `protectedProcedure`, and the
 * one public query is the flag that says whether the button should be drawn
 * at all.
 *
 * Every refusal travels as a message *key*, never a sentence: a string
 * assembled on the server is an English string on an Arabic page.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { rowId } from "../_core/schemas.js";
import {
  answerOffer,
  countOpenOffers,
  declineOffer,
  listOffersForShopper,
  listOffersForVendor,
  offerForVariant,
  offersOpenOn,
  OfferError,
  requestOffer,
  setProductAcceptsOffers,
  setVendorAcceptsOffers,
  vendorAcceptsOffers,
  withdrawOffer,
} from "../offers.js";
import { resolveActor } from "../inventory.js";
import { checkOfferRequestAllowed, recordOfferRequest } from "../rateLimit.js";
import { MAX_NOTE } from "../../Shared/commerce/priceOffers.js";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc.js";

/** Money as the client sends it: three decimal places, and nothing clever. */
const amount = z.string().regex(/^\d+(\.\d{1,3})?$/, "offers.badAmount");

const REFUSALS: Record<string, { code: "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND"; message: string }> = {
  NOT_NEGOTIABLE: { code: "BAD_REQUEST", message: "offers.notNegotiable" },
  UNAVAILABLE: { code: "NOT_FOUND", message: "offers.unavailable" },
  ASK_OUT_OF_RANGE: { code: "BAD_REQUEST", message: "offers.askOutOfRange" },
  OFFER_OUT_OF_RANGE: { code: "BAD_REQUEST", message: "offers.offerOutOfRange" },
  ALREADY_OPEN: { code: "CONFLICT", message: "offers.alreadyOpen" },
  NOT_OPEN: { code: "NOT_FOUND", message: "offers.notOpen" },
};

/**
 * Turns the data layer's refusals into the right HTTP shape.
 *
 * The same arrangement `server/routers/inventory.ts` uses, and for the same
 * reason: `assertCan` is pure and knows nothing about tRPC, so a 403 has to be
 * made here rather than thrown from `Shared/`.
 */
async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof OfferError) {
      const { code, message } = REFUSALS[error.refusal];
      throw new TRPCError({ code, message });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) {
      throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    }
    throw error;
  }
}

export const offersRouter = router({
  /**
   * Whether these variants may be haggled over.
   *
   * Public, because it decides whether a button is drawn and the product page
   * is drawn for signed-out shoppers too. It answers about the *product*, not
   * about the caller, so there is nothing here to leak — and drawing "Make an
   * offer" on a shop that will never answer one is the dead-control rule.
   */
  openOn: publicProcedure
    .input(z.object({ variantIds: z.array(rowId).max(50) }))
    .query(async ({ input }) => [...(await offersOpenOn(input.variantIds))]),

  /** What this shopper has going on one variant, and nothing about anybody else. */
  mine: protectedProcedure
    .input(z.object({ variantId: rowId }))
    .query(({ ctx, input }) => offerForVariant(ctx.user.id, input.variantId)),

  /** Every request this shopper has sent, for the account page. */
  list: protectedProcedure.query(({ ctx }) => listOffersForShopper(ctx.user.id)),

  /**
   * Ask for a price.
   *
   * Throttled in Postgres by account, counted *before* the row is written:
   * what is being protected is a seller's attention, and a request they have
   * to read and decline costs them as much as one they accept.
   */
  request: protectedProcedure
    .input(z.object({
      variantId: rowId,
      askedPrice: amount,
      quantity: z.number().int().min(1).max(999).default(1),
      note: z.string().trim().max(MAX_NOTE).nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      const verdict = await checkOfferRequestAllowed(ctx.user.email);
      if (!verdict.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "offers.tooMany",
          cause: { retryAfterSeconds: verdict.retryAfterSeconds },
        });
      }
      await recordOfferRequest(ctx.user.email);
      return guard(() => requestOffer({ userId: ctx.user.id, ...input }));
    }),

  /** Take a request back. Scoped by `ctx.user.id` inside the write. */
  withdraw: protectedProcedure
    .input(z.object({ offerId: rowId }))
    .mutation(({ ctx, input }) => guard(async () => {
      await withdrawOffer(ctx.user.id, input.offerId);
      return { ok: true } as const;
    })),

  /* ------------------------------------------------------------- seller --- */

  /** The seller's inbox, scoped in the query to the vendor the actor belongs to. */
  inbox: protectedProcedure
    .input(z.object({
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
      open: z.boolean().optional(),
      vendorId: rowId.optional(),
    }).optional())
    .query(({ ctx, input }) => guard(async () =>
      listOffersForVendor(await resolveActor(ctx.user, input?.vendorId), input ?? {})),
    ),

  /** How many are waiting, for the portal's overview tile. */
  waiting: protectedProcedure
    .input(z.object({ vendorId: rowId.optional() }).optional())
    .query(({ ctx, input }) => guard(async () =>
      countOpenOffers(await resolveActor(ctx.user, input?.vendorId))),
    ),

  /** Quote a price. Checked against the price frozen on the request. */
  answer: protectedProcedure
    .input(z.object({
      offerId: rowId,
      offeredPrice: amount,
      note: z.string().trim().max(MAX_NOTE).nullish(),
      vendorId: rowId.optional(),
    }))
    .mutation(({ ctx, input }) => guard(async () => {
      await answerOffer(await resolveActor(ctx.user, input.vendorId), { ...input, actorUserId: ctx.user.id });
      return { ok: true } as const;
    })),

  /* --------------------------------------------------------- opting in --- */

  /** Whether this store answers price requests, for the switch on the inbox. */
  storeOpen: protectedProcedure
    .input(z.object({ vendorId: rowId.optional() }).optional())
    .query(({ ctx, input }) => guard(async () =>
      vendorAcceptsOffers(await resolveActor(ctx.user, input?.vendorId), input?.vendorId)),
    ),

  /** A vendor owner turning their own inbox on or off. */
  setStoreOpen: protectedProcedure
    .input(z.object({ vendorId: rowId, accepts: z.boolean() }))
    .mutation(({ ctx, input }) => guard(async () => {
      await setVendorAcceptsOffers(await resolveActor(ctx.user, input.vendorId), input.vendorId, input.accepts);
      return { ok: true } as const;
    })),

  /**
   * One product's own answer. `null` is not "no" — it clears the override and
   * goes back to inheriting the store's.
   */
  setProductOpen: protectedProcedure
    .input(z.object({ productId: rowId, accepts: z.boolean().nullable() }))
    .mutation(({ ctx, input }) => guard(async () => {
      await setProductAcceptsOffers(await resolveActor(ctx.user), input.productId, input.accepts);
      return { ok: true } as const;
    })),

  /** Say no, with a reason if there is one worth giving. */
  decline: protectedProcedure
    .input(z.object({
      offerId: rowId,
      note: z.string().trim().max(MAX_NOTE).nullish(),
      vendorId: rowId.optional(),
    }))
    .mutation(({ ctx, input }) => guard(async () => {
      await declineOffer(await resolveActor(ctx.user, input.vendorId), { ...input, actorUserId: ctx.user.id });
      return { ok: true } as const;
    })),
});
