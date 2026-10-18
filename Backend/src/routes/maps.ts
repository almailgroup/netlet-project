/**
 * Which maps the pin picker may offer — `Backend/src/core/maps.ts` decides.
 *
 * Public, because a guest at checkout drops a pin too; it says only what any
 * page that draws the map would show anyway.
 */
import { mapProviders } from "../core/maps.js";
import { publicProcedure, router } from "../core/trpc.js";

export const mapsRouter = router({
  providers: publicProcedure.query(() => mapProviders()),
});
