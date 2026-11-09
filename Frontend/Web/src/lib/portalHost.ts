/**
 * The portal on its own addresses in the browser (`Shared/portal.ts` is the
 * rule): which address this tab is on, the router's location hook there, and
 * the links between the shop and the two portals.
 *
 * `PORTAL_DOMAIN` is read at build (`envPrefix` in `vite.config.ts`); unset,
 * the portals hang from the shop's own address less `www.`
 * (`domainOfShopHost`), because the shop has no `/admin` of its own any more,
 * on the owner's word. A tab on `admin.` or `vendor.` is the portal either
 * way. Only the demo build, which has no addresses but its own, keeps the
 * portal at `/admin`, against its fixtures.
 */
import { useBrowserLocation } from "wouter/use-browser-location";
import { domainOfShopHost, externalPath, internalPath, isPortalPath, portalDomain, portalOfHost, portalUrl, shopOrigin, type PortalSide } from "@shared/portal";
import { DEMO_MODE } from "@/lib/demoMode";
import { appPath } from "@/lib/basePath";
import { navigateWhenReady } from "@/lib/readyNavigation";

/* The setting, as it was when the page was built. */
const BUILT_DOMAIN = portalDomain(import.meta.env.PORTAL_DOMAIN as string | undefined);

/* This tab's own address, read as a portal: `admin.` or `vendor.` in front is
   the portal whether or not the build carried the setting (`portalOfHost`). */
const HERE = typeof window === "undefined" ? null : portalOfHost(window.location.hostname, BUILT_DOMAIN);

/** The domain the two portals hang from — null only in the demo build, which keeps the portal at `/admin`. */
export const PORTAL_DOMAIN = BUILT_DOMAIN ?? HERE?.domain
  ?? (DEMO_MODE || typeof window === "undefined" ? null : domainOfShopHost(window.location.hostname));

/** Whether this tab draws the portal at all: on its own two addresses, or in the demo build. */
export const PORTAL_DRAWN = Boolean(HERE) || DEMO_MODE;

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

export { isPortalPath };
