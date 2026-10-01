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
import { rowId } from "../_core/schemas.js";
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
import {
  countOpenClaims,
  damageLedger,
  decideClaim,
  deliveryScores,
  fileClaim,
  listClaims,
  ParcelCareRefused,
  respondToClaim,
} from "../parcelCare.js";
import { MAX_CLAIM_DESCRIPTION, MAX_CLAIM_RESPONSE } from "../../shared/commerce/damageClaims.js";
import { protectedProcedure, router } from "../_core/trpc.js";

/** A parcel has no id of its own: it is named by its order and its key. */
const parcelRef = z.object({ orderId: rowId, key: z.string().min(1).max(200) });

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DispatchError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    if (error instanceof ParcelCareRefused) {
      throw new TRPCError({ code: error.reason === "parcel.notFound" ? "NOT_FOUND" : "BAD_REQUEST", message: error.reason });
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
        courierId: rowId.optional(),
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
    .input(parcelRef.extend({ courierId: rowId.nullable() }))
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

  /**
   * Each delivery company's score from shoppers' delivery ratings (3.4.4).
   * A company sees its own; an administrator sees every company's.
   */
  scores: protectedProcedure.query(async ({ ctx }) => {
    const actor = await resolveActor(ctx.user);
    return guard(() => deliveryScores(actor));
  }),

  /**
   * Damage in transit (3.4.2). One set of procedures for the three parties,
   * scoped inside the data layer: a seller files and reads claims on their own
   * goods, a company reads and answers claims against it, NetLet decides.
   */
  claims: router({
    list: protectedProcedure
      .input(z.object({ status: z.enum(["open", "accepted", "rejected"]).optional() }).optional())
      .query(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => listClaims(actor, input ?? {}));
      }),
    file: protectedProcedure
      .input(z.object({
        orderId: rowId,
        lineIds: z.array(rowId).min(1).max(100),
        amount: z.string().max(16),
        description: z.string().max(MAX_CLAIM_DESCRIPTION),
        evidenceUrl: z.string().trim().max(2000).nullish(),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => fileClaim({ kind: "actor", actor, orderId: input.orderId }, input));
      }),
    respond: protectedProcedure
      .input(z.object({ claimId: rowId, response: z.string().max(MAX_CLAIM_RESPONSE) }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        await guard(() => respondToClaim(actor, input.claimId, input.response));
        return { success: true } as const;
      }),
    decide: protectedProcedure
      .input(z.object({
        claimId: rowId,
        outcome: z.enum(["accepted", "rejected"]),
        awardedAmount: z.string().max(16).nullish(),
        note: z.string().max(500).nullish(),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        await guard(() => decideClaim(actor, input.claimId, input));
        return { success: true } as const;
      }),
    ledger: protectedProcedure.query(async ({ ctx }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => damageLedger(actor));
    }),
    openCount: protectedProcedure.query(async ({ ctx }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => countOpenClaims(actor));
    }),
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
      .input(z.object({ courierId: rowId, status: z.enum(["active", "suspended"]) }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        await guard(() => setCourierStatus(actor, input.courierId, input.status));
        return { success: true } as const;
      }),
    members: protectedProcedure
      .input(z.object({ courierId: rowId }))
      .query(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => listCourierMembers(actor, input.courierId));
      }),
    addMember: protectedProcedure
      .input(z.object({ courierId: rowId, userId: rowId }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        await guard(() => addCourierMember(actor, input.courierId, input.userId));
        return { success: true } as const;
      }),
    removeMember: protectedProcedure
      .input(z.object({ courierId: rowId, userId: rowId }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        await guard(() => removeCourierMember(actor, input.courierId, input.userId));
        return { success: true } as const;
      }),
  }),
});

export type DispatchRouter = typeof dispatchRouter;
