/**
 * Which maps the pin picker may offer — `Backend/src/core/maps.ts` decides —
 * and what address a pin is on.
 *
 * Public, because a guest at checkout drops a pin too; `providers` says only
 * what any page that draws the map would show anyway.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { pinProblem } from "../../../Shared/commerce/geo.js";
import { mapProviders } from "../core/maps.js";
import { publicProcedure, router } from "../core/trpc.js";
import { placeAt } from "../services/placeLookup.js";
import { checkPlaceLookupAllowed, recordPlaceLookup } from "../services/rateLimit.js";

export const mapsRouter = router({
  providers: publicProcedure.query(() => mapProviders()),

  /**
   * The area, block, street and house at a pin, for the address form to fill
   * (`services/placeLookup.ts`), or null when no service knows. Counted by
   * address in Postgres before the lookup, every request alike: each one goes
   * to OpenStreetMap's free service.
   */
  placeAt: publicProcedure
    .input(z.object({ lat: z.number(), lng: z.number(), locale: z.enum(["en", "ar"]).optional() }))
    .query(async ({ ctx, input }) => {
      const pin = { lat: input.lat, lng: input.lng };
      const problem = pinProblem(pin);
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      const address = ctx.req.ip ?? null;
      const verdict = await checkPlaceLookupAllowed(address);
      if (!verdict.allowed) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "pin.lookupTooMany", cause: { retryAfterSeconds: verdict.retryAfterSeconds } });
      }
      await recordPlaceLookup(address);
      return placeAt(pin, input.locale ?? "en");
    }),
});
