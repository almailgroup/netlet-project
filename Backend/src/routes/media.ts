/**
 * Product photos from outside NetLet (3.1.10), as an endpoint.
 *
 * Only the page scan is a procedure. The image itself is bytes and comes from
 * `POST /api/media/remote` beside the upload route, for the reason an upload
 * is not a procedure either: the API's JSON limit is 256 KB on purpose.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MAX_URL_LENGTH } from "../../../Shared/commerce/manufacturerImages.js";
import { resolveActor } from "../services/inventory.js";
import { ImportRefused, scanManufacturerPage } from "../services/manufacturerImages.js";
import { protectedProcedure, router } from "../core/trpc.js";

export const mediaRouter = router({
  scanPage: protectedProcedure
    .input(z.object({ url: z.string().max(MAX_URL_LENGTH * 2) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await scanManufacturerPage(await resolveActor(ctx.user), input.url);
      } catch (error) {
        if (error instanceof ImportRefused) {
          const code = error.reason === "media.notAllowed" ? "FORBIDDEN" : error.reason === "manufacturer.tooMany" ? "TOO_MANY_REQUESTS" : "BAD_REQUEST";
          throw new TRPCError({ code, message: error.reason });
        }
        throw error;
      }
    }),
});
