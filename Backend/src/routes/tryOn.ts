/**
 * Trying something on (3.1.8), as endpoints.
 *
 * Signed in, because every try costs NetLet a model call and is counted per
 * account; behind the `tryOn` switch, which starts off. The shopper's photo
 * is a JSON body under the API's limit — the page shrinks it to 768px first,
 * photo search's rule — and the picture comes back to them and is kept
 * nowhere (`Backend/src/services/aiImages.ts`).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { IMAGE_TYPES, MAX_IMAGE_BASE64 } from "../../../Shared/ai/gateway.js";
import { DrawingRefused, tryOn, tryOnOffered } from "../services/aiImages.js";
import { rowId } from "../core/schemas.js";
import { protectedProcedure, publicProcedure, router } from "../core/trpc.js";

export function drawingRefusal(error: unknown): never {
  if (error instanceof DrawingRefused) {
    const code = error.reason === "media.notAllowed"
      ? "FORBIDDEN"
      : error.reason === "drawing.tooMany"
        ? "TOO_MANY_REQUESTS"
        : error.reason === "tryOn.notFound"
          ? "NOT_FOUND"
          : error.reason === "drawing.off" || error.reason === "drawing.failed"
            ? "PRECONDITION_FAILED"
            : "BAD_REQUEST";
    throw new TRPCError({ code, message: error.reason });
  }
  throw error;
}

export const tryOnRouter = router({
  offered: publicProcedure.input(z.object({ productId: rowId })).query(({ input }) => tryOnOffered(input.productId)),
  make: protectedProcedure
    .input(z.object({
      productId: rowId,
      photo: z.object({ mimeType: z.enum(IMAGE_TYPES), data: z.string().min(1).max(MAX_IMAGE_BASE64).regex(/^[A-Za-z0-9+/]+={0,2}$/) }),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await tryOn(ctx.user.id, input.productId, input.photo);
      } catch (error) {
        return drawingRefusal(error);
      }
    }),
});
