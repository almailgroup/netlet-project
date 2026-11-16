/**
 * Every page a customer can reach, once, so the header, the phone's menu and
 * the footer cannot list different pages. `preview` pages exist only where
 * preview is on (see preview.tsx) and are never linked anywhere else.
 */
import type { LucideIcon } from "lucide-react";
import { CircleHelp, Palette, Search } from "lucide-react";
import type { Key } from "../shared/i18n.js";

/** The home page's tracking box, which the header's Track button goes to rather than opening a second one. */
export const HOME_TRACK_ID = "home-track";

export type NavGroup = "tracking" | "help" | "company";

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
  { href: "/help", label: "nav.helpCentre", icon: CircleHelp, group: "help", header: true },
  { href: "/styleguide", label: "nav.styleguide", icon: Palette, group: "company", preview: true },
];

export const GROUPS: readonly { id: NavGroup; label: Key }[] = [
  { id: "tracking", label: "nav.groupTracking" },
  { id: "help", label: "nav.groupHelp" },
  { id: "company", label: "nav.groupCompany" },
];

export function pagesFor(preview: boolean): NavPage[] {
  return PAGES.filter(page => preview || !page.preview);
}

/** Whether a link is to the page showing, or one under it. */
export function isCurrent(href: string, location: string): boolean {
  return href === "/" ? location === "/" : location === href || location.startsWith(`${href}/`);
}
