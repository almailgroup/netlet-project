/**
 * Where a request's portals are: the domain they hang from and the origin of
 * either, as this request would reach them. The sign-in's hand-on and the
 * driver's QR (an address on the vendor portal) both ask, so one copy.
 */
import { domainOfShopHost, portalDomain, portalOfHost, type PortalSide } from "../../../Shared/portal.js";

export type RequestLike = { protocol?: string; hostname?: string; headers?: { host?: string } };

/** The host a request came to, without its port. */
export function hostOf(req: RequestLike): string {
  return (req.hostname ?? req.headers?.host ?? "").replace(/:\d+$/, "").toLowerCase();
}

/**
 * The domain the portals hang from, for this request: the setting, or — on a
 * portal's own address, which is a portal by its name (`portalOfHost`) — the
 * domain that address hangs from, or else the shop's own address less `www.`
 * (`domainOfShopHost`). The shop has no `/admin` of its own any more, on the
 * owner's word, so the portals' two names are the only way in and a sign-in
 * on the shop always has somewhere to hand on to.
 */
export function portalDomainFor(req: RequestLike): string | null {
  const host = hostOf(req);
  return portalDomain(process.env.PORTAL_DOMAIN) ?? portalOfHost(host, null)?.domain ?? domainOfShopHost(host);
}

/** A portal's origin as this request would reach it: the scheme and port it came in on. */
export function portalOriginFor(req: RequestLike, side: PortalSide, domain: string): string {
  const port = /:(\d+)$/.exec(req.headers?.host ?? "")?.[1];
  const scheme = req.protocol === "http" ? "http" : "https";
  return `${scheme}://${side}.${domain}${port ? `:${port}` : ""}`;
}
