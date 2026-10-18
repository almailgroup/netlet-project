/**
 * Illustrated guides (3.5.3), as endpoints.
 *
 * `published` and `bySlug` are public and see only what is published; the
 * rest is NetLet's own desk (`platform.configure`, decided in the data layer).
 * `picture` draws one step's picture and hands it back for the editor to
 * prepare and upload like any photo; nothing drawn is stored here.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  GUIDE_AUDIENCES,
  GUIDE_STATUSES,
  GUIDE_SUMMARY_MAX,
  GUIDE_TITLE_MAX,
  GUIDE_TOPIC_MAX,
  MAX_GUIDE_STEPS,
  STEP_BODY_MAX,
  STEP_TITLE_MAX,
  acceptableGuideImage,
} from "../../../Shared/commerce/guides.js";
import { DrawingRefused, drawGuidePicture, drawingAvailable } from "../services/aiImages.js";
import { GuideRefused, deleteGuide, draftGuide, getGuide, guideBySlug, listGuides, publishedGuides, saveGuide, setGuideStatus } from "../services/guides.js";
import { resolveActor } from "../services/inventory.js";
import { rowId } from "../core/schemas.js";
import { protectedProcedure, publicProcedure, router } from "../core/trpc.js";
import { drawingRefusal } from "./tryOn.js";

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DrawingRefused) return drawingRefusal(error);
    if (error instanceof GuideRefused) {
      const code = error.reason === "guides.notFound"
        ? "NOT_FOUND"
        : error.reason === "drawing.tooMany"
          ? "TOO_MANY_REQUESTS"
          : error.reason === "drawing.off" || error.reason === "drawing.failed"
            ? "PRECONDITION_FAILED"
            : "BAD_REQUEST";
      throw new TRPCError({ code, message: error.reason });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    throw error;
  }
}

const step = z.object({
  title: z.string().max(STEP_TITLE_MAX),
  titleAr: z.string().max(STEP_TITLE_MAX),
  body: z.string().max(STEP_BODY_MAX),
  bodyAr: z.string().max(STEP_BODY_MAX),
  imageUrl: z.string().max(200).nullable().refine(acceptableGuideImage, { message: "guides.badPicture" }),
});

const content = z.object({
  audience: z.enum(GUIDE_AUDIENCES),
  title: z.string().max(GUIDE_TITLE_MAX),
  titleAr: z.string().max(GUIDE_TITLE_MAX),
  summary: z.string().max(GUIDE_SUMMARY_MAX),
  summaryAr: z.string().max(GUIDE_SUMMARY_MAX),
  steps: z.array(step).max(MAX_GUIDE_STEPS),
});

export const guidesRouter = router({
  published: publicProcedure
    .input(z.object({ audience: z.enum(GUIDE_AUDIENCES).optional(), limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(({ input }) => publishedGuides(input ?? {})),
  bySlug: publicProcedure.input(z.object({ slug: z.string().min(1).max(120) })).query(({ input }) => guideBySlug(input.slug)),

  list: protectedProcedure
    .input(z.object({ page: z.number().int().min(1).max(10_000).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => listGuides(actor, { page: input?.page }));
    }),
  get: protectedProcedure.input(z.object({ id: rowId })).query(async ({ ctx, input }) => {
    const actor = await resolveActor(ctx.user);
    return guard(() => getGuide(actor, input.id));
  }),
  save: protectedProcedure.input(z.object({ id: rowId.nullable(), guide: content })).mutation(async ({ ctx, input }) => {
    const actor = await resolveActor(ctx.user);
    return guard(() => saveGuide(actor, input.id, input.guide));
  }),
  setStatus: protectedProcedure.input(z.object({ id: rowId, status: z.enum(GUIDE_STATUSES) })).mutation(async ({ ctx, input }) => {
    const actor = await resolveActor(ctx.user);
    return guard(() => setGuideStatus(actor, input.id, input.status));
  }),
  delete: protectedProcedure.input(z.object({ id: rowId })).mutation(async ({ ctx, input }) => {
    const actor = await resolveActor(ctx.user);
    await guard(() => deleteGuide(actor, input.id));
    return { ok: true as const };
  }),

  /** Whether "Draft with AI" and "Draw a picture" can be offered at all. */
  aiAvailable: protectedProcedure.query(() => drawingAvailable()),
  draft: protectedProcedure
    .input(z.object({ topic: z.string().min(1).max(GUIDE_TOPIC_MAX), audience: z.enum(GUIDE_AUDIENCES) }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => draftGuide(actor, input.topic, input.audience));
    }),
  picture: protectedProcedure
    .input(z.object({ title: z.string().min(1).max(STEP_TITLE_MAX), body: z.string().max(STEP_BODY_MAX) }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => drawGuidePicture(actor, input));
    }),
});
