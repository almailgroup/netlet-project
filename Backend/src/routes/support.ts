/**
 * Talking to NetLet (3.5.1), as endpoints.
 *
 * The shopper's half is scoped by `ctx.user.id` inside `Backend/src/services/support.ts`;
 * NetLet's half is guarded there by `support.answer`, next to the queries, for
 * the reason every guard here is.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { MAX_SUPPORT_MESSAGE, SUPPORT_STATUSES, SUPPORT_TOPICS, supportNumber } from "../../../Shared/commerce/support.js";
import { companyDetails, contactEmail, socialLinks, visitDetails } from "../../../Shared/commerce/contact.js";
import { ENV } from "../core/env.js";
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
} from "../services/support.js";
import { draftAvailable, draftReply } from "../services/supportDraft.js";
import { resolveActor } from "../services/inventory.js";
import { rowId } from "../core/schemas.js";
import { protectedProcedure, publicProcedure, router } from "../core/trpc.js";
import { askAboutOrder, orderHelpAvailable } from "../services/orderHelp.js";
import { MAX_ORDER_HELP_QUESTION, ORDER_HELP_TURNS } from "../../../Shared/commerce/orderHelp.js";
import { HELP_DONE, HELP_ISSUES, MAX_HANDOVER_DONE } from "../../../Shared/commerce/selfService.js";
import { selfHelpFor } from "../services/selfHelp.js";

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
    visit: visitDetails(ENV.supportAddress, ENV.supportAddressAr),
    social: socialLinks(ENV.social),
    company: companyDetails({
      name: ENV.invoiceIssuerName,
      nameAr: ENV.invoiceIssuerNameAr,
      licence: ENV.invoiceIssuerLicence,
      address: ENV.invoiceIssuerAddress,
    }),
  })),

  /** Whether "Get help with this order" can answer with NetLet AI before a person. */
  orderHelpAvailable: protectedProcedure.query(() => orderHelpAvailable()),

  /**
   * NetLet AI's answer about one of the shopper's own orders, from the order's
   * facts (on the owner's word: "let the AI resolve the issue before any real
   * reaction"). The facts are the server's own read; the turns are the
   * conversation so far, the last the shopper's question.
   */
  orderHelp: protectedProcedure
    .input(z.object({
      reference: z.string().trim().min(1).max(64),
      locale: z.enum(["en", "ar"]).default("en"),
      /* What the shopper chose before asking, so the model starts from it. */
      issue: z.enum(HELP_ISSUES).nullish(),
      lineId: rowId.nullish(),
      turns: z.array(z.object({ role: z.enum(["shopper", "assistant"]), text: z.string().max(MAX_ORDER_HELP_QUESTION * 4) })).min(1).max(ORDER_HELP_TURNS),
    }))
    .mutation(({ ctx, input }) => askAboutOrder(ctx.user.id, input)),

  /**
   * The help centre's answer to an issue the shopper named (on the owner's
   * word: "immediate solutions … integrated with order management, shipping,
   * returns, refunds and warranty"): what is true of this order now, the acts
   * that would settle it, and whether a person is the next step. Computed from
   * the order page's own answer, never a model's.
   */
  selfHelp: protectedProcedure
    .input(z.object({
      issue: z.enum(HELP_ISSUES),
      reference: z.string().trim().min(1).max(64).nullish(),
      lineId: rowId.nullish(),
      locale: z.enum(["en", "ar"]).default("en"),
    }))
    .query(async ({ ctx, input }) => {
      const answer = await selfHelpFor(ctx.user.id, { issue: input.issue, reference: input.reference ?? null, lineId: input.lineId ?? null, locale: input.locale });
      if (!answer) throw new TRPCError({ code: "NOT_FOUND", message: "orders.detailMissing" });
      return answer;
    }),

  open: protectedProcedure
    .input(z.object({
      topic: z.enum(SUPPORT_TOPICS),
      orderReference: z.string().trim().min(1).max(64).nullish(),
      body,
      /* What the help centre passes on, so the shopper never says it twice. */
      handover: z.object({
        issue: z.enum(HELP_ISSUES).nullable(),
        lineId: rowId.nullable(),
        done: z.array(z.object({ act: z.enum(HELP_DONE), lineId: rowId.nullable() })).max(MAX_HANDOVER_DONE),
      }).nullish(),
    }))
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
