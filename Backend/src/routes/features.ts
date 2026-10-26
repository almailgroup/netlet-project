/**
 * The feature switchboard (2.3).
 *
 * `states` is public and is what the page hides entry points by; the refusal
 * itself is on the base procedure, so hiding a button is a courtesy and never
 * the control. Reading and setting the switches is admin-only.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { FEATURE_KEYS } from "../../../Shared/features.js";
import { featureStates, listSwitches, setFeature } from "../services/features.js";
import { listSettings, setSetting, SettingRefused } from "../services/settings.js";
import { SETTING_KEYS } from "../../../Shared/settings.js";
import { resolveActor } from "../services/inventory.js";
import { protectedProcedure, publicProcedure, router } from "../core/trpc.js";

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
  /** The numbers an administrator sets without a deploy — the referral rates (3.1.15). */
  settings: protectedProcedure.query(async ({ ctx }) => {
    const actor = await resolveActor(ctx.user);
    return guard(() => listSettings(actor));
  }),
  setSetting: protectedProcedure
    .input(z.object({ key: z.enum(SETTING_KEYS as [string, ...string[]]), value: z.string().trim().max(12) }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      try {
        const value = await guard(() => setSetting(actor, input.key as (typeof SETTING_KEYS)[number], input.value));
        return { value };
      } catch (error) {
        if (error instanceof SettingRefused) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        throw error;
      }
    }),
});
