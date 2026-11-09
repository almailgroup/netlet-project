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
 */

/** What a device row says. `approved` is the one state that carries rights. */
export const DEVICE_STATES = ["pending", "approved", "denied", "revoked"] as const;
export type DeviceState = (typeof DEVICE_STATES)[number];

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
