/**
 * The returns desk (3.2.8), for sellers and NetLet.
 *
 * `Backend/src/services/returns.ts` scopes and guards; this resolves who is asking and turns
 * a refusal into a message key the page can say in either language.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { rowId, rowIdText } from "../core/schemas.js";
import { protectedProcedure, publicProcedure, router } from "../core/trpc.js";
import { resolveActor } from "../services/inventory.js";
import {
  countWaitingReturns,
  decideReturn,
  fitFeedbackFor,
  listReturns,
  markCollected,
  markRefundPaid,
  receiveReturn,
  ReturnRefused,
} from "../services/returns.js";

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
  /**
   * How a product's size returns have gone (3.1.20), for the size guide. Public
   * and counts only. Takes the storefront's string id; one that is not a row id
   * (a demo handle) has no returns rather than being refused — the rule
   * `reviews.forProduct` follows.
   */
  fit: publicProcedure
    .input(z.object({ productId: z.string().min(1).max(191) }))
    .query(({ input }) => {
      const parsed = rowIdText.safeParse(input.productId);
      return parsed.success ? fitFeedbackFor(Number(parsed.data)) : { tooSmall: 0, tooLarge: 0 };
    }),
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
