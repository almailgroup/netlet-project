/**
 * The portal's own addresses: `admin.<domain>` for NetLet's staff and
 * `vendor.<domain>` for the stores and the delivery companies, on the owner's
 * word. Pure, so the browser, the server's emails and the tests read one rule.
 *
 * The app keeps its one route table, where every portal page lives under
 * `/admin`; on a portal address the address bar simply leaves that prefix off
 * (`admin.netlet.net/orders` is `/admin/orders` inside the app).
 *
 * **The shop has no `/admin` of its own, on the owner's word** ("remove this
 * url … it should only be admin.netlet.net, and for vendor, vendor.netlet.net"):
 * the portal is drawn only on its two addresses. `PORTAL_DOMAIN` names the
 * domain they hang from; unset, it is the shop's own address less `www.`
 * (`domainOfShopHost`), so the live shop's links reach `admin.netlet.net`
 * whether or not a build carried the setting, and a laptop's reach
 * `admin.localhost`.
 */
import type { Actor } from "./inventory/permissions.js";

export type PortalSide = "admin" | "vendor";

/**
 * Paths a portal address keeps as they are rather than reading them as the
 * portal's own: the sign-in page (each address keeps its own sign-in), the
 * pages a sign-in form links to, and an invoice, which the portal opens and
 * which reads the session of the address it is on.
 */
const KEPT = [/^\/signin$/, /^\/invoices\//, /^\/terms$/, /^\/privacy$/, /^\/seller-agreement$/];

const split = (address: string): [string, string] => {
  const at = address.search(/[?#]/);
  return at === -1 ? [address || "/", ""] : [address.slice(0, at) || "/", address.slice(at)];
};

const kept = (path: string) => KEPT.some(rule => rule.test(path));

/**
 * The domain the subdomains hang from, from what somebody typed into a
 * setting: `netlet.net`, `https://netlet.net/`, `www.netlet.net` and even a
 * portal's own `admin.netlet.net` all read as `netlet.net`; anything that is
 * not a host name reads as off.
 */
export function portalDomain(raw: string | null | undefined): string | null {
  const host = (raw ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^(www|admin|vendor)\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/**
 * The domain the portals hang from when no setting names it: the shop's own
 * host less `www.` — `netlet.net` on the live shop, `localhost` on a laptop.
 * Never an address by number, which no `admin.` name can hang from.
 */
export function domainOfShopHost(hostname: string): string | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (host === "localhost") return host;
  if (/^\d+(\.\d+){3}$/.test(host) || host.includes(":")) return null;
  return portalDomain(host);
}

/* `admin.` or `vendor.` in front of a host name: `localhost` counts, since a
   browser answers `admin.localhost` itself and that is how it is tried. */
const PORTAL_HOST = /^(admin|vendor)\.((?:[a-z0-9-]+\.)*[a-z0-9-]+)$/;

/**
 * Which portal an address is, and the domain it hangs from — or null for the
 * shop and for anywhere else.
 *
 * **An `admin.` or `vendor.` address is the portal by its own name**, with or
 * without `PORTAL_DOMAIN`: the page reads that setting when it is built, so a
 * setting changed without a deploy — or never made — left `admin.netlet.net`
 * drawing the shop, which is what the owner found the day the two names first
 * answered. With the setting made, an address under another domain is not a
 * portal of this shop.
 */
export function portalOfHost(hostname: string, domain: string | null): { side: PortalSide; domain: string } | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  const match = PORTAL_HOST.exec(host);
  if (!match) return null;
  const [, side, rest] = match;
  if (domain && rest !== domain) return null;
  if (!domain && !rest.includes(".") && rest !== "localhost") return null;
  return { side: side as PortalSide, domain: rest };
}

/** Which portal an address is, or null for the shop and for anywhere else. */
export function portalSideOfHost(hostname: string, domain: string | null): PortalSide | null {
  return portalOfHost(hostname, domain)?.side ?? null;
}

export const portalOrigin = (side: PortalSide, domain: string) => `https://${side}.${domain}`;
export const shopOrigin = (domain: string) => `https://${domain}`;

/** Whether an in-app address is one of the portal's pages. */
export const isPortalPath = (address: string) => {
  const [path] = split(address);
  return path === "/admin" || path.startsWith("/admin/");
};

/**
 * What the app calls the page in the address bar of a portal address:
 * `/orders` is `/admin/orders`, `/` the overview. An address already carrying
 * `/admin` — an old link with only its host changed — is read as it is.
 */
export function internalPath(address: string): string {
  const [path, rest] = split(address);
  if (kept(path) || isPortalPath(path)) return address;
  return `${path === "/" ? "/admin" : `/admin${path}`}${rest}`;
}

/**
 * The address bar's path for an in-app address on a portal address, or null
 * when the page is the shop's, which lives on the shop's own address.
 */
export function externalPath(address: string): string | null {
  const [path, rest] = split(address);
  if (path === "/admin") return `/${rest}`;
  if (path.startsWith("/admin/")) return `${path.slice("/admin".length)}${rest}`;
  if (kept(path)) return address;
  return null;
}

/** A full address on a portal for an in-app `/admin` page. */
export function portalUrl(side: PortalSide, domain: string, address: string): string {
  return `${portalOrigin(side, domain)}${externalPath(address) ?? "/"}`;
}

/**
 * Which portal somebody belongs on: NetLet's administrators and an employee
 * holding a grant on the admin one; a store's team and a delivery company's
 * people on the vendor one. An ordinary shopper belongs on neither.
 */
export function portalSideFor(actor: Actor | null | undefined): PortalSide | null {
  if (!actor) return null;
  if (actor.kind === "admin") return "admin";
  if (actor.kind === "vendor" || actor.kind === "courier") return "vendor";
  return actor.grants?.length ? "admin" : null;
}
