/**
 * Reviews over tRPC.
 *
 * Reading a product's reviews is public — they are the point of the page.
 * Everything that writes is protected, and every write is scoped by
 * `ctx.user.id` inside `Backend/src/services/reviews.ts` rather than filtered here: an
 * order-item id is a serial, so "review line 4" has to be refused by the query
 * and not by a check a later caller can skip.
 *
 * The eligibility rule is `Shared/commerce/reviews.ts`, which the client
 * imports too — so the form cannot offer a review the API would refuse. That
 * is the same arrangement as the password floor and the return window, and it
 * matters more here than in either: the page draws "Write a review" from the
 * same function the server refuses with.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { rowId, rowIdText } from "../core/schemas.js";
import {
  deleteReview,
  editReview,
  replyToReview,
  reviewableLinesFor,
  reviewsForProduct,
  ReviewRefused,
  setReviewHidden,
  writeReview,
} from "../services/reviews.js";
import { resolveActor } from "../services/inventory.js";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "../core/trpc.js";
import { MAX_REVIEW_BODY, MAX_REVIEW_TITLE, RATING_MAX, RATING_MIN } from "../../../Shared/commerce/reviews.js";

/** A refusal becomes a 4xx carrying a message key the page translates. */
const guard = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ReviewRefused) {
      throw new TRPCError({
        code: error.reason === "notFound" || error.reason === "notYours" ? "NOT_FOUND" : "BAD_REQUEST",
        message: `review.${error.reason}`,
      });
    }
    throw error;
  }
};

const rating = z.number().int().min(RATING_MIN).max(RATING_MAX);
const title = z.string().trim().max(MAX_REVIEW_TITLE).nullable().optional();
const body = z.string().trim().max(MAX_REVIEW_BODY).nullable().optional();

export const reviewsRouter = router({
  /** Every published review of one product, plus the summary over all of them. */
  forProduct: publicProcedure
    .input(z.object({
      productId: z.string().max(191),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }))
    .query(({ input }) => {
      // A handle rather than an id is not an error, it is simply no reviews —
      // the storefront's product id is a string and nothing guarantees it is
      // numeric on a demo build. Neither is an id no integer column can hold:
      // `parseInt` reads "99999999999" happily and Postgres then refuses it
      // with a 500, so the row-id shape decides rather than `parseInt` alone.
      const parsed = rowIdText.safeParse(input.productId);
      if (!parsed.success) return { items: [], summary: null, total: 0 };
      const id = Number(parsed.data);
      return reviewsForProduct(id, { limit: input.limit, offset: input.offset });
    }),

  /**
   * What this shopper can review, and why not where they cannot.
   *
   * Carries the refusal rather than omitting the line: somebody looking for
   * the kettle they just got needs to be told "not delivered yet", and an
   * empty list teaches them the feature is broken.
   */
  mine: protectedProcedure.query(({ ctx }) => reviewableLinesFor(ctx.user.id)),

  write: protectedProcedure
    .input(z.object({ orderItemId: rowId, rating, title, body }))
    .mutation(({ ctx, input }) => guard(() => writeReview(ctx.user.id, input))),

  edit: protectedProcedure
    .input(z.object({
      reviewId: rowId,
      rating: rating.optional(),
      title,
      body,
    }))
    .mutation(({ ctx, input }) => guard(() => {
      const { reviewId, ...patch } = input;
      return editReview(ctx.user.id, reviewId, patch);
    })),

  remove: protectedProcedure
    .input(z.object({ reviewId: rowId }))
    .mutation(({ ctx, input }) => guard(() => deleteReview(ctx.user.id, input.reviewId))),

  /**
   * A vendor answering a review of their own product.
   *
   * The vendor is resolved from the session by `resolveActor`, never taken
   * from the input — a vendor id a caller can name is a vendor id a caller can
   * change, and answering in somebody else's voice is exactly the abuse.
   */
  reply: protectedProcedure
    .input(z.object({ reviewId: rowId, reply: z.string().trim().max(MAX_REVIEW_BODY) }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      // Only somebody acting *for a vendor* may answer. An admin is not a
      // vendor and must not post in one's voice; they moderate instead.
      if (actor.kind !== "vendor") throw new TRPCError({ code: "FORBIDDEN", message: "review.notYours" });
      return guard(() => replyToReview(actor.vendorId, input.reviewId, input.reply));
    }),

  /** Moderation. Hides rather than deletes; see `setReviewHidden`. */
  setHidden: adminProcedure
    .input(z.object({
      reviewId: rowId,
      hidden: z.boolean(),
      reason: z.string().trim().max(200).optional(),
    }))
    .mutation(({ input }) => guard(() => setReviewHidden(input.reviewId, input.hidden, input.reason))),
});
