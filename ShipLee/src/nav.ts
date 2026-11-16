/**
 * Every page a customer can reach, once, so the header, the phone's menu and
 * the footer cannot list different pages. `preview` pages exist only where
 * preview is on (see preview.tsx) and are never linked anywhere else.
 */
import type { LucideIcon } from "lucide-react";
import { Briefcase, Building2, Calculator, Car, CircleHelp, Flag, Headset, Layers, MapPinned, PackageCheck, Palette, Search, ShieldAlert, Truck, UserRound } from "lucide-react";
import type { Key } from "../shared/i18n.js";

/** The home page's tracking box, which the header's Track button goes to rather than opening a second one. */
export const HOME_TRACK_ID = "home-track";

export type NavGroup = "tracking" | "help" | "company" | "account";

export type NavPage = {
  href: string;
  label: Key;
  icon: LucideIcon;
  group: NavGroup;
  /** Drawn in the header's row from a laptop up. */
  header?: boolean;
  preview?: boolean;
};

export const PAGES: readonly NavPage[] = [
  { href: "/", label: "nav.trackParcel", icon: Search, group: "tracking" },
  { href: "/track", label: "nav.trackSeveral", icon: Layers, group: "tracking" },
  { href: "/book", label: "nav.book", icon: PackageCheck, group: "tracking", preview: true },
  { href: "/rates", label: "nav.rates", icon: Calculator, group: "tracking", preview: true, header: true },
  { href: "/services", label: "nav.services", icon: Truck, group: "tracking", preview: true, header: true },
  { href: "/locations", label: "nav.locations", icon: MapPinned, group: "tracking", preview: true },
  { href: "/help", label: "nav.helpCentre", icon: CircleHelp, group: "help", header: true },
  { href: "/contact", label: "nav.contact", icon: Headset, group: "help", header: true },
  { href: "/report", label: "nav.report", icon: Flag, group: "help" },
  { href: "/scams", label: "nav.scams", icon: ShieldAlert, group: "help" },
  { href: "/about", label: "nav.about", icon: Building2, group: "company", preview: true },
  { href: "/careers", label: "nav.careers", icon: Briefcase, group: "company", preview: true },
  { href: "/couriers", label: "nav.couriers", icon: Car, group: "company", preview: true },
  { href: "/styleguide", label: "nav.styleguide", icon: Palette, group: "company", preview: true },
  { href: "/signin", label: "nav.signIn", icon: UserRound, group: "account", preview: true },
  { href: "/account", label: "nav.account", icon: UserRound, group: "account", preview: true },
];

export const GROUPS: readonly { id: NavGroup; label: Key }[] = [
  { id: "tracking", label: "nav.groupTracking" },
  { id: "help", label: "nav.groupHelp" },
  { id: "company", label: "nav.groupCompany" },
  { id: "account", label: "nav.groupAccount" },
];

export function pagesFor(preview: boolean): NavPage[] {
  return PAGES.filter(page => preview || !page.preview);
}

/** Whether a link is to the page showing, or one under it. */
export function isCurrent(href: string, location: string): boolean {
  /* The home page and the several-parcels page are not "under" the tracking pages they lead to. */
  if (href === "/" || href === "/track") return location === href;
  return location === href || location.startsWith(`${href}/`);
}
