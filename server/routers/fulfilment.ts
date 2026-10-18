/**
 * Fulfilled by NetLet (4.2), as endpoints.
 *
 * Sellers send (`fulfilment.send`, scoped to their own store inside
 * `server/netletFulfilment.ts`); NetLet operates (`fulfilment.operate`). The
 * guards live beside the queries, for the reason every guard here does.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { INBOUND_STATUSES, MAX_INBOUND_LINES, MAX_INBOUND_UNITS } from "../../Shared/commerce/netletFulfilment.js";
import { GOVERNORATES } from "../../Shared/inventory/storeProfile.js";
import {
  FulfilmentProblem,
  announceShipment,
  cancelShipment,
  createCentre,
  heldStock,
  listCentres,
  listShipments,
  markPacked,
  pickList,
  programmeOpen,
  receiveShipment,
  returnToSeller,
  sendableVariants,
  setPackRate,
  listCharges,
  setCentreActive,
  waitingAtCentres,
} from "../netletFulfilment.js";
import { resolveActor } from "../inventory.js";
import { rowId } from "../_core/schemas.js";
import { protectedProcedure, router } from "../_core/trpc.js";

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FulfilmentProblem) {
      throw new TRPCError({ code: error.reason === "fulfilment.notFound" ? "NOT_FOUND" : error.reason === "fulfilment.notAnnounced" ? "CONFLICT" : "BAD_REQUEST", message: error.reason });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    throw error;
  }
}

const page = z.number().int().min(1).max(10_000).optional();

export const fulfilmentRouter = router({
  /** Whether any centre is open: the programme is "activated later" until one is. */
  open: protectedProcedure.query(() => programmeOpen()),

  centres: protectedProcedure.query(async ({ ctx }) => guard(async () => listCentres(await resolveActor(ctx.user)))),

  createCentre: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(120), governorate: z.enum(GOVERNORATES), addressLine: z.string().trim().min(1).max(300) }))
    .mutation(async ({ ctx, input }) => guard(async () => createCentre(await resolveActor(ctx.user), input))),

  setCentreActive: protectedProcedure
    .input(z.object({ id: rowId, active: z.boolean() }))
    .mutation(async ({ ctx, input }) => guard(async () => setCentreActive(await resolveActor(ctx.user), input.id, input.active))),

  announce: protectedProcedure
    .input(z.object({
      vendorId: rowId.optional(),
      centreId: rowId,
      /* A little over the rule's own ceilings, so the rule — not zod — names the problem. */
      lines: z.array(z.object({ variantId: rowId, quantity: z.number().int().min(-1).max(MAX_INBOUND_UNITS + 1) })).max(MAX_INBOUND_LINES + 1),
      note: z.string().trim().max(500).nullish(),
    }))
    .mutation(async ({ ctx, input }) => guard(async () => {
      const actor = await resolveActor(ctx.user, input.vendorId);
      const vendorId = actor.kind === "vendor" ? actor.vendorId : input.vendorId;
      if (!vendorId) throw new TRPCError({ code: "BAD_REQUEST", message: "fulfilment.notYourVariant" });
      return announceShipment(actor, { ...input, vendorId });
    })),

  sendable: protectedProcedure
    .input(z.object({ vendorId: rowId.optional(), query: z.string().max(120).default("") }))
    .query(async ({ ctx, input }) => guard(async () => {
      const actor = await resolveActor(ctx.user, input.vendorId);
      const vendorId = actor.kind === "vendor" ? actor.vendorId : input.vendorId;
      if (!vendorId) return [];
      return sendableVariants(actor, vendorId, input.query);
    })),

  /* The packing fee (4.2): a rate per centre that NetLet sets, null for none. */
  setPackRate: protectedProcedure
    .input(z.object({ id: rowId, rate: z.string().trim().max(16).nullable() }))
    .mutation(async ({ ctx, input }) => guard(async () => setPackRate(await resolveActor(ctx.user), input.id, input.rate || null))),

  charges: protectedProcedure
    .input(z.object({ page }).optional())
    .query(async ({ ctx, input }) => guard(async () => listCharges(await resolveActor(ctx.user), input ?? {}))),

  cancel: protectedProcedure
    .input(z.object({ id: rowId }))
    .mutation(async ({ ctx, input }) => guard(async () => cancelShipment(await resolveActor(ctx.user), input.id))),

  shipments: protectedProcedure
    .input(z.object({ status: z.enum(INBOUND_STATUSES).optional(), page }).optional())
    .query(async ({ ctx, input }) => guard(async () => listShipments(await resolveActor(ctx.user), input ?? {}))),

  receive: protectedProcedure
    .input(z.object({ id: rowId, counts: z.array(z.object({ lineId: rowId, received: z.number().int().min(0).max(MAX_INBOUND_UNITS) })).max(MAX_INBOUND_LINES) }))
    .mutation(async ({ ctx, input }) => guard(async () => receiveShipment(await resolveActor(ctx.user), input.id, input.counts))),

  held: protectedProcedure
    .input(z.object({ page }).optional())
    .query(async ({ ctx, input }) => guard(async () => heldStock(await resolveActor(ctx.user), input ?? {}))),

  returnToSeller: protectedProcedure
    .input(z.object({ variantId: rowId }))
    .mutation(async ({ ctx, input }) => guard(async () => returnToSeller(await resolveActor(ctx.user), input.variantId))),

  pickList: protectedProcedure.query(async ({ ctx }) => guard(async () => pickList(await resolveActor(ctx.user)))),

  markPacked: protectedProcedure
    .input(z.object({ orderId: rowId, centreId: rowId }))
    .mutation(async ({ ctx, input }) => guard(async () => markPacked(await resolveActor(ctx.user), input.orderId, input.centreId))),

  waiting: protectedProcedure.query(async ({ ctx }) => guard(async () => waitingAtCentres(await resolveActor(ctx.user)))),
});
