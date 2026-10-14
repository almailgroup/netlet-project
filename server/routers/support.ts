/**
 * Talking to NetLet (3.5.1), as endpoints.
 *
 * The shopper's half is scoped by `ctx.user.id` inside `server/support.ts`;
 * NetLet's half is guarded there by `support.answer`, next to the queries, for
 * the reason every guard here is.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { MAX_SUPPORT_MESSAGE, SUPPORT_STATUSES, SUPPORT_TOPICS, supportNumber } from "../../shared/commerce/support.js";
import { companyDetails, contactEmail, socialLinks } from "../../shared/commerce/contact.js";
import { ENV } from "../_core/env.js";
import {
  conversationForShopper,
  conversationForStaff,
  inbox,
  myConversations,
  openConversation,
  replyAsShopper,
  replyAsStaff,
  resolveAsShopper,
  resolveAsStaff,
  SupportRefused,
  unreadForShopper,
  waitingOnStaff,
} from "../support.js";
import { draftAvailable, draftReply } from "../supportDraft.js";
import { resolveActor } from "../inventory.js";
import { rowId } from "../_core/schemas.js";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc.js";

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SupportRefused) {
      throw new TRPCError({
        code: error.reason === "support.notFound" ? "NOT_FOUND" : error.reason === "support.tooMany" ? "TOO_MANY_REQUESTS" : "BAD_REQUEST",
        message: error.reason,
      });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    throw error;
  }
}

/* A little over the rule's own ceiling, so the rule — not zod — names the problem. */
const body = z.string().max(MAX_SUPPORT_MESSAGE + 200);

export const supportRouter = router({
  /* NetLet's WhatsApp and phone (3.5.1), its email and profiles, and who it
     is — every one public and optional, as the footer and the help page draw
     them. A malformed value is no channel rather than a link to nobody. */
  channels: publicProcedure.query(() => ({
    whatsapp: supportNumber(ENV.supportWhatsapp),
    phone: supportNumber(ENV.supportPhone),
    email: contactEmail(ENV.supportEmail),
    social: socialLinks(ENV.social),
    company: companyDetails({
      name: ENV.invoiceIssuerName,
      nameAr: ENV.invoiceIssuerNameAr,
      licence: ENV.invoiceIssuerLicence,
      address: ENV.invoiceIssuerAddress,
    }),
  })),

  open: protectedProcedure
    .input(z.object({ topic: z.enum(SUPPORT_TOPICS), orderReference: z.string().trim().min(1).max(64).nullish(), body }))
    .mutation(({ ctx, input }) => guard(() => openConversation(ctx.user.id, input))),

  mine: protectedProcedure.query(({ ctx }) => guard(() => myConversations(ctx.user.id))),

  unread: protectedProcedure.query(({ ctx }) => guard(() => unreadForShopper(ctx.user.id))),

  thread: protectedProcedure
    .input(z.object({ id: rowId }))
    .query(({ ctx, input }) => guard(() => conversationForShopper(ctx.user.id, input.id))),

  reply: protectedProcedure
    .input(z.object({ id: rowId, body }))
    .mutation(({ ctx, input }) => guard(() => replyAsShopper(ctx.user.id, input.id, input.body))),

  resolve: protectedProcedure
    .input(z.object({ id: rowId }))
    .mutation(({ ctx, input }) => guard(() => resolveAsShopper(ctx.user.id, input.id))),

  inbox: protectedProcedure
    .input(z.object({ status: z.enum(SUPPORT_STATUSES).optional(), page: z.number().int().min(1).max(10_000).optional() }).optional())
    .query(async ({ ctx, input }) => guard(async () => inbox(await resolveActor(ctx.user), input ?? {}))),

  staffThread: protectedProcedure
    .input(z.object({ id: rowId }))
    .query(async ({ ctx, input }) => guard(async () => conversationForStaff(await resolveActor(ctx.user), input.id))),

  staffReply: protectedProcedure
    .input(z.object({ id: rowId, body }))
    .mutation(async ({ ctx, input }) => guard(async () => replyAsStaff(await resolveActor(ctx.user), input.id, input.body))),

  staffResolve: protectedProcedure
    .input(z.object({ id: rowId }))
    .mutation(async ({ ctx, input }) => guard(async () => resolveAsStaff(await resolveActor(ctx.user), input.id))),

  /* A model's draft for staff to edit and send — never sent by itself. */
  draftAvailable: protectedProcedure.query(async ({ ctx }) => guard(async () => draftAvailable(await resolveActor(ctx.user)))),

  draft: protectedProcedure
    .input(z.object({ id: rowId }))
    .mutation(async ({ ctx, input }) => guard(async () => draftReply(await resolveActor(ctx.user), input.id))),

  waiting: protectedProcedure.query(async ({ ctx }) => guard(async () => waitingOnStaff(await resolveActor(ctx.user)))),
});
