/**
 * The shop's way into the portal, which has no `/admin` on the shop any more,
 * on the owner's word ("it should only be admin.netlet.net, and for vendor,
 * vendor.netlet.net"): a link is the portal's own address for the side the
 * person belongs on, and a plain press from somebody signed in carries their
 * session across by a one-time pass (`auth.portalPass`), so they land signed
 * in — each address keeps its own cookie. A press with Ctrl, ⌘ or Shift opens
 * the plain address in a new tab, where the portal asks for its sign-in.
 */
import type { MouseEvent } from "react";
import type { PortalSide } from "@shared/portal";
import { trpc } from "@/lib/trpc";
import { PORTAL_DOMAIN, PORTAL_SIDE, portalHref } from "@/lib/portalHost";

export function usePortalDoor() {
  const pass = trpc.auth.portalPass.useMutation();
  return {
    href: (side: PortalSide, to = "/admin") => portalHref(side, to),
    open(event: MouseEvent, side: PortalSide, to = "/admin") {
      /* The demo build has no portal addresses, and a portal's own links are its own. */
      if (!PORTAL_DOMAIN || PORTAL_SIDE) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const plain = portalHref(side, to);
      pass.mutateAsync({ next: to }).then(
        answer => window.location.assign(answer?.url ?? plain),
        () => window.location.assign(plain),
      );
    },
  };
}
