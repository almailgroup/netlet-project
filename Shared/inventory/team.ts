/**
 * NetLet's own team: who on NetLet's side reaches which part of the admin
 * panel (migration 0090, on the owner's word — "the admin can assign roles to
 * the people that can get access to the admin panel. Like Manager, Finance,
 * HR").
 *
 * A team member is an administrator account (`users.role = 'admin'`) with a
 * role; an administrator with no role is a **full administrator**, which is
 * what every administrator was before. A role opens **areas** — groups of
 * desks that one kind of work reaches for — and an area is a list of
 * capabilities, so the server's own `can()` (`permissions.ts`) is what
 * refuses everything else. Nothing here hides a page without the server
 * refusing it too.
 *
 * Two things are a full administrator's alone and no area reaches them,
 * which is what keeps anybody from giving themselves more: changing what a
 * role opens, and making somebody a full administrator (`platform.manageUsers`).
 * HR (the Team area, `team.manage`) adds people, changes their role and takes
 * them off the team — never their own row, and never a full administrator's.
 *
 * Pure, and shared by the server, the website and the app (`portal.json`).
 */
import type { Capability } from "./permissions.js";

/** The parts of the admin panel a role can open, in the menu's order. */
export const TEAM_AREAS = [
  "catalogue",
  "orders",
  "delivery",
  "customers",
  "money",
  "marketing",
  "stores",
  "team",
  "settings",
] as const;
export type TeamArea = (typeof TEAM_AREAS)[number];

/**
 * What each area lets a member do. A capability can sit in more than one
 * area: reading the products is the catalogue's and the order desk's, since
 * an order is opened to see what is in it. `portal.home` is in every area —
 * the overview, whose tiles are each drawn by their own capability.
 */
export const AREA_CAPABILITIES: Record<TeamArea, readonly Capability[]> = {
  catalogue: [
    "portal.home", "product.view", "product.create", "product.edit", "product.publish", "product.delete",
    "stock.adjust", "product.review", "product.reassign", "bundles.netlet", "stores.view",
  ],
  orders: ["portal.home", "orders.view", "orders.manage", "returns.handle", "offer.answer", "product.view", "stores.view"],
  delivery: [
    "portal.home", "delivery.view", "delivery.move", "delivery.assign", "delivery.fileClaim", "delivery.decideClaims",
    "fulfilment.operate", "orders.view", "stores.view",
  ],
  customers: ["portal.home", "support.answer", "membership.manage", "fraud.view", "orders.view"],
  money: [
    "portal.home", "finance.view", "payouts.view", "payouts.record", "vendor.setCommission", "affiliate.manage",
    "orders.view", "stores.view", "vendor.payments",
  ],
  marketing: [
    "portal.home", "promotion.manage", "promotion.netlet", "ads.book", "ads.review", "content.manage",
    "product.view", "stores.view",
  ],
  stores: [
    "portal.home", "stores.view", "stores.manage", "vendor.approve", "vendor.editProfile",
    "vendor.viewMembers", "vendor.manageMembers", "product.view", "vendor.payments",
  ],
  team: ["portal.home", "team.manage"],
  settings: ["portal.home", "platform.configure", "audit.view"],
};

/**
 * The roles NetLet starts with. Each can be renamed and given other areas by
 * a full administrator; none can be deleted, so the names a member was given
 * do not vanish from under them. A full administrator can add roles of their
 * own beside these.
 */
export const READY_ROLES = ["manager", "finance", "hr", "customerService", "catalogue", "operations", "marketing"] as const;
export type ReadyRole = (typeof READY_ROLES)[number];

export const READY_ROLE_AREAS: Record<ReadyRole, readonly TeamArea[]> = {
  manager: ["catalogue", "orders", "delivery", "customers", "money", "marketing", "stores"],
  finance: ["money", "orders"],
  hr: ["team"],
  customerService: ["orders", "customers"],
  catalogue: ["catalogue"],
  operations: ["delivery", "orders"],
  marketing: ["marketing"],
};

/** A member's seat on the team, as the actor carries it. */
export type TeamSeat = {
  roleId: number;
  /** A ready-made role's key, or null for one NetLet made itself. */
  slug: ReadyRole | null;
  /** The name it was given; null for a ready-made role that keeps its own. */
  name: string | null;
  nameAr: string | null;
  areas: TeamArea[];
};

export const MAX_TEAM_ROLES = 40;
export const ROLE_NAME_MAX = 40;

export function isTeamArea(value: unknown): value is TeamArea {
  return typeof value === "string" && (TEAM_AREAS as readonly string[]).includes(value);
}

export function isReadyRole(value: unknown): value is ReadyRole {
  return typeof value === "string" && (READY_ROLES as readonly string[]).includes(value);
}

/** The areas kept from what a row holds: known ones only, once each, in the menu's order. */
export function cleanAreas(areas: readonly unknown[]): TeamArea[] {
  return TEAM_AREAS.filter(area => areas.includes(area));
}

/** Every capability a set of areas opens. */
export function capabilitiesOf(areas: readonly TeamArea[]): Set<Capability> {
  const found = new Set<Capability>();
  for (const area of areas) for (const capability of AREA_CAPABILITIES[area] ?? []) found.add(capability);
  return found;
}

/** May a member holding these areas do this? */
export function areasAllow(areas: readonly TeamArea[], capability: Capability): boolean {
  return areas.some(area => AREA_CAPABILITIES[area]?.includes(capability));
}

/** The dictionary's name for a ready-made role. */
export function readyRoleKey(slug: ReadyRole): `team.role.${ReadyRole}` {
  return `team.role.${slug}`;
}

/** The name a role is shown by in a language: its own, the other language's, or the ready-made one's. */
export function roleName(role: { slug: ReadyRole | null; name: string | null; nameAr: string | null }, locale: "en" | "ar"):
  | { text: string }
  | { key: `team.role.${ReadyRole}` }
  | { text: "" } {
  const own = locale === "ar" ? role.nameAr || role.name : role.name || role.nameAr;
  if (own) return { text: own };
  if (role.slug) return { key: readyRoleKey(role.slug) };
  return { text: "" };
}

export type RoleDraft = { name: string; nameAr: string; areas: readonly unknown[] };
export type RoleProblem = "team.nameNeeded" | "team.nameTooLong" | "team.nameArTooLong" | "team.areasNeeded";
export type RoleProblems = Partial<Record<"name" | "nameAr" | "areas", RoleProblem>>;

const squash = (text: string) => text.split(/\s+/).filter(Boolean).join(" ");

/**
 * What is wrong with a role as typed, field by field, before it is saved —
 * the form and the server both ask. A role NetLet makes needs a name in one
 * language at least; a ready-made one may keep its own (`ready`). Every role
 * opens one area at least, or a member holding it would reach nothing.
 */
export function roleProblems(draft: RoleDraft, ready = false): RoleProblems {
  const problems: RoleProblems = {};
  const name = squash(draft.name);
  const nameAr = squash(draft.nameAr);
  if (!ready && !name && !nameAr) problems.name = "team.nameNeeded";
  if (name.length > ROLE_NAME_MAX) problems.name = "team.nameTooLong";
  if (nameAr.length > ROLE_NAME_MAX) problems.nameAr = "team.nameArTooLong";
  if (cleanAreas(draft.areas).length === 0) problems.areas = "team.areasNeeded";
  return problems;
}

/** A role's names as stored: squashed, and empty as null. */
export function storedNames(draft: { name: string; nameAr: string }): { name: string | null; nameAr: string | null } {
  return { name: squash(draft.name) || null, nameAr: squash(draft.nameAr) || null };
}

/**
 * Who may put somebody on the team, change their role or take them off it.
 *
 * - `full` — a full administrator: anything, but never the shop's owner, who
 *   stays a full administrator (`OWNER_EMAIL`), and never their own row.
 * - `hr` — a member whose role opens the Team area: members holding a role,
 *   never a full administrator, never a role of full administrator, and never
 *   their own row (or HR could give themselves Manager).
 */
export type TeamMove =
  | { kind: "add"; to: "role" | "full" }
  | { kind: "change"; from: "role" | "full"; to: "role" | "full" }
  | { kind: "remove"; from: "role" | "full" };

export type TeamRefusal =
  | "team.notAllowed"
  | "team.fullOnly"
  | "team.notYourself"
  | "team.ownerStays";

export function teamMoveRefusal(
  who: { full: boolean; hr: boolean; targetIsSelf: boolean; targetIsOwner: boolean },
  move: TeamMove,
): TeamRefusal | null {
  if (!who.full && !who.hr) return "team.notAllowed";
  if (who.targetIsOwner) return "team.ownerStays";
  if (who.targetIsSelf) return "team.notYourself";
  if (who.full) return null;
  const touchesFull =
    (move.kind === "add" && move.to === "full") ||
    (move.kind === "change" && (move.from === "full" || move.to === "full")) ||
    (move.kind === "remove" && move.from === "full");
  return touchesFull ? "team.fullOnly" : null;
}
