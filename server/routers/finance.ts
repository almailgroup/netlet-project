/**
 * The finance panel, as an endpoint.
 *
 * One procedure. The guard is inside `server/finance.ts`, next to the query,
 * rather than only here — a second caller added later would skip a
 * router-level check silently, which is the rule every other guard in this
 * codebase follows.
 */
import { z } from "zod";
import { financeReport } from "../finance.js";
import { resolveActor } from "../inventory.js";
import { protectedProcedure, router } from "../_core/trpc.js";

export const financeRouter = router({
  report: protectedProcedure
    .input(z.object({
      from: z.coerce.date().nullish(),
      to: z.coerce.date().nullish(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return financeReport(actor, { from: input?.from ?? null, to: input?.to ?? null });
    }),
});
