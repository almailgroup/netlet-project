/**
 * Self-service placements (3.3.15), as endpoints.
 *
 * The guards are inside `Backend/src/services/adBookings.ts`, next to the queries, for the
 * reason every guard here is: a second caller added later would skip a
 * router-level check silently. `ads.book` is the feature switch's entry, so
 * turning placements off stops new bookings while every running one still
 * runs, is still charged and can still be cancelled — a switch closes the
 * door, it does not lock anybody in the room.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AD_SLOTS, BANNER_HEADLINE_MAX, BANNER_NOTE_MAX, MAX_AD_DAYS, SHELF_SLOTS } from "../../../Shared/commerce/adBookings.js";
import {
  AdRefused,
  bannersToday,
  bookPlacement,
  cancelPlacement,
  countWaitingBanners,
  listPlacements,
  placementCalendar,
  quotePlacement,
  reviewBanner,
  sponsoredToday,
} from "../services/adBookings.js";
import { resolveActor } from "../services/inventory.js";
import { rowId } from "../core/schemas.js";
import { protectedProcedure, publicProcedure, router } from "../core/trpc.js";

/** A refusal is a message key; a missing capability is a 403, never a 500. */
async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AdRefused) {
      throw new TRPCError({
        code: error.reason === "ads.notFound"
          ? "NOT_FOUND"
          : error.reason === "ads.full" || error.reason === "ads.notCancellable" || error.reason === "ads.bannerNotWaiting"
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

const request = z.object({
  productId: rowId,
  slot: z.enum(AD_SLOTS),
  /* The shape only; whether it is a real day, and not in the past, is
     `bookingProblem`'s answer, so it arrives as a key the page can say. */
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().int().min(1).max(MAX_AD_DAYS),
});

/* A banner's upload id and words. Lengths are the columns'; what the words
   may say is `headlineProblem`'s answer, so it arrives as a key. */
const banner = z.object({
  mediaId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  headline: z.string().max(BANNER_HEADLINE_MAX * 2),
  headlineAr: z.string().max(BANNER_HEADLINE_MAX * 2).nullish(),
});

export const adsRouter = router({
  /** Which days the place has room on, for the calendar the store books from (3.3.15). */
  calendar: protectedProcedure
    .input(z.object({ productId: rowId, slot: z.enum(AD_SLOTS) }))
    .query(async ({ ctx, input }) => guard(async () => placementCalendar(await resolveActor(ctx.user), input))),

  quote: protectedProcedure
    .input(request)
    .query(async ({ ctx, input }) => guard(async () => quotePlacement(await resolveActor(ctx.user), input))),

  book: protectedProcedure
    .input(request.extend({ banner: banner.nullish() }))
    .mutation(async ({ ctx, input }) => guard(async () => bookPlacement(await resolveActor(ctx.user), input))),

  cancel: protectedProcedure
    .input(z.object({ id: rowId }))
    .mutation(async ({ ctx, input }) => guard(async () => cancelPlacement(await resolveActor(ctx.user), input.id))),

  list: protectedProcedure
    .input(z.object({
      page: z.number().int().min(1).max(10_000).optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
      waiting: z.boolean().optional(),
    }).optional())
    .query(async ({ ctx, input }) => guard(async () => listPlacements(await resolveActor(ctx.user), input ?? {}))),

  /**
   * NetLet's answer on a home banner. Not a feature-switch entry: the booking
   * already exists and is an obligation either way.
   */
  reviewBanner: protectedProcedure
    .input(z.object({ id: rowId, decision: z.enum(["approve", "reject"]), note: z.string().max(BANNER_NOTE_MAX * 2).nullish() }))
    .mutation(async ({ ctx, input }) => guard(async () => reviewBanner(await resolveActor(ctx.user), input))),

  bannersWaiting: protectedProcedure.query(async ({ ctx }) => guard(async () => countWaitingBanners(await resolveActor(ctx.user)))),

  /** The home page's banners today. Public and not gated, for `sponsored`'s reason below. */
  banners: publicProcedure
    .input(z.object({ locale: z.enum(["en", "ar"]).optional() }).optional())
    .query(async ({ input }) => bannersToday({ locale: input?.locale })),

  /**
   * What a place shows today. Public, because the shelf is.
   *
   * **Not gated on the switch**, unlike every other rail. Turning placements
   * off stops new bookings; a placement already sold is an obligation — the
   * store is charged for each day it runs — and hiding it while still
   * charging for it would be the switch locking somebody in the room.
   */
  sponsored: publicProcedure
    .input(z.object({
      slot: z.enum(SHELF_SLOTS),
      departmentSlug: z.string().trim().min(1).max(120).optional(),
      locale: z.enum(["en", "ar"]).optional(),
    }))
    .query(async ({ input }) => sponsoredToday(input.slot, { departmentSlug: input.departmentSlug, locale: input.locale })),
});
