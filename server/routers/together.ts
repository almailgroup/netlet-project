/**
 * Frequently bought together, over tRPC.
 *
 * Public: the rail sits on a product page and a signed-out shopper is exactly
 * who it is for. Nothing about *who* is asking enters the ranking — this is a
 * fact about the catalog, not about the caller, which is what makes it safe to
 * serve without a session. The personal rail is `recommendations.forMe`.
 */
import { z } from "zod";
import { boughtTogether } from "../together.js";
import { publicProcedure, router } from "../_core/trpc.js";

const localeSchema = z.enum(["en", "ar"]).optional();

export const togetherRouter = router({
  forProduct: publicProcedure
    .input(z.object({
      productId: z.string().min(1).max(191),
      limit: z.number().int().min(1).max(12).optional(),
      locale: localeSchema,
    }))
    .query(({ input }) => boughtTogether(input.productId, { limit: input.limit, locale: input.locale ?? "en" })),
});
