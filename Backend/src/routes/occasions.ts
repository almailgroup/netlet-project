/**
 * The occasions NetLet curates by hand, as endpoints
 * (`Backend/src/services/occasions.ts`).
 *
 * `live` and `bySlug` are public — the home page and an occasion's own page —
 * and see only what is published. The rest is NetLet's desk
 * (`platform.configure`, decided in the data layer), so a store's person or a
 * shopper asking is refused there rather than here.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MAX_OCCASION_PRODUCTS, OCCASION_SLUG_MAX, OCCASION_STATUSES, OCCASION_TITLE_MAX } from "../../../Shared/commerce/occasionDesk.js";
import { rowId } from "../core/schemas.js";
import { protectedProcedure, publicProcedure, router } from "../core/trpc.js";
import { resolveActor } from "../services/inventory.js";
import {
  OccasionRefused,
  deleteOccasion,
  getOccasion,
  hideCalendarOccasion,
  listOccasions,
  liveOccasions,
  occasionBySlug,
  saveOccasion,
  setOccasionStatus,
} from "../services/occasions.js";

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof OccasionRefused) {
      const code = error.reason === "occasions.notFound"
        ? "NOT_FOUND"
        : error.reason === "occasions.unavailable"
          ? "PRECONDITION_FAILED"
          : error.reason === "occasions.slugTaken"
            ? "CONFLICT"
            : "BAD_REQUEST";
      throw new TRPCError({ code, message: error.reason });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    throw error;
  }
}

const locale = z.enum(["en", "ar"]).optional();
/* An address as `?occasion=` reads it; what it must look like is the rule's to say, in words. */
const slug = z.string().min(1).max(OCCASION_SLUG_MAX);
const day = z.string().max(10).nullable();

const draft = z.object({
  slug,
  title: z.string().max(OCCASION_TITLE_MAX * 2),
  titleAr: z.string().max(OCCASION_TITLE_MAX * 2),
  imageUrl: z.string().max(200).nullable(),
  startsOn: day,
  endsOn: day,
  includeTagged: z.boolean(),
  productIds: z.array(rowId).max(MAX_OCCASION_PRODUCTS * 2),
});

export const occasionsRouter = router({
  live: publicProcedure.input(z.object({ locale }).optional()).query(({ input }) => liveOccasions(input?.locale ?? "en")),
  bySlug: publicProcedure.input(z.object({ slug, locale })).query(({ input }) => occasionBySlug(input.slug, input.locale ?? "en")),

  list: protectedProcedure.query(async ({ ctx }) => {
    const actor = await resolveActor(ctx.user);
    return guard(() => listOccasions(actor));
  }),
  get: protectedProcedure.input(z.object({ id: rowId })).query(async ({ ctx, input }) => {
    const actor = await resolveActor(ctx.user);
    return guard(() => getOccasion(actor, input.id));
  }),
  save: protectedProcedure.input(z.object({ id: rowId.nullable(), occasion: draft })).mutation(async ({ ctx, input }) => {
    const actor = await resolveActor(ctx.user);
    return guard(() => saveOccasion(actor, input.id, input.occasion));
  }),
  setStatus: protectedProcedure.input(z.object({ id: rowId, status: z.enum(OCCASION_STATUSES) })).mutation(async ({ ctx, input }) => {
    const actor = await resolveActor(ctx.user);
    return guard(() => setOccasionStatus(actor, input.id, input.status));
  }),
  /** Switch one of the calendar's own occasions off. */
  hide: protectedProcedure.input(z.object({ slug })).mutation(async ({ ctx, input }) => {
    const actor = await resolveActor(ctx.user);
    return guard(() => hideCalendarOccasion(actor, input.slug));
  }),
  delete: protectedProcedure.input(z.object({ id: rowId })).mutation(async ({ ctx, input }) => {
    const actor = await resolveActor(ctx.user);
    await guard(() => deleteOccasion(actor, input.id));
    return { ok: true as const };
  }),
});
