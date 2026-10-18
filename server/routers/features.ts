/**
 * The feature switchboard (2.3).
 *
 * `states` is public and is what the page hides entry points by; the refusal
 * itself is on the base procedure, so hiding a button is a courtesy and never
 * the control. Reading and setting the switches is admin-only.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { FEATURE_KEYS } from "../../Shared/features.js";
import { featureStates, listSwitches, setFeature } from "../features.js";
import { resolveActor } from "../inventory.js";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc.js";

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    throw error;
  }
}

export const featuresRouter = router({
  states: publicProcedure.query(() => featureStates()),
  list: protectedProcedure.query(async ({ ctx }) => {
    const actor = await resolveActor(ctx.user);
    return guard(() => listSwitches(actor));
  }),
  set: protectedProcedure
    .input(z.object({ key: z.enum(FEATURE_KEYS), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      await guard(() => setFeature(actor, input.key, input.enabled));
      return { ok: true as const };
    }),
});
