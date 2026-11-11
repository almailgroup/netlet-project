/**
 * Authorised devices for NetLet Admin: the rules the server, the website and
 * the app all hold, on the owner's word ("only authorised devices get access
 * to the admin panel … let me choose the authorised devices and later revoke
 * access … under my control, to check who is signed in and when").
 *
 * An administrator's rights — and an employee's granted capability — hold
 * only on a device the shop's owner authorised. A device is a browser on the
 * admin portal or an install of the iPhone app, known by a random secret only
 * it keeps (an httpOnly cookie, or the app's Keychain); NetLet keeps the
 * secret's SHA-256 (`admin_devices`). Anywhere else the account is an ordinary
 * shopper, so a password on its own opens nothing.
 *
 * The owner authorises their own new device with a code emailed to their
 * address, which is how the first one gets in; every other device waits for
 * the owner to approve it on the Devices page, which only the owner, on an
 * authorised device, can open.
 *
 * **Taking a device off is two different acts, on the owner's word** ("I
 * can't fully remove a device from the devices list. I should be able to
 * decide to remove a device … and decide whether they can be logged in and
 * added again or blocked forever"). **Removing** forgets the device: its row
 * goes, it loses its rights at once, and if its user signs in there again it
 * asks afresh like any new device. **Blocking** keeps the row so the device
 * is known and refused: it loses its rights at once and can never ask again,
 * until the owner unblocks it (which is removing the block's row) or
 * authorises it outright. Before this a device taken off stayed on the list
 * for ever and could only be "allowed again".
 *
 * **No new state and no migration**: a blocked device is one of the two
 * states the table already had — `denied` for one blocked while it waited,
 * `revoked` for one blocked after it was authorised, which is also what tells
 * the owner whether it ever had access — and a removed one is no row at all.
 *
 * **A block is on what the device remembers**, its secret. A browser whose
 * site data is cleared, or an app deleted and installed again, comes back as
 * a device NetLet has never seen and may ask. It cannot get in without the
 * owner's yes, and the request says when its account or its address already
 * has a blocked device (`DeviceWarning`); somebody to be kept out altogether
 * has their administrator role taken away on People.
 */

/** What a device row says. `approved` is the one state that carries rights. */
export const DEVICE_STATES = ["pending", "approved", "denied", "revoked"] as const;
export type DeviceState = (typeof DEVICE_STATES)[number];

/** Blocked: turned away while it waited (`denied`), or after it was authorised (`revoked`). */
export function isBlocked(state: DeviceState): boolean {
  return state === "denied" || state === "revoked";
}

/**
 * What the owner decides about one device: authorise it, block it, or remove
 * it from the list. `deny` and `revoke` are what blocking was called before
 * there was a choice, and the app's earlier builds still send them.
 */
export const DEVICE_DECISIONS = ["approve", "block", "remove", "deny", "revoke"] as const;
export type DeviceDecision = (typeof DEVICE_DECISIONS)[number];
export type DeviceMove = "approve" | "block" | "remove";

export function moveOf(decision: DeviceDecision): DeviceMove {
  return decision === "deny" || decision === "revoke" ? "block" : decision;
}

/**
 * Where a decision takes a device: its next state, `"removed"` for a row that
 * goes, or null for a move the rule does not offer — authorising one already
 * authorised, blocking one already blocked.
 */
export function deviceMove(state: DeviceState, decision: DeviceDecision): DeviceState | "removed" | null {
  switch (moveOf(decision)) {
    case "approve":
      return state === "approved" ? null : "approved";
    case "block":
      return state === "pending" ? "denied" : state === "approved" ? "revoked" : null;
    case "remove":
      return "removed";
  }
}

/** The states a decision may be taken from, for the write's own predicate. */
export function statesFor(decision: DeviceDecision): DeviceState[] {
  return DEVICE_STATES.filter(state => deviceMove(state, decision) !== null);
}

/**
 * What the trail calls a decision, from the state it found: taking a blocked
 * device off the list is unblocking it; taking one that waits off is
 * declining it; anything else removed was authorised.
 */
export function deviceAuditAction(before: DeviceState, decision: DeviceDecision): "device.approve" | "device.block" | "device.remove" | "device.decline" | "device.unblock" {
  const move = moveOf(decision);
  if (move === "approve") return "device.approve";
  if (move === "block") return "device.block";
  return isBlocked(before) ? "device.unblock" : before === "pending" ? "device.decline" : "device.remove";
}

/** A device seen this recently is in use now. */
export const DEVICE_ACTIVE_MS = 5 * 60 * 1000;

export function deviceActive(lastSeenAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!lastSeenAt) return false;
  const seen = new Date(lastSeenAt).getTime();
  return Number.isFinite(seen) && now.getTime() - seen < DEVICE_ACTIVE_MS;
}

/**
 * Why the owner should look twice at a device that is asking: its account
 * already has a blocked device, or it asks from the address a blocked device
 * used — either can be the blocked device back with its memory wiped.
 */
export type DeviceWarning = "accountBlocked" | "addressBlocked";

/** How many blocked devices the desk lists. */
export const BLOCKED_DEVICES_SHOWN = 200;

/** The cookie a browser on the admin portal keeps its device secret in. */
export const DEVICE_COOKIE = "netlet_admin_device";

/** The header the iPhone app sends its device secret in. */
export const DEVICE_HEADER = "x-netlet-device";

/** A device secret: 32 random bytes in base64url (43 characters), or longer. */
export const DEVICE_TOKEN = /^[A-Za-z0-9_-]{43,128}$/;

/** A device's shown name, cut to the column. */
export const DEVICE_NAME_MAX = 80;

/** How often a device's "last active" is written: at most once a minute. */
export const DEVICE_SEEN_EVERY_MS = 60 * 1000;

/** How a device came to be authorised. */
export type ApprovedHow = "owner" | "email-code";

/**
 * Where this device stands, for the page that asks: `trusted` carries the
 * rights; `none` is a device that has not asked yet; `closed` is the table
 * not there yet (before migration 0079 is pasted), when nothing is authorised.
 */
export type DeviceAccess = "trusted" | "pending" | "denied" | "revoked" | "none" | "closed";

export function isDeviceToken(value: unknown): value is string {
  return typeof value === "string" && DEVICE_TOKEN.test(value);
}

/** The shown name for a device: trimmed, never empty, cut to the column. */
export function deviceLabel(name: string | null | undefined): string | null {
  const trimmed = (name ?? "").replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, DEVICE_NAME_MAX) : null;
}

/**
 * A device's name from what it says it is: the browser and the system from a
 * browser's user agent ("Chrome on Windows"), or the app and the phone from
 * the app's ("NetLet app on iPhone"). Only ever a label for the owner to tell
 * two devices apart — nothing is decided by it, since any of it can be faked.
 */
export function deviceNameFrom(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const system = /iPad/.test(ua)
    ? "iPad"
    : /iPhone|iPod/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  if (/^NetLet\//.test(ua) || /\bNetLetApp\b/.test(ua)) return `NetLet app on ${system ?? "iPhone"}`;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS/.test(ua)
        ? "Firefox"
        : /SamsungBrowser/.test(ua)
          ? "Samsung Internet"
          : /Chrome\/|CriOS/.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "Unknown device";
}
