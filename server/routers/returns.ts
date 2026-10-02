/**
 * The returns desk (3.2.8), for sellers and NetLet.
 *
 * `server/returns.ts` scopes and guards; this resolves who is asking and turns
 * a refusal into a message key the page can say in either language.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { rowId } from "../_core/schemas.js";
import { protectedProcedure, router } from "../_core/trpc.js";
import { resolveActor } from "../inventory.js";
import {
  countWaitingReturns,
  decideReturn,
  listReturns,
  markCollected,
  markRefundPaid,
  receiveReturn,
  ReturnRefused,
} from "../returns.js";

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ReturnRefused) {
      throw new TRPCError({ code: error.reason === "returns.notFound" ? "NOT_FOUND" : error.reason === "returns.moved" ? "CONFLICT" : "BAD_REQUEST", message: error.reason });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    throw error;
  }
}

const request = z.object({ requestId: rowId });

export const returnsRouter = router({
  list: protectedProcedure
    .input(z.object({ open: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => listReturns(actor, input ?? {}));
    }),
  waiting: protectedProcedure.query(async ({ ctx }) => {
    const actor = await resolveActor(ctx.user);
    return guard(() => countWaitingReturns(actor));
  }),
  decide: protectedProcedure
    .input(request.extend({ approve: z.boolean(), reason: z.string().max(400).nullish() }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      await guard(() => decideReturn(actor, input.requestId, input));
      return { success: true } as const;
    }),
  collect: protectedProcedure.input(request).mutation(async ({ ctx, input }) => {
    const actor = await resolveActor(ctx.user);
    await guard(() => markCollected(actor, input.requestId));
    return { success: true } as const;
  }),
  receive: protectedProcedure
    .input(request.extend({ restock: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => receiveReturn(actor, input.requestId, { restock: input.restock }));
    }),
  refundPaid: protectedProcedure.input(request).mutation(async ({ ctx, input }) => {
    const actor = await resolveActor(ctx.user);
    await guard(() => markRefundPaid(actor, input.requestId));
    return { success: true } as const;
  }),
});
