/**
 * The help page (`server/help.ts`). All three are open to a signed-out
 * browser, which is who most needs help, and each is throttled by address.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc.js";
import { askHelp, helpAssistantAvailable, lookupOrder } from "../help.js";
import { checkHelpQuestionAllowed, checkOrderLookupAllowed, recordHelpQuestion, recordOrderLookupMiss } from "../rateLimit.js";
import { MAX_HELP_QUESTION } from "../../shared/commerce/helpArticles.js";

export const helpRouter = router({
  lookupOrder: publicProcedure
    .input(z.object({ reference: z.string().trim().min(1).max(40), email: z.string().trim().min(3).max(320) }))
    .mutation(async ({ ctx, input }) => {
      const address = ctx.req.ip ?? null;
      const verdict = await checkOrderLookupAllowed(address);
      /* Past the ceiling every pair is refused alike, the right one included. */
      if (!verdict.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "help.lookupTooMany" });
      const found = await lookupOrder(input.reference, input.email);
      if (!found) await recordOrderLookupMiss(address);
      return found;
    }),

  assistantAvailable: publicProcedure.query(() => helpAssistantAvailable()),

  ask: publicProcedure
    .input(z.object({ question: z.string().trim().min(2).max(MAX_HELP_QUESTION), locale: z.enum(["en", "ar"]).optional() }))
    .mutation(async ({ ctx, input }) => {
      const address = ctx.req.ip ?? null;
      const verdict = await checkHelpQuestionAllowed(address);
      if (!verdict.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "help.askTooMany" });
      /* Counted before the call: a request that times out has still spent the money. */
      await recordHelpQuestion(address);
      return askHelp(input.question, input.locale ?? "en");
    }),
});
