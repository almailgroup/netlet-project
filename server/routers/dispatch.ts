/**
 * The dispatch board's API, for the delivery company and the admin.
 *
 * `shared/commerce/parcels.ts` decides what a parcel is and what a driver may
 * do with one; `server/dispatch.ts` holds the queries and the guards. This is
 * only the translation layer: resolve who is asking, and turn a refusal the
 * caller can act on into a 400 carrying its message key rather than a sentence,
 * because the page is read in two languages.
 *
 * Every procedure is protected. There is no public half: a board that could be
 * read without signing in would be a list of every shopper's address.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  DispatchError,
  addCourierMember,
  assignParcel,
  countWaitingParcels,
  createCourier,
  listCourierMembers,
  listCouriers,
  loadBoard,
  moveParcel,
  removeCourierMember,
  setCourierStatus,
} from "../dispatch.js";
import { resolveActor } from "../inventory.js";
import { protectedProcedure, router } from "../_core/trpc.js";

/** A parcel has no id of its own: it is named by its order and its key. */
const parcelRef = z.object({ orderId: z.number().int().positive(), key: z.string().min(1).max(200) });

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DispatchError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) {
      throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    }
    throw error;
  }
}

export const dispatchRouter = router({
  /**
   * Who is asking, as the board needs to know it.
   *
   * The page asks this before it draws anything, for the reason `inventory.me`
   * exists: a control a courier can see but not use is the dead-control rule,
   * and the server is the only thing that knows which company somebody is.
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    const actor = await resolveActor(ctx.user);
    return actor.kind === "courier"
      ? { kind: "courier" as const, courierId: actor.courierId }
      : { kind: actor.kind };
  }),

  board: protectedProcedure
    .input(
      z.object({
        state: z.enum(["waiting", "transit", "done"]).optional(),
        courierId: z.number().int().positive().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => loadBoard(actor, input ?? {}));
    }),

  waiting: protectedProcedure.query(async ({ ctx }) => {
    const actor = await resolveActor(ctx.user);
    return guard(() => countWaitingParcels(actor));
  }),

  assign: protectedProcedure
    .input(parcelRef.extend({ courierId: z.number().int().positive().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      await guard(() => assignParcel(actor, input.orderId, input.key, input.courierId));
      return { success: true } as const;
    }),

  /**
   * Collected, or handed over.
   *
   * The two states are named in the input rather than inferred from where the
   * parcel is, so the call says what the driver witnessed — and `courierMoves`
   * refuses anything else, which is the same function the buttons come from.
   */
  move: protectedProcedure
    .input(parcelRef.extend({ to: z.enum(["shipped", "delivered"]) }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      await guard(() => moveParcel(actor, input.orderId, input.key, input.to));
      return { success: true } as const;
    }),

  couriers: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => listCouriers(actor));
    }),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1).max(160),
          nameAr: z.string().max(160).nullable().optional(),
          contactPhone: z.string().max(40).nullable().optional(),
          contactEmail: z.string().max(320).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => createCourier(actor, input));
      }),
    setStatus: protectedProcedure
      .input(z.object({ courierId: z.number().int().positive(), status: z.enum(["active", "suspended"]) }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        await guard(() => setCourierStatus(actor, input.courierId, input.status));
        return { success: true } as const;
      }),
    members: protectedProcedure
      .input(z.object({ courierId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => listCourierMembers(actor, input.courierId));
      }),
    addMember: protectedProcedure
      .input(z.object({ courierId: z.number().int().positive(), userId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        await guard(() => addCourierMember(actor, input.courierId, input.userId));
        return { success: true } as const;
      }),
    removeMember: protectedProcedure
      .input(z.object({ courierId: z.number().int().positive(), userId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        await guard(() => removeCourierMember(actor, input.courierId, input.userId));
        return { success: true } as const;
      }),
  }),
});

export type DispatchRouter = typeof dispatchRouter;
