/**
 * The subcategories' pictures, as endpoints (`Shared/commerce/subcategoryPictures.ts`).
 *
 * `list` is public: the shop's Categories page draws a kept picture in the
 * row's tile and the icon where there is none. The rest is NetLet's own desk
 * (`platform.configure`, decided in the data layer): `draw` hands a picture
 * back for the page to prepare and upload like any photo, and `set` keeps the
 * uploaded one, or takes it off with null.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { IMAGE_TYPES, MAX_IMAGE_BASE64 } from "../../../Shared/ai/gateway.js";
import { DrawingRefused, drawSubcategoryPicture, drawingAvailable } from "../services/aiImages.js";
import { SubcategoryPictureRefused, setSubcategoryPicture, subcategoryPictures } from "../services/subcategoryPictures.js";
import { resolveActor } from "../services/inventory.js";
import { protectedProcedure, publicProcedure, router } from "../core/trpc.js";
import { drawingRefusal } from "./tryOn.js";

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DrawingRefused) return drawingRefusal(error);
    if (error instanceof SubcategoryPictureRefused) {
      throw new TRPCError({ code: error.reason === "subcategoryPictures.notFound" ? "NOT_FOUND" : "BAD_REQUEST", message: error.reason });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    throw error;
  }
}

const which = { department: z.string().min(1).max(32), slug: z.string().min(1).max(40) };

export const subcategoryPicturesRouter = router({
  list: publicProcedure.query(() => subcategoryPictures()),
  /** Whether Draw can be offered at all: the gateway set up and `ai` on. */
  drawable: protectedProcedure.query(() => drawingAvailable()),
  draw: protectedProcedure
    .input(z.object({
      ...which,
      /* The department's own art, as the style to match. */
      reference: z.object({ mimeType: z.enum(IMAGE_TYPES), data: z.string().min(1).max(MAX_IMAGE_BASE64) }).nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => drawSubcategoryPicture(actor, input.department, input.slug, input.reference));
    }),
  set: protectedProcedure
    .input(z.object({ ...which, path: z.string().max(200).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => setSubcategoryPicture(actor, input.department, input.slug, input.path));
    }),
});
