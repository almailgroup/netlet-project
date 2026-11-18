/**
 * Sponsored products, as endpoints (migration 0089; the rules are
 * `Shared/commerce/sponsorRequests.ts`).
 *
 * The guards are inside `Backend/src/services/sponsorRequests.ts`, next to the
 * queries, for the reason every guard here is. `sponsor.request` is the `ads`
 * switch's entry beside `ads.book`: turning placements off stops new requests,
 * and every request already made can still be answered, paid for, withdrawn
 * or stopped — a switch closes the door, it does not lock anybody in the room.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { MAX_AD_DAYS } from "../../../Shared/commerce/adBookings.js";
import { SPONSOR_NOTE_MAX, SPONSOR_REFERENCE_MAX } from "../../../Shared/commerce/sponsorRequests.js";
import {
  SPONSOR_VIEWS,
  SponsorRefused,
  approveSponsor,
  confirmSponsorPayment,
  countSponsorsToPay,
  countSponsorsWaiting,
  declineSponsor,
  listSponsors,
  paySponsorFromEarnings,
  quoteSponsor,
  requestSponsor,
  sendSponsorTransfer,
  sponsorNotReceived,
  stopSponsor,
  withdrawSponsor,
} from "../services/sponsorRequests.js";
import { resolveActor } from "../services/inventory.js";
import { rowId } from "../core/schemas.js";
import { protectedProcedure, router } from "../core/trpc.js";

/** A refusal is a message key; a missing capability is a 403, never a 500. */
async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SponsorRefused) {
      throw new TRPCError({
        code: error.reason === "sponsor.notFound"
          ? "NOT_FOUND"
          : error.reason === "sponsor.unavailable"
            ? "PRECONDITION_FAILED"
            : error.reason === "sponsor.full" || error.reason === "sponsor.moved" || error.reason === "sponsor.alreadyAsked"
              ? "CONFLICT"
              : "BAD_REQUEST",
        message: error.reason,
        cause: error.days.length ? { days: error.days } : undefined,
      });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) {
      throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    }
    throw error;
  }
}

/* The shape only; whether it is a real day, and not past, is the rule's answer. */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ask = z.object({ productId: rowId, startsOn: day, days: z.number().int().min(1).max(MAX_AD_DAYS) });
const words = z.string().max(SPONSOR_NOTE_MAX * 2);

export const sponsorRouter = router({
  quote: protectedProcedure
    .input(ask)
    .query(async ({ ctx, input }) => guard(async () => quoteSponsor(await resolveActor(ctx.user), input))),

  request: protectedProcedure
    .input(ask.extend({ note: words.nullish() }))
    .mutation(async ({ ctx, input }) => guard(async () => requestSponsor(await resolveActor(ctx.user), input))),

  list: protectedProcedure
    .input(z.object({
      view: z.enum(SPONSOR_VIEWS).optional(),
      page: z.number().int().min(1).max(10_000).optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
    }).optional())
    .query(async ({ ctx, input }) => guard(async () => listSponsors(await resolveActor(ctx.user), input ?? {}))),

  approve: protectedProcedure
    .input(z.object({ id: rowId, dailyRate: z.string().max(20).nullish(), payBy: day.nullish(), reply: words.nullish() }))
    .mutation(async ({ ctx, input }) => guard(async () => approveSponsor(await resolveActor(ctx.user), input))),

  decline: protectedProcedure
    .input(z.object({ id: rowId, reply: words }))
    .mutation(async ({ ctx, input }) => guard(async () => declineSponsor(await resolveActor(ctx.user), input))),

  payFromEarnings: protectedProcedure
    .input(z.object({ id: rowId }))
    .mutation(async ({ ctx, input }) => guard(async () => paySponsorFromEarnings(await resolveActor(ctx.user), input.id))),

  sendTransfer: protectedProcedure
    .input(z.object({ id: rowId, reference: z.string().max(SPONSOR_REFERENCE_MAX * 2) }))
    .mutation(async ({ ctx, input }) => guard(async () => sendSponsorTransfer(await resolveActor(ctx.user), input))),

  confirmPayment: protectedProcedure
    .input(z.object({ id: rowId, startsOn: day.nullish() }))
    .mutation(async ({ ctx, input }) => guard(async () => confirmSponsorPayment(await resolveActor(ctx.user), input))),

  notReceived: protectedProcedure
    .input(z.object({ id: rowId, reply: words, payBy: day.nullish() }))
    .mutation(async ({ ctx, input }) => guard(async () => sponsorNotReceived(await resolveActor(ctx.user), input))),

  withdraw: protectedProcedure
    .input(z.object({ id: rowId }))
    .mutation(async ({ ctx, input }) => guard(async () => withdrawSponsor(await resolveActor(ctx.user), input.id))),

  stop: protectedProcedure
    .input(z.object({ id: rowId }))
    .mutation(async ({ ctx, input }) => guard(async () => stopSponsor(await resolveActor(ctx.user), input.id))),

  /** For the overview: what waits on NetLet, or on this store. */
  waiting: protectedProcedure.query(async ({ ctx }) => guard(async () => {
    const actor = await resolveActor(ctx.user);
    return { forNetLet: await countSponsorsWaiting(actor), toPay: await countSponsorsToPay(actor) };
  })),
});
