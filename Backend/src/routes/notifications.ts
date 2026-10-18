/**
 * The inbox (`Shared/commerce/notices.ts`), as endpoints.
 *
 * Every procedure is the signed-in person's own, scoped by `ctx.user.id`
 * inside `Backend/src/services/notifications.ts`: another person's notice id
 * marks nothing read and lists nothing. Nothing here writes a notice — the
 * acts that cause them do, after they have happened.
 */
import { z } from "zod";
import { emailPreference, inboxFor, markNoticesRead, setEmailPreference, unreadNotices } from "../services/notifications.js";
import { emailConfigured } from "../core/email.js";
import { rowId } from "../core/schemas.js";
import { protectedProcedure, publicProcedure, router } from "../core/trpc.js";

export const notificationsRouter = router({
  /* Whether anything is emailed at all — so the inbox offers the email switch,
     and the privacy policy names the mail service, only while there is one. */
  channels: publicProcedure.query(() => ({ email: emailConfigured() })),
  list: protectedProcedure
    .input(z.object({ page: z.number().int().min(1).max(10_000).default(1) }).optional())
    .query(({ ctx, input }) => inboxFor(ctx.user.id, input?.page ?? 1)),
  unread: protectedProcedure.query(({ ctx }) => unreadNotices(ctx.user.id)),
  markRead: protectedProcedure
    .input(z.object({ ids: z.array(rowId).max(100) }).or(z.object({ all: z.literal(true) })))
    .mutation(async ({ ctx, input }) => {
      await markNoticesRead(ctx.user.id, "all" in input ? "all" : input.ids);
      return { ok: true as const };
    }),
  email: protectedProcedure.query(({ ctx }) => emailPreference(ctx.user.id)),
  setEmail: protectedProcedure
    .input(z.object({ allows: z.boolean() }))
    .mutation(({ ctx, input }) => setEmailPreference(ctx.user.id, input.allows)),
});
