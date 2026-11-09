/**
 * Authorised devices for NetLet Admin (`Shared/auth/adminDevice.ts`,
 * `services/adminDevices.ts`), on the owner's word: "let me choose the
 * authorised devices and later on … revoke access … under my control, to
 * check who is signed in and when".
 *
 * Two halves. **This device**: where it stands, asking, and — for the owner
 * alone — authorising it with a code emailed to the owner's address, which is
 * how the owner's first device gets in. **The owner's desk**: every device
 * waiting or authorised, the sign-ins to the admin side, and approving,
 * turning down, removing and naming them — `platform.devices`, which only the
 * owner holds, and only on a device already authorised, since an account on
 * any other device is a shopper for that request.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { DEVICE_COOKIE, DEVICE_HEADER, DEVICE_NAME_MAX } from "../../../Shared/auth/adminDevice.js";
import { isCodeShaped, normaliseCode } from "../../../Shared/auth/emailCode.js";
import { can } from "../../../Shared/inventory/permissions.js";
import { getSessionCookieOptions } from "../core/cookies.js";
import { issueLocalCode, takeLocalCode } from "../core/localCodes.js";
import { isOwnerEmail } from "../core/owner.js";
import { rowId } from "../core/schemas.js";
import { isSupabaseAuthConfigured, sendSupabaseSignInCode, SupabaseMailLimited, verifySupabaseSignupCode } from "../core/supabaseAuth.js";
import { protectedProcedure, publicProcedure, router } from "../core/trpc.js";
import {
  DEVICE_COOKIE_MS,
  DeviceError,
  accessFor,
  adminSide,
  approveOwnDevice,
  decideDevice,
  deviceById,
  deviceDesk,
  deviceRuleOn,
  deviceTokenOf,
  devicesWaiting,
  knownDevice,
  renameDevice,
  requestDevice,
  tellOwnerOfDevice,
} from "../services/adminDevices.js";
import { recordAudit } from "../services/audit.js";
import { resolveActor } from "../services/inventory.js";
import { checkAuthAllowed, recordAuthAttempt, type Caller } from "../services/rateLimit.js";

const notForYou = new TRPCError({ code: "FORBIDDEN", message: "devices.notAdmin" });
const unavailable = new TRPCError({ code: "PRECONDITION_FAILED", message: "devices.unavailable" });

type DeviceRequest = Parameters<typeof deviceTokenOf>[0] & Parameters<typeof getSessionCookieOptions>[0];

/** Keeps a browser's device secret where only that browser's admin portal can read it. */
function keepSecret(ctx: { req: DeviceRequest; res: { cookie: (name: string, value: string, options: object) => void } }, token: string): void {
  /* The app keeps its own in the Keychain and sends it in a header. */
  if (ctx.req.headers?.[DEVICE_HEADER]) return;
  ctx.res.cookie(DEVICE_COOKIE, token, { ...getSessionCookieOptions(ctx.req), maxAge: DEVICE_COOKIE_MS });
}

async function assertNotThrottled(caller: Caller, kind: "codeSend" | "codeMiss"): Promise<void> {
  const verdict = await checkAuthAllowed(caller, kind);
  if (!verdict.allowed) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "auth.tooManyAttempts", cause: { retryAfterSeconds: verdict.retryAfterSeconds } });
  }
}

/** The owner's desk: the owner, on an authorised device. */
async function deskActor(ctx: { user: Parameters<typeof resolveActor>[0] }) {
  const actor = await resolveActor(ctx.user);
  if (!can(actor, "platform.devices")) throw new TRPCError({ code: "FORBIDDEN", message: "devices.ownerOnly" });
  return actor;
}

export const devicesRouter = router({
  /**
   * Where this device stands. Signed out, only whether it is a device the
   * owner authorised for some account — so the admin portal opens on its
   * sign-in for a known device and on "not authorised" for any other.
   */
  access: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) {
      return { signedIn: false as const, rule: deviceRuleOn(), known: deviceRuleOn() ? await knownDevice(deviceTokenOf(ctx.req)) : true };
    }
    return { signedIn: true as const, rule: deviceRuleOn(), ...(await accessFor(ctx.user, ctx.req)) };
  }),

  /**
   * This device asks to carry this account's rights — normally done by the
   * sign-in itself on the admin portal or in the app; this is for a session
   * that started some other way. The owner is told of a new one.
   */
  request: protectedProcedure.mutation(async ({ ctx }) => {
    if (!deviceRuleOn()) return { access: "trusted" as const };
    if (!(await adminSide(ctx.user))) throw notForYou;
    try {
      const { token, created, row } = await requestDevice(ctx.user, ctx.req);
      keepSecret(ctx, token);
      if (created) {
        await tellOwnerOfDevice(ctx.user, row);
        await recordAudit(
          { id: ctx.user.id, email: ctx.user.email, role: ctx.user.adminDevice?.lockedRole ?? ctx.user.role },
          { action: "device.request", subjectType: "device", subjectId: row.id, subjectLabel: `${ctx.user.email ?? ctx.user.id} · ${row.name ?? ""}`, after: { address: ctx.req.ip ?? null, device: row.name } },
        );
      }
      return { access: row.status === "approved" ? ("trusted" as const) : row.status };
    } catch (error) {
      if (error instanceof DeviceError) throw unavailable;
      throw error;
    }
  }),

  /**
   * The owner's own device, by a code emailed to the owner's address: only
   * the owner, and only for a device that has asked and is still waiting.
   * Sent by Supabase's sign-in mail ("Magic Link", which prints the code), or
   * written to the server log where no mail service is configured.
   */
  codeStart: protectedProcedure.mutation(async ({ ctx }) => {
    const email = ctx.user.email;
    if (!deviceRuleOn() || !email || !isOwnerEmail(email)) throw notForYou;
    const access = await accessFor(ctx.user, ctx.req);
    if (access.access === "closed") throw unavailable;
    if (access.access !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "devices.notWaiting" });
    const caller: Caller = { email, address: ctx.req.ip ?? null };
    await assertNotThrottled(caller, "codeSend");
    await recordAuthAttempt(caller, "codeSend");
    try {
      if (isSupabaseAuthConfigured()) await sendSupabaseSignInCode(email);
      else issueLocalCode(email, "admin-device");
    } catch (error) {
      if (error instanceof SupabaseMailLimited) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "auth.codeNotSent" });
      console.error(`[devices] a device code could not be sent: ${error instanceof Error ? error.message : String(error)}`);
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "auth.codeUnreachable" });
    }
    return { sent: true as const, email };
  }),

  codeVerify: protectedProcedure
    .input(z.object({ code: z.string().trim().min(1).max(20) }))
    .mutation(async ({ ctx, input }) => {
      const email = ctx.user.email;
      if (!deviceRuleOn() || !email || !isOwnerEmail(email)) throw notForYou;
      const caller: Caller = { email, address: ctx.req.ip ?? null };
      await assertNotThrottled(caller, "codeMiss");
      const code = normaliseCode(input.code);
      if (!isCodeShaped(code)) {
        await recordAuthAttempt(caller, "codeMiss");
        throw new TRPCError({ code: "BAD_REQUEST", message: "auth.codeShape" });
      }
      let proven = false;
      if (isSupabaseAuthConfigured()) {
        let answer;
        try {
          answer = await verifySupabaseSignupCode(email, code);
        } catch (error) {
          console.error(`[devices] a device code could not be checked: ${error instanceof Error ? error.message : String(error)}`);
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "auth.codeUnreachable" });
        }
        /* The inbox is the owner's, and the account Supabase answers for is this one. */
        proven = Boolean(answer && answer.email?.toLowerCase() === email.toLowerCase() && (!ctx.user.supabaseUid || answer.uid === ctx.user.supabaseUid));
      } else {
        proven = takeLocalCode(email, code, "admin-device");
      }
      if (!proven) {
        await recordAuthAttempt(caller, "codeMiss");
        throw new TRPCError({ code: "UNAUTHORIZED", message: "auth.codeWrong" });
      }
      const row = await approveOwnDevice(ctx.user.id, deviceTokenOf(ctx.req));
      if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: "devices.notWaiting" });
      await recordAudit(
        { id: ctx.user.id, email, role: "admin" },
        { action: "device.approve", subjectType: "device", subjectId: row.id, subjectLabel: `${email} · ${row.name ?? ""}`, after: { how: "email-code", device: row.name, address: ctx.req.ip ?? null } },
      );
      return { access: "trusted" as const };
    }),

  /** The owner's desk: every device and the recent sign-ins. */
  desk: protectedProcedure.query(async ({ ctx }) => {
    await deskActor(ctx);
    return deviceDesk(deviceTokenOf(ctx.req));
  }),

  /** How many devices wait for the owner, for the overview's tile. */
  waiting: protectedProcedure.query(async ({ ctx }) => {
    await deskActor(ctx);
    return devicesWaiting();
  }),

  /** Approve (or allow again), turn down, or remove one device. */
  decide: protectedProcedure
    .input(z.object({ id: rowId, decision: z.enum(["approve", "deny", "revoke"]) }))
    .mutation(async ({ ctx, input }) => {
      await deskActor(ctx);
      const before = await deviceById(input.id);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "devices.notFound" });
      const row = await decideDevice(ctx.user.id, input.id, input.decision);
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "devices.moved" });
      await recordAudit(
        { id: ctx.user.id, email: ctx.user.email, role: "admin" },
        {
          action: input.decision === "approve" ? "device.approve" : input.decision === "deny" ? "device.deny" : "device.revoke",
          subjectType: "device",
          subjectId: row.id,
          subjectLabel: `${before.account ?? before.userId} · ${row.name ?? ""}`,
          before: { status: before.status },
          after: { status: row.status, ...(input.decision === "approve" ? { how: "owner" } : {}) },
        },
      );
      return { id: row.id, status: row.status };
    }),

  /** The owner's own name for a device. */
  rename: protectedProcedure
    .input(z.object({ id: rowId, name: z.string().max(DEVICE_NAME_MAX * 2) }))
    .mutation(async ({ ctx, input }) => {
      await deskActor(ctx);
      const before = await deviceById(input.id);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "devices.notFound" });
      const row = await renameDevice(input.id, input.name);
      if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: "devices.nameEmpty" });
      await recordAudit(
        { id: ctx.user.id, email: ctx.user.email, role: "admin" },
        { action: "device.rename", subjectType: "device", subjectId: row.id, subjectLabel: `${before.account ?? before.userId} · ${row.name ?? ""}`, before: { name: before.name }, after: { name: row.name } },
      );
      return { id: row.id, name: row.name };
    }),
});

export { keepSecret };
