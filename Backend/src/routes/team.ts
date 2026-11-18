/**
 * NetLet's team (`Shared/inventory/team.ts`, `services/team.ts`): who on
 * NetLet's side opens which part of the admin panel. Every procedure resolves
 * who is asking and the data layer refuses the rest — `team.manage` for the
 * desk and its members (HR and full administrators), a full administrator
 * alone for the roles themselves.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { checkPassword, MIN_PASSWORD_LENGTH } from "../../../Shared/auth/passwordStrength.js";
import { ROLE_NAME_MAX, TEAM_AREAS } from "../../../Shared/inventory/team.js";
import { rowId } from "../core/schemas.js";
import { protectedProcedure, router } from "../core/trpc.js";
import { resolveActor } from "../services/inventory.js";
import {
  addToTeam,
  createTeamMember,
  createTeamRole,
  deleteTeamRole,
  removeFromTeam,
  setTeamRole,
  TeamRefused,
  teamDesk,
  updateTeamRole,
} from "../services/team.js";

/** A refusal is a 4xx carrying the message key the page says; a capability refused is a 403. */
async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof TeamRefused) {
      const code =
        error.reason === "team.unavailable" ? "PRECONDITION_FAILED"
        : error.reason === "team.noSuchAccount" || error.reason === "team.noSuchRole" || error.reason === "team.notOn" ? "NOT_FOUND"
        : error.reason === "team.notAllowed" || error.reason === "team.fullOnly" || error.reason === "team.rolesFullOnly" ? "FORBIDDEN"
        : error.reason === "team.alreadyOn" || error.reason === "team.roleHeld" || error.reason === "team.emailTaken" ? "CONFLICT"
        : "BAD_REQUEST";
      throw new TRPCError({ code, message: error.reason });
    }
    if (error instanceof Error && error.message.startsWith("FORBIDDEN:")) {
      throw new TRPCError({ code: "FORBIDDEN", message: error.message });
    }
    throw error;
  }
}

/** Null is a full administrator; a number is a role on the team. */
const roleChoice = rowId.nullable();
const roleInput = z.object({
  name: z.string().max(ROLE_NAME_MAX * 2).default(""),
  nameAr: z.string().max(ROLE_NAME_MAX * 2).default(""),
  areas: z.array(z.enum(TEAM_AREAS)).max(TEAM_AREAS.length),
});

export const teamRouter = router({
  /** Everybody on the team with their role, every role with what it opens, and what this person may press. */
  desk: protectedProcedure.query(async ({ ctx }) => {
    const actor = await resolveActor(ctx.user);
    return guard(() => teamDesk(actor));
  }),

  /** Somebody who already has an account, put on the team. */
  add: protectedProcedure
    .input(z.object({ email: z.string().trim().email().max(320), roleId: roleChoice }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => addToTeam(actor, input));
    }),

  /** A new account made for a new member, with the password they sign in with. */
  create: protectedProcedure
    .input(z.object({
      email: z.string().trim().email().max(320),
      /* The floor a shopper's own password is held to: an administrator cannot set a weaker one for somebody else. */
      password: z.string().min(MIN_PASSWORD_LENGTH).max(200).refine(value => checkPassword(value).acceptable, "auth.passwordTooWeak"),
      name: z.string().trim().max(255).nullish(),
      roleId: roleChoice,
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => createTeamMember(actor, input));
    }),

  setRole: protectedProcedure
    .input(z.object({ userId: rowId, roleId: roleChoice }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      await guard(() => setTeamRole(actor, input.userId, input.roleId));
      return { ok: true } as const;
    }),

  remove: protectedProcedure
    .input(z.object({ userId: rowId }))
    .mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      await guard(() => removeFromTeam(actor, input.userId));
      return { ok: true } as const;
    }),

  roles: router({
    create: protectedProcedure.input(roleInput).mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => createTeamRole(actor, input));
    }),
    update: protectedProcedure.input(roleInput.extend({ id: rowId })).mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      const { id, ...role } = input;
      await guard(() => updateTeamRole(actor, id, role));
      return { ok: true } as const;
    }),
    delete: protectedProcedure.input(z.object({ id: rowId })).mutation(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      await guard(() => deleteTeamRole(actor, input.id));
      return { ok: true } as const;
    }),
  }),
});
