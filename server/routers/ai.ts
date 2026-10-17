/**
 * The AI gateway's doors (`server/aiGateway.ts`): whether it is there, and a
 * token for it.
 *
 * Tokens are mutations rather than queries. Issuing a credential is not a
 * read anybody should cache — a query travels as a GET that a cache between
 * here and the browser could keep — and nothing should fetch one ahead of a
 * press.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc.js";
import { rowId } from "../_core/schemas.js";
import { resolveActor } from "../inventory.js";
import { catalogSession, chatSession, gatewayAvailable } from "../aiGateway.js";

export const aiRouter = router({
  /** Whether to draw anything that uses the gateway. */
  available: publicProcedure.query(() => gatewayAvailable()),

  chatSession: publicProcedure.mutation(({ ctx }) => chatSession(ctx.user?.id ?? null, ctx.req.ip ?? null)),

  catalogSession: protectedProcedure
    .input(z.object({ vendorId: rowId.nullable() }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user, input.vendorId ?? undefined);
      try {
        return await catalogSession(actor, input.vendorId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.startsWith("FORBIDDEN:")) throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
        throw error;
      }
    }),
});
