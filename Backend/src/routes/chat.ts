/**
 * Shoppers and sellers talking (3.8), over tRPC.
 *
 * The rules are `Shared/commerce/contactFilter.ts` and the scope is
 * `Backend/src/services/chat.ts`; this is the translation layer. Every procedure is
 * protected: a message somebody cannot be answered at is not a conversation,
 * and a signed-out sender is one the throttle cannot count.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { rowId } from "../core/schemas.js";
import { protectedProcedure, router } from "../core/trpc.js";
import {
  ChatRefused,
  conversationsForSeller,
  conversationsForShopper,
  openThread,
  sendAsSeller,
  sendAsShopper,
  unreadForSeller,
  unreadForShopper,
} from "../services/chat.js";
import { resolveActor } from "../services/inventory.js";
import { MAX_MESSAGE_LENGTH } from "../../../Shared/commerce/contactFilter.js";

/* Room for the trim: the limit is on what is stored, and a message one space
   over the limit is refused by the data layer with a key rather than here. */
const body = z.string().max(MAX_MESSAGE_LENGTH + 200);

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ChatRefused) {
      const code = error.reason === "chat.notFound" ? "NOT_FOUND" : error.reason === "chat.tooMany" ? "TOO_MANY_REQUESTS" : "BAD_REQUEST";
      throw new TRPCError({ code, message: error.reason });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) {
      throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    }
    throw error;
  }
}

export const chatRouter = router({
  /** The shopper's conversations. */
  mine: protectedProcedure.query(({ ctx }) => guard(() => conversationsForShopper(ctx.user.id))),

  /** Unread replies waiting on the shopper, for a badge that hides at zero. */
  unread: protectedProcedure.query(({ ctx }) => guard(() => unreadForShopper(ctx.user.id))),

  /**
   * Send as the shopper: into a conversation of theirs, or opening one about a
   * product or about one of their orders.
   */
  send: protectedProcedure
    .input(z.object({
      conversationId: rowId.optional(),
      productId: rowId.optional(),
      orderReference: z.string().min(1).max(64).optional(),
      vendorId: rowId.optional(),
      body,
    }))
    .mutation(({ ctx, input }) => guard(() => sendAsShopper({ id: ctx.user.id, email: ctx.user.email }, input))),

  /** One of the shopper's conversations, marked read. */
  thread: protectedProcedure
    .input(z.object({ conversationId: rowId }))
    .query(({ ctx, input }) => guard(() => openThread({ kind: "shopper", userId: ctx.user.id }, input.conversationId))),

  /** The store's side: an inbox, a thread, a reply. */
  seller: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => conversationsForSeller(actor));
    }),
    unread: protectedProcedure.query(async ({ ctx }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => unreadForSeller(actor));
    }),
    thread: protectedProcedure
      .input(z.object({ conversationId: rowId }))
      .query(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => openThread({ kind: "actor", actor }, input.conversationId));
      }),
    reply: protectedProcedure
      .input(z.object({ conversationId: rowId, body }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        await guard(() => sendAsSeller(actor, input.conversationId, input.body));
        return { success: true } as const;
      }),
  }),
});
