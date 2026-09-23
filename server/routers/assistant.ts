/**
 * The product assistant, as an endpoint.
 *
 * Two procedures, and the small one matters. `available` exists so the panel
 * can be absent rather than present-and-broken when no key is configured: an
 * assistant that cannot answer has nothing to show a shopper, unlike voice
 * search, which is a *designed* state worth rendering so it can be reviewed.
 * A box that says "not configured" is noise on a shop.
 *
 * The product is fetched here, by handle, rather than accepted from the
 * client. A client that could post the listing could post any listing — and
 * then "what does NetLet's assistant say about this product" would be a
 * question the asker got to write both halves of.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MAX_QUESTION, acceptableQuestion } from "../../shared/commerce/assistant.js";
import { askAboutProduct, assistantAvailable } from "../assistant.js";
import { getProductByHandle } from "../catalog.js";
import { checkAssistantAllowed, recordAssistantCall } from "../rateLimit.js";
import { publicProcedure, router } from "../_core/trpc.js";

export const assistantRouter = router({
  /** Whether the panel should be drawn at all. Cheap, and asked once per page. */
  available: publicProcedure.query(() => ({ available: assistantAvailable() })),

  ask: publicProcedure
    .input(z.object({
      handle: z.string().trim().min(1).max(200),
      question: z.string().trim().min(1).max(MAX_QUESTION),
      locale: z.enum(["en", "ar"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      /* The same predicate the button is disabled by, so the form cannot send
         what the API refuses — the arrangement the password floor uses. */
      if (!acceptableQuestion(input.question)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "assistant.badQuestion" });
      }

      const address = ctx.req.ip ?? null;
      const verdict = await checkAssistantAllowed(address);
      if (!verdict.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "assistant.tooMany",
          cause: { retryAfterSeconds: verdict.retryAfterSeconds },
        });
      }
      /* Counted before the call, not after: a request that times out has still
         spent the money, and counting only successes would make the ceiling
         something a failing endpoint lets you walk straight through. */
      await recordAssistantCall(address);

      const product = await getProductByHandle(input.handle, input.locale ?? "en");
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "assistant.noProduct" });

      return askAboutProduct(product, input.question);
    }),
});
