/**
 * The portal on its own addresses in the browser (`Shared/portal.ts` is the
 * rule): which address this tab is on, the router's location hook there, and
 * the links between the shop and the two portals.
 *
 * `PORTAL_DOMAIN` is read at build (`envPrefix` in `vite.config.ts`), so
 * setting it in Vercel and deploying is what sends the shop's `/admin` on to
 * the portals; unset, the shop keeps the portal at `/admin` as it did before.
 * A tab on `admin.` or `vendor.` is the portal either way.
 */
import { useBrowserLocation } from "wouter/use-browser-location";
import { can, type Actor, type Capability } from "@shared/inventory/permissions";
import { externalPath, internalPath, isPortalPath, portalDomain, portalOfHost, portalUrl, shopOrigin, type PortalSide } from "@shared/portal";
import { ADMIN_MENU } from "@/content/adminMenu";
import { appPath } from "@/lib/basePath";
import { navigateWhenReady } from "@/lib/readyNavigation";

/* The setting, as it was when the page was built. */
const BUILT_DOMAIN = portalDomain(import.meta.env.PORTAL_DOMAIN as string | undefined);

/* This tab's own address, read as a portal: `admin.` or `vendor.` in front is
   the portal whether or not the build carried the setting (`portalOfHost`). */
const HERE = typeof window === "undefined" ? null : portalOfHost(window.location.hostname, BUILT_DOMAIN);

/** The domain the two portals hang from, or null while the move is off. */
export const PORTAL_DOMAIN = BUILT_DOMAIN ?? HERE?.domain ?? null;

/** Which portal this tab is on, or null on the shop (and while the move is off). */
export const PORTAL_SIDE: PortalSide | null = HERE?.side ?? null;

/* An address on another of the three names, reached the way this tab was:
   `https://` and no port on the live site, the port too on a laptop. */
function sameWay(url: string): string {
  if (typeof window === "undefined") return url;
  const { protocol, port } = window.location;
  return url.replace(/^https:\/\/([^/]+)/, (_, host: string) => `${protocol === "http:" ? "http" : "https"}://${host}${port ? `:${port}` : ""}`);
}

/**
 * Where an in-app `/admin` page is for somebody on one side: its own portal's
 * address while the move is on, and the path itself while it is off.
 */
export function portalHref(side: PortalSide, address = "/admin"): string {
  return PORTAL_DOMAIN ? sameWay(portalUrl(side, PORTAL_DOMAIN, address)) : appPath(address);
}

/**
 * A shop page's address from wherever the app is: the shop's own address on a
 * portal, so a product, a guide or the store opened from the portal is the
 * shop's page and not a portal page of the same name.
 */
export function shopHref(path: string): string {
  return PORTAL_SIDE && PORTAL_DOMAIN ? sameWay(`${shopOrigin(PORTAL_DOMAIN)}${path}`) : appPath(path);
}

/** What an in-app address is in the address bar of a portal: its own path, or the shop's full address. */
function portalAddress(address: string): string {
  return externalPath(address) ?? sameWay(`${shopOrigin(PORTAL_DOMAIN!)}${address}`);
}

/**
 * The router's `hrefs` on a portal: a `<Link href="/admin/orders">` draws
 * `/orders`, and a link to a shop page draws the shop's full address, so a
 * press with Ctrl or ⌘, or a copied link, goes where the page is.
 */
export const portalHrefs = (href: string) => portalAddress(href);

/** Moves to an in-app address from a portal: in place for its own pages, to the shop for the shop's. */
function navigateOnPortal(to: string, options?: { replace?: boolean; state?: unknown }) {
  const own = externalPath(to);
  if (own === null) {
    window.location.assign(portalAddress(to));
    return;
  }
  navigateWhenReady(own, options, to);
}

/**
 * The router's location hook on a portal: the address bar's `/orders` is the
 * app's `/admin/orders`, and every move is the shop's `readyNavigation`.
 */
export function usePortalLocation(options: { ssrPath?: string } = {}): [string, typeof navigateOnPortal] {
  const [location] = useBrowserLocation(options);
  return [internalPath(location), navigateOnPortal];
}

/**
 * Which portal an in-app `/admin` page most likely belongs to, for somebody
 * who is not signed in on the shop yet: the menu link the page sits under, and
 * whether a store's owner or a delivery company could open it. A page nobody
 * but NetLet's staff can open is the admin portal's; the rest — and anything
 * unknown — the vendor one, which is where most people opening the portal are.
 */
export function portalSideForPath(address: string): PortalSide {
  const path = address.split(/[?#]/)[0];
  const links = ADMIN_MENU.flatMap(group => group.links)
    .filter(link => path === link.href || (link.href !== "/admin" && path.startsWith(`${link.href}/`)))
    .sort((a, b) => b.href.length - a.href.length);
  const link = links[0];
  if (!link) return "vendor";
  const store: Actor = { kind: "vendor", userId: 0, vendorId: 0, role: "owner" };
  const courier: Actor = { kind: "courier", userId: 0, courierId: 0 };
  const needs: Capability[] = Array.isArray(link.need) ? link.need : [link.need];
  return needs.some(need => can(store, need, 0) || can(courier, need)) ? "vendor" : "admin";
}

export { isPortalPath };
