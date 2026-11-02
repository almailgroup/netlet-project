/**
 * What to show this shopper.
 *
 * `publicProcedure`, not protected, because a signed-out shopper has a bag and
 * a bag is the strongest signal anybody gives us. The cart token is what
 * authorises reading that bag — the same arrangement every other cart query
 * uses, and the reason the token is random rather than a serial.
 *
 * A signed-in shopper's own signals are read from `ctx.user` and never from
 * the input, so asking for somebody else's recommendations is not a request
 * that can be phrased.
 */
import { z } from "zod";
import { publicProcedure, router } from "../core/trpc.js";
import { MAX_VIEWED, recommendFor } from "../services/recommendations.js";

export const recommendationsRouter = router({
  forMe: publicProcedure
    .input(
      z
        .object({
          /** The caller's own bag. Bounded to the token's real shape. */
          cartId: z.string().min(1).max(64).nullish(),
          limit: z.number().int().min(1).max(12).optional(),
          locale: z.enum(["en", "ar"]).optional(),
          /**
           * The products this device opened lately, newest first — the
           * browsing history, kept on the device and never stored here
           * (`lib/recentlyViewed.ts`). The weakest signal, and the one a
           * guest who has saved nothing still has.
           */
          viewed: z.array(z.string().min(1).max(191)).max(MAX_VIEWED).optional(),
          /** Only what is on offer: the "Deals picked for you" shelf. */
          onOffer: z.boolean().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      recommendFor({
        userId: ctx.user?.id ?? null,
        cartId: input?.cartId ?? null,
        limit: input?.limit,
        locale: input?.locale,
        viewed: input?.viewed,
        onOffer: input?.onOffer,
      }),
    ),
});
