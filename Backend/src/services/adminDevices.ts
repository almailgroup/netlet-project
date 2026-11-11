/**
 * Authorised devices for NetLet Admin, the database half
 * (`Shared/auth/adminDevice.ts` is the rule).
 *
 * **Every request decides it again.** `authenticateRequest` asks `gateAdminRights`
 * for any administrator, and an administrator on a device the owner has not
 * authorised is that request's ordinary shopper — `role` read as `user`, so
 * every check that reads the role (`adminProcedure`, `resolveActor`, the error
 * formatter, an invoice) answers as it does for a shopper, without each of
 * them having to know devices exist. An employee holding a grant is held back
 * the same way, by `resolveActor`, which is where grants are read.
 *
 * **It fails closed.** No secret, a secret NetLet does not hold, a row still
 * waiting, turned down or revoked, the table not there yet (before 0079 is
 * pasted) and a read that failed are all "not authorised". Only `ADMIN_DEVICES=off`
 * in the deployment's settings — somebody with the Vercel project — turns the
 * rule off, for the day the owner is locked out; and with no `OWNER_EMAIL`
 * there is nobody to approve anything, so there is no rule either.
 */
import { createHash, randomBytes } from "node:crypto";
import { parse as parseCookies } from "cookie";
import { and, asc, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { adminDevices, auditLog, staffGrants, users, type AdminDevice } from "../../database/schema.js";
import {
  BLOCKED_DEVICES_SHOWN,
  DEVICE_COOKIE,
  DEVICE_HEADER,
  DEVICE_SEEN_EVERY_MS,
  deviceLabel,
  deviceMove,
  deviceNameFrom,
  isBlocked,
  isDeviceToken,
  moveOf,
  type ApprovedHow,
  type DeviceAccess,
  type DeviceDecision,
  type DeviceState,
  type DeviceWarning,
} from "../../../Shared/auth/adminDevice.js";
import { isMissingTable, describeError } from "../core/describeError.js";
import { isOwnerEmail, ownerEmail } from "../core/owner.js";
import { getDb } from "./db.js";
import { portalDomain, portalOfHost } from "../../../Shared/portal.js";
import { outer } from "./sqlRefs.js";
import { notifyQuietly } from "./notifications.js";

/**
 * What `authenticateRequest` hands on about the device a request came from:
 * the secret it carried (if any), and for an administrator whether it is
 * authorised. An administrator held back keeps `lockedRole`, so a page can
 * still be told they belong on the admin portal — which is where the device
 * is authorised.
 */
export type AdminDeviceClaim = { token: string | null; trusted?: boolean; lockedRole?: "admin" };

type RequestLike = {
  headers?: Record<string, string | string[] | undefined> & { cookie?: string };
  ip?: string;
  hostname?: string;
};

/**
 * A web browser on the shop's own address, where NetLet's administrators
 * never sign in, on the owner's word ("it should not let you sign in from the
 * website itself at all … only in admin.netlet.net"). A browser is told by
 * its user agent, which every one starts "Mozilla/"; the iPhone app calls the
 * shop's address too and is not one. Not a security boundary — a header can
 * say anything — since what keeps an administrator's rights to their own
 * devices is the device rule; this decides only which address turns an
 * administrator away.
 */
export function browserOnShop(req: RequestLike): boolean {
  const agent = req.headers?.["user-agent"];
  const value = Array.isArray(agent) ? agent[0] : agent;
  if (typeof value !== "string" || !/^Mozilla\//.test(value)) return false;
  const hostHeader = req.headers?.host;
  const host = (req.hostname ?? (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader) ?? "").replace(/:\d+$/, "").toLowerCase();
  return portalOfHost(host, portalDomain(process.env.PORTAL_DOMAIN)) === null;
}

export function deviceRuleOn(): boolean {
  return (process.env.ADMIN_DEVICES ?? "").trim().toLowerCase() !== "off" && ownerEmail() !== "";
}

/** The device secret a request carries: the portal's cookie, or the app's header. */
export function deviceTokenOf(req: RequestLike): string | null {
  const cookie = parseCookies(req.headers?.cookie ?? "")[DEVICE_COOKIE];
  if (isDeviceToken(cookie)) return cookie;
  const header = req.headers?.[DEVICE_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return isDeviceToken(value) ? value : null;
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf-8").digest("hex");
}

export function newDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

function userAgentOf(req: RequestLike): string {
  const ua = req.headers?.["user-agent"];
  return (Array.isArray(ua) ? ua[0] : ua) ?? "";
}

/** How long the device cookie lasts: Chrome holds a cookie at most 400 days. */
export const DEVICE_COOKIE_MS = 400 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------- reading --- */

/** This account's row for this device, `"missing"` before migration 0079. */
export type DeviceLookup = AdminDevice | null | "missing";

/**
 * The row the gate will ask about, started beside the account's own read
 * (`authenticateRequest`), so an administrator's request pays one round trip
 * to the database before its procedure rather than two. An error is kept in
 * the promise for `deviceTrusted` to fail closed on, never thrown early.
 */
export function startDeviceLookup(userId: number, req: RequestLike): Promise<DeviceLookup> | undefined {
  if (!deviceRuleOn()) return undefined;
  const token = deviceTokenOf(req);
  if (!token) return undefined;
  const lookup = rowFor(userId, token);
  lookup.catch(() => undefined);
  return lookup;
}

async function rowFor(userId: number, token: string | null): Promise<DeviceLookup> {
  if (!token) return null;
  const db = await getDb();
  if (!db) return "missing";
  try {
    const [row] = await db
      .select()
      .from(adminDevices)
      .where(and(eq(adminDevices.userId, userId), eq(adminDevices.tokenHash, hashDeviceToken(token))))
      .limit(1);
    return row ?? null;
  } catch (error) {
    if (isMissingTable(error)) return "missing";
    throw error;
  }
}

/**
 * Whether this device may carry this account's administrator rights, writing
 * "last active" at most once a minute. Fails closed: anything but an
 * approved row is no.
 */
export async function deviceTrusted(userId: number, token: string | null, address: string | null, lookup?: Promise<DeviceLookup>): Promise<boolean> {
  try {
    const row = await (lookup ?? rowFor(userId, token));
    if (!row || row === "missing" || row.status !== "approved") return false;
    const now = Date.now();
    if (!row.lastSeenAt || now - row.lastSeenAt.getTime() >= DEVICE_SEEN_EVERY_MS) {
      /* Not waited for: "last active" is a note about the request, and the
         request should not pay a round trip to the database for it. The
         function is kept awake until its connections are idle
         (`connectionRelease.ts`), so the write still lands. */
      void getDb()
        .then(db => db
          ?.update(adminDevices)
          .set({ lastSeenAt: new Date(now), lastIp: address ?? row.lastIp })
          .where(and(eq(adminDevices.id, row.id), or(isNull(adminDevices.lastSeenAt), lt(adminDevices.lastSeenAt, new Date(now - DEVICE_SEEN_EVERY_MS))))))
        .catch(error => console.error(`[devices] could not note device ${row.id} as seen: ${describeError(error)}`));
    }
    return true;
  } catch (error) {
    console.error(`[devices] could not check a device for account ${userId}: ${describeError(error)}`);
    return false;
  }
}

/**
 * The user `authenticateRequest` hands the request: as it is, while the rule
 * is off or the account is not an administrator; an administrator on an
 * authorised device as they are, marked trusted; and one on any other device
 * read as a shopper (`role: "user"`), keeping `lockedRole` so the portal can
 * say what to do about it. Every user carries the device's secret, so a
 * granted employee is checked where grants are read.
 */
export async function gateAdminRights<U extends { id: number; role: string }>(user: U, req: RequestLike, lookup?: Promise<DeviceLookup>): Promise<U & { adminDevice?: AdminDeviceClaim }> {
  if (!deviceRuleOn()) return user;
  const token = deviceTokenOf(req);
  if (user.role !== "admin") return { ...user, adminDevice: { token } };
  if (await deviceTrusted(user.id, token, req.ip ?? null, lookup)) return { ...user, adminDevice: { token, trusted: true } };
  return { ...user, role: "user", adminDevice: { token, trusted: false, lockedRole: "admin" } };
}

/** Whether this account's grants hold on this request's device (`resolveActor`). */
export async function grantsHold(user: { id: number; adminDevice?: AdminDeviceClaim }): Promise<boolean> {
  /* A user that did not come from a request — a sign-in deciding which
     portal somebody belongs on, a background job — carries no claim. */
  if (!user.adminDevice) return true;
  if (user.adminDevice.trusted) return true;
  return deviceTrusted(user.id, user.adminDevice.token, null);
}

/* ------------------------------------------------------- this device --- */

export type DeviceAccessAnswer = {
  /** Whether the rule applies to this account: an administrator, or a granted employee. */
  applies: boolean;
  access: DeviceAccess;
  /** The owner may authorise their own device by an emailed code. */
  owner: boolean;
  deviceName: string | null;
  /** When this device asked, for the waiting screen. */
  requestedAt: Date | null;
};

/** Whether an account is one the rule is about: an administrator, or an employee holding a grant. */
export async function adminSide(user: { id: number; role: string; adminDevice?: AdminDeviceClaim }): Promise<boolean> {
  if (user.role === "admin" || user.adminDevice?.lockedRole === "admin") return true;
  const db = await getDb();
  if (!db) return false;
  const [granted] = await db.select({ userId: staffGrants.userId }).from(staffGrants).where(eq(staffGrants.userId, user.id)).limit(1);
  return Boolean(granted);
}

/** Where this request's device stands for this account. */
export async function accessFor(
  user: { id: number; email: string | null; role: string; adminDevice?: AdminDeviceClaim },
  req: RequestLike,
): Promise<DeviceAccessAnswer> {
  const owner = isOwnerEmail(user.email);
  if (!deviceRuleOn()) return { applies: false, access: "trusted", owner, deviceName: null, requestedAt: null };
  /* The request's own gate already read this device and found it authorised:
     nothing to ask the database again. */
  if (user.role === "admin" && user.adminDevice?.trusted) return { applies: true, access: "trusted", owner, deviceName: null, requestedAt: null };
  const applies = await adminSide(user);
  if (!applies) return { applies: false, access: "none", owner, deviceName: null, requestedAt: null };
  const row = await rowFor(user.id, deviceTokenOf(req));
  if (row === "missing") return { applies, access: "closed", owner, deviceName: null, requestedAt: null };
  if (!row) return { applies, access: "none", owner, deviceName: deviceNameFrom(userAgentOf(req)), requestedAt: null };
  const access: DeviceAccess = row.status === "approved" ? "trusted" : (row.status as Exclude<DeviceState, "approved">);
  return { applies, access, owner, deviceName: row.name, requestedAt: row.createdAt };
}

export class DeviceError extends Error {}

/**
 * This device asks to carry this account's rights: a waiting row, made once
 * per account and device. A device the owner blocked cannot ask again — its
 * row is still there, so nothing is made and nobody is told — which is what
 * stops a stolen password knocking for ever; one the owner removed from the
 * list has no row, so it asks afresh. Answers the secret to keep (new, or
 * the one the device already had) and whether a new row was made.
 */
export async function requestDevice(
  user: { id: number },
  req: RequestLike,
): Promise<{ token: string; created: boolean; row: AdminDevice }> {
  const db = await getDb();
  if (!db) throw new DeviceError("devices.unavailable");
  const token = deviceTokenOf(req) ?? newDeviceToken();
  const tokenHash = hashDeviceToken(token);
  try {
    const [made] = await db
      .insert(adminDevices)
      .values({ userId: user.id, tokenHash, name: deviceNameFrom(userAgentOf(req)), status: "pending", requestedIp: req.ip ?? null, lastIp: req.ip ?? null })
      .onConflictDoNothing()
      .returning();
    if (made) return { token, created: true, row: made };
    const [existing] = await db
      .select()
      .from(adminDevices)
      .where(and(eq(adminDevices.userId, user.id), eq(adminDevices.tokenHash, tokenHash)))
      .limit(1);
    if (!existing) throw new DeviceError("devices.unavailable");
    return { token, created: false, row: existing };
  } catch (error) {
    if (isMissingTable(error)) throw new DeviceError("devices.unavailable");
    throw error;
  }
}

/** A sign-in on a device: when it last signed in, for the owner's list. */
export async function noteDeviceSignIn(userId: number, token: string | null, address: string | null): Promise<void> {
  if (!token) return;
  try {
    const db = await getDb();
    await db
      ?.update(adminDevices)
      .set({ lastSignInAt: new Date(), lastIp: address })
      .where(and(eq(adminDevices.userId, userId), eq(adminDevices.tokenHash, hashDeviceToken(token))));
  } catch (error) {
    if (!isMissingTable(error)) console.error(`[devices] could not note a sign-in: ${describeError(error)}`);
  }
}

/**
 * The owner's own device, authorised by the code emailed to them: only a
 * device that has asked and is still waiting, and only the owner's own row.
 */
export async function approveOwnDevice(userId: number, token: string | null): Promise<AdminDevice | null> {
  if (!token) return null;
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .update(adminDevices)
    .set({ status: "approved", approvedBy: userId, approvedHow: "email-code" satisfies ApprovedHow, decidedAt: new Date() })
    .where(and(eq(adminDevices.userId, userId), eq(adminDevices.tokenHash, hashDeviceToken(token)), eq(adminDevices.status, "pending")))
    .returning();
  return row ?? null;
}

/* ---------------------------------------------------- the owner's desk --- */

export type DeviceSummary = {
  id: number;
  userId: number;
  account: string | null;
  accountName: string | null;
  owner: boolean;
  name: string | null;
  status: DeviceState;
  requestedIp: string | null;
  approvedHow: string | null;
  approvedBy: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  lastSignInAt: Date | null;
  lastSeenAt: Date | null;
  lastIp: string | null;
  /** The device this page is being read on. */
  current: boolean;
  /** Why to look twice at one that is asking (`DeviceWarning`); empty for any other. */
  warnings: DeviceWarning[];
};

export type SignInEntry = {
  id: number;
  at: Date;
  account: string | null;
  address: string | null;
  device: string | null;
  /** Whether the device it came from could carry the rights at the time. */
  outcome: "authorised" | "waiting" | "refused" | "unknown";
};

/** How many sign-ins the desk shows. */
export const DEVICE_HISTORY = 30;

export type DeviceDesk = {
  ready: boolean;
  devices: DeviceSummary[];
  signIns: SignInEntry[];
  /** How many devices are blocked in all, where the list shows only the newest. */
  blockedTotal: number;
};

const millis = (value: Date | null): number => (value ? value.getTime() : 0);

/**
 * Everything on the Devices page: every device waiting (oldest first, the
 * order to answer them in), every one authorised (the one being read on
 * first, then the most recently used), every one blocked (the newest block
 * first), and the recent sign-ins to the admin side from the audit trail.
 * A device that asks is marked when its account or its address already has a
 * blocked device. `ready` false before 0079.
 */
export async function deviceDesk(currentToken: string | null, ownerId?: number): Promise<DeviceDesk> {
  const db = await getDb();
  if (!db) return { ready: false, devices: [], signIns: [], blockedTotal: 0 };
  try {
    const approver = sql<string | null>`(select approver.email from users as approver where approver.id = ${outer(adminDevices.approvedBy)})`;
    const rows = await db
      .select({
        device: adminDevices,
        account: users.email,
        accountName: users.name,
        approvedBy: approver,
      })
      .from(adminDevices)
      .innerJoin(users, eq(users.id, adminDevices.userId))
      .orderBy(desc(adminDevices.createdAt), desc(adminDevices.id));
    const currentHash = currentToken ? hashDeviceToken(currentToken) : null;
    /* The device being read on is this browser's row for the owner's own
       account: a browser can hold another administrator's device too. */
    const isCurrent = (device: AdminDevice) => currentHash !== null && device.tokenHash === currentHash && (ownerId === undefined || device.userId === ownerId);
    const waiting = rows.filter(row => row.device.status === "pending").sort((left, right) => millis(left.device.createdAt) - millis(right.device.createdAt) || left.device.id - right.device.id);
    const authorised = rows
      .filter(row => row.device.status === "approved")
      .sort((left, right) => Number(isCurrent(right.device)) - Number(isCurrent(left.device)) || millis(right.device.lastSeenAt) - millis(left.device.lastSeenAt) || right.device.id - left.device.id);
    const everyBlocked = rows
      .filter(row => isBlocked(row.device.status as DeviceState))
      .sort((left, right) => millis(right.device.decidedAt) - millis(left.device.decidedAt) || right.device.id - left.device.id);
    const blockedAccounts = new Set(everyBlocked.map(row => row.device.userId));
    const blockedAddresses = new Set(everyBlocked.flatMap(row => [row.device.requestedIp, row.device.lastIp]).filter((address): address is string => Boolean(address)));
    const warningsFor = (device: AdminDevice): DeviceWarning[] =>
      device.status !== "pending"
        ? []
        : [
            ...(blockedAccounts.has(device.userId) ? (["accountBlocked"] as const) : []),
            ...(device.requestedIp && blockedAddresses.has(device.requestedIp) ? (["addressBlocked"] as const) : []),
          ];
    const devices = [...waiting, ...authorised, ...everyBlocked.slice(0, BLOCKED_DEVICES_SHOWN)].map(({ device, account, accountName, approvedBy }) => ({
      id: device.id,
      userId: device.userId,
      account,
      accountName,
      owner: isOwnerEmail(account),
      name: device.name,
      status: device.status as DeviceState,
      requestedIp: device.requestedIp,
      approvedHow: device.approvedHow,
      approvedBy,
      createdAt: device.createdAt,
      decidedAt: device.decidedAt,
      lastSignInAt: device.lastSignInAt,
      lastSeenAt: device.lastSeenAt,
      lastIp: device.lastIp,
      current: isCurrent(device),
      warnings: warningsFor(device),
    }));
    const audit = await db
      .select({ id: auditLog.id, at: auditLog.createdAt, account: auditLog.actorEmail, after: auditLog.after })
      .from(auditLog)
      .where(eq(auditLog.action, "admin.signIn"))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(DEVICE_HISTORY);
    const signIns = audit.map(entry => {
      const after = (entry.after ?? {}) as { address?: string | null; device?: string | null; deviceAccess?: string };
      const outcome: SignInEntry["outcome"] =
        after.deviceAccess === "trusted" ? "authorised" : after.deviceAccess === "pending" || after.deviceAccess === "none" ? "waiting" : after.deviceAccess ? "refused" : "unknown";
      return { id: entry.id, at: entry.at, account: entry.account, address: after.address ?? null, device: after.device ?? null, outcome };
    });
    return { ready: true, devices, signIns, blockedTotal: everyBlocked.length };
  } catch (error) {
    if (isMissingTable(error)) return { ready: false, devices: [], signIns: [], blockedTotal: 0 };
    throw error;
  }
}

/** How many devices wait for the owner, for the overview's tile. */
export async function devicesWaiting(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(adminDevices).where(eq(adminDevices.status, "pending"));
    return row?.n ?? 0;
  } catch (error) {
    if (isMissingTable(error)) return 0;
    throw error;
  }
}

/** What became of a device the owner decided about: its row as it is now, or as it was when it was removed. */
export type DeviceDecided = { row: AdminDevice; status: DeviceState | "removed" };

/**
 * The owner's decision on one device, from the row as it was just read
 * (`deviceMove` is the rule): authorising one that waits or is blocked,
 * blocking one that waits or is authorised, or removing one from the list
 * whatever it is, which deletes its row so the device is forgotten and may
 * ask again. `"current"` for blocking the device the owner is deciding on —
 * removing it is offered instead, since a block there can only be undone
 * from another device. Each write names the state it found in its predicate,
 * so two presses cannot both land; null when somebody else got there first
 * or the rule does not offer the move.
 */
export async function decideDevice(
  ownerId: number,
  before: AdminDevice,
  decision: DeviceDecision,
  currentToken: string | null,
): Promise<DeviceDecided | "current" | null> {
  const db = await getDb();
  if (!db) return null;
  const found = before.status as DeviceState;
  const to = deviceMove(found, decision);
  if (!to) return null;
  const unchanged = and(eq(adminDevices.id, before.id), eq(adminDevices.status, found));
  if (to === "removed") {
    const [gone] = await db.delete(adminDevices).where(unchanged).returning();
    return gone ? { row: gone, status: "removed" } : null;
  }
  if (moveOf(decision) === "block" && currentToken && before.userId === ownerId && before.tokenHash === hashDeviceToken(currentToken)) return "current";
  const [row] = await db
    .update(adminDevices)
    .set({
      status: to,
      decidedAt: new Date(),
      ...(to === "approved" ? { approvedBy: ownerId, approvedHow: "owner" satisfies ApprovedHow } : {}),
    })
    .where(unchanged)
    .returning();
  return row ? { row, status: to } : null;
}

/**
 * Every authorised device but the one the owner is on, removed from the list
 * in one go — for the day a password may have leaked. Each loses its rights
 * at once and asks afresh at its next sign-in; devices that wait and devices
 * that are blocked are left as they are. Refused (null) with no device to
 * keep, which would take the owner's own off too.
 */
export async function removeOtherDevices(ownerId: number, currentToken: string | null): Promise<(AdminDevice & { account: string | null })[] | null> {
  if (!currentToken) return null;
  const db = await getDb();
  if (!db) return null;
  const currentHash = hashDeviceToken(currentToken);
  const [kept] = await db
    .select({ id: adminDevices.id })
    .from(adminDevices)
    .where(and(eq(adminDevices.userId, ownerId), eq(adminDevices.tokenHash, currentHash), eq(adminDevices.status, "approved")))
    .limit(1);
  if (!kept) return null;
  const gone = await db
    .delete(adminDevices)
    .where(and(eq(adminDevices.status, "approved"), ne(adminDevices.id, kept.id)))
    .returning();
  if (!gone.length) return [];
  const accounts = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, [...new Set(gone.map(row => row.userId))]));
  const emailOf = new Map(accounts.map(account => [account.id, account.email]));
  return gone.map(row => ({ ...row, account: emailOf.get(row.userId) ?? null }));
}

/** The owner's own name for a device ("Office PC"). */
export async function renameDevice(id: number, name: string): Promise<AdminDevice | null> {
  const label = deviceLabel(name);
  if (!label) return null;
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.update(adminDevices).set({ name: label }).where(eq(adminDevices.id, id)).returning();
  return row ?? null;
}

/** One device, for the trail's label. */
export async function deviceById(id: number): Promise<(AdminDevice & { account: string | null }) | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ device: adminDevices, account: users.email })
    .from(adminDevices)
    .innerJoin(users, eq(users.id, adminDevices.userId))
    .where(eq(adminDevices.id, id))
    .limit(1);
  return row ? { ...row.device, account: row.account } : null;
}

/** The owner's account id, for the notice a new device sends. */
export async function ownerAccountId(): Promise<number | null> {
  const email = ownerEmail();
  if (!email) return null;
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).orderBy(asc(users.id)).limit(1);
  return row?.id ?? null;
}

/**
 * Whether a signed-out browser carries the secret of a device authorised for
 * any account — so the admin portal can open on its sign-in, rather than on
 * "this device is not authorised". Says nothing about which account.
 */
export async function knownDevice(token: string | null): Promise<boolean> {
  if (!token) return false;
  const db = await getDb();
  if (!db) return false;
  try {
    const [row] = await db
      .select({ id: adminDevices.id })
      .from(adminDevices)
      .where(and(eq(adminDevices.tokenHash, hashDeviceToken(token)), eq(adminDevices.status, "approved")))
      .limit(1);
    return Boolean(row);
  } catch (error) {
    if (isMissingTable(error)) return false;
    throw error;
  }
}

/**
 * Tells the owner a device asked for an account's administrator rights —
 * their own account included, since a device the owner does not recognise
 * asking for the owner's account is somebody holding the owner's password.
 * Once per device. Never throws into the sign-in it follows.
 */
export async function tellOwnerOfDevice(user: { id: number; email: string | null; name?: string | null }, row: AdminDevice): Promise<void> {
  try {
    const ownerId = await ownerAccountId();
    if (!ownerId) return;
    await notifyQuietly({
      userId: ownerId,
      kind: "staff_device_request",
      params: { account: user.email ?? user.name ?? String(user.id), device: row.name ?? "" },
      link: "/admin/devices",
      dedupe: `device:${row.id}`,
    });
  } catch (error) {
    console.error(`[devices] could not tell the owner of device ${row.id}: ${describeError(error)}`);
  }
}
