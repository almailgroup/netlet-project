/**
 * What a person in the portal is, as a dictionary key: the header's badge,
 * and the account page's "Your store" card, which names the hat somebody is
 * putting on before they press it.
 *
 * Its own small file, never `AdminShell`'s: the account page imported it from
 * the portal's frame, and that one import put the frame, the menu, the page
 * jump and the co-pilot into the shop's account chunk, and would have put the
 * portal's own words there too (`Shared/i18n/portalMessages.ts`).
 */
import type { Actor } from "@shared/inventory/permissions";
import type { MessageKey } from "@shared/i18n/dictionary";

const ROLE_LABEL: Record<string, MessageKey> = {
  admin: "admin.roleAdmin",
  owner: "admin.roleOwner",
  manager: "admin.roleManager",
  staff: "admin.roleStaff",
};

/**
 * What this person is, in the header.
 *
 * A delivery company has no rank — its people all do the same job — so it is
 * answered by *kind* rather than falling through to the `staff` default, which
 * was calling a driver a store's staff member. The fallback stays for a vendor
 * membership with a rank this build does not know, where "staff" is the least
 * it could be.
 */
export function roleLabelKey(actor: Actor): MessageKey {
  if (actor.kind === "admin") return actor.team ? "team.member" : "admin.roleAdmin";
  if (actor.kind === "courier") return "admin.roleCourier";
  return ROLE_LABEL[(actor as { role?: string }).role ?? "staff"];
}
