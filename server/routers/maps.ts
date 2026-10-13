/**
 * Which maps the pin picker may offer — `server/_core/maps.ts` decides.
 *
 * Public, because a guest at checkout drops a pin too; it says only what any
 * page that draws the map would show anyway.
 */
import { mapProviders } from "../_core/maps.js";
import { publicProcedure, router } from "../_core/trpc.js";

export const mapsRouter = router({
  providers: publicProcedure.query(() => mapProviders()),
});
