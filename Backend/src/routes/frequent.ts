/**
 * Frequently bought (migration 0073): the shopper's own list of what they buy
 * again and again. Every procedure is the signed-in shopper's and every query
 * is scoped by `ctx.user.id` inside `Backend/src/services/frequentItems.ts`;
 * this turns a refusal into a message key the page says in words.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { rowId } from "../core/schemas.js";
import { protectedProcedure, router } from "../core/trpc.js";
import {
  addFrequent,
  FrequentRefused,
  frequentForProduct,
  frequentSuggestions,
  listFrequent,
  removeFrequent,
  setFrequentQuantity,
} from "../services/frequentItems.js";
import { MAX_LINE_QUANTITY } from "../../../Shared/commerce/types.js";

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FrequentRefused) {
      throw new TRPCError({
        code: error.reason === "frequent.notFound" ? "NOT_FOUND" : error.reason === "frequent.unavailable" ? "PRECONDITION_FAILED" : "BAD_REQUEST",
        message: error.reason,
      });
    }
    throw error;
  }
}

const localeSchema = z.enum(["en", "ar"]).optional();
const quantity = z.number().int().min(1).max(MAX_LINE_QUANTITY);

export const frequentRouter = router({
  /** The list, newest first, with today's product for each — `ready` is false before 0073 is pasted. */
  list: protectedProcedure
    .input(z.object({ locale: localeSchema }).optional())
    .query(({ ctx, input }) => listFrequent(ctx.user.id, input?.locale ?? "en")),

  /** What of one product is on the list, for the product page's button. */
  forProduct: protectedProcedure
    .input(z.object({ productId: rowId }))
    .query(({ ctx, input }) => frequentForProduct(ctx.user.id, input.productId)),

  /** What the shopper has bought before and not put on the list yet. */
  suggestions: protectedProcedure
    .input(z.object({ locale: localeSchema }).optional())
    .query(({ ctx, input }) => frequentSuggestions(ctx.user.id, input?.locale ?? "en")),

  /** On the list at a variant and the usual amount — or the amount changed, if it is there. */
  add: protectedProcedure
    .input(z.object({ productId: rowId, variantId: rowId, quantity: quantity.default(1) }))
    .mutation(({ ctx, input }) => guard(() => addFrequent(ctx.user.id, input))),

  setQuantity: protectedProcedure
    .input(z.object({ id: rowId, quantity }))
    .mutation(({ ctx, input }) => guard(() => setFrequentQuantity(ctx.user.id, input.id, input.quantity))),

  remove: protectedProcedure
    .input(z.object({ id: rowId }))
    .mutation(({ ctx, input }) => guard(() => removeFrequent(ctx.user.id, input.id))),
});
