/**
 * The help page (`server/help.ts`): finding an order, open to a signed-out
 * browser — which is who most needs help — and throttled by address on misses.
 * Its question box is the shop assistant, through the AI gateway.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc.js";
import { lookupOrder } from "../help.js";
import { checkOrderLookupAllowed, recordOrderLookupMiss } from "../rateLimit.js";

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
});
