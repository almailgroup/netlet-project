/**
 * Who may do what, as a pure function.
 *
 * The requirements are specific about this: a vendor gets access "with specific
 * roles… meaning that they don't have full access to the whole inventory
 * system". Two things follow, and both are enforced here rather than in the
 * UI, because a hidden button is not a permission:
 *
 *   1. **Scope.** A vendor member reaches their own vendor's products and
 *      nothing else. An admin reaches everything.
 *   2. **Rank.** Within a vendor, what a member may do depends on their role —
 *      warehouse staff adjust stock but cannot publish, so nobody who is only
 *      trusted to count boxes can put something in front of customers.
 *
 * Kept pure and in `shared/` so the server enforces it and the client can ask
 * the same question to decide what to render, without two versions of the
 * answer that can disagree.
 */

export const VENDOR_ROLES = ["staff", "manager", "owner"] as const;
export type VendorRole = (typeof VENDOR_ROLES)[number];

/** Rank order. Higher clears everything a lower rank clears. */
const RANK: Record<VendorRole, number> = { staff: 0, manager: 1, owner: 2 };

export type Actor =
  /** A platform administrator. Not scoped to any vendor. */
  | { kind: "admin"; userId: number }
  /** Somebody acting for one vendor, at one rank. */
  | { kind: "vendor"; userId: number; vendorId: number; role: VendorRole }
  /** Signed in, but neither — an ordinary shopper. */
  | { kind: "customer"; userId: number };

/**
 * Everything the inventory system can be asked to do.
 *
 * Named for the act rather than the table, so the answer to "may I?" does not
 * change when the storage does.
 */
export type Capability =
  | "product.view"
  | "product.create"
  | "product.edit"
  | "product.publish"
  | "product.delete"
  | "stock.adjust"
  | "vendor.viewMembers"
  | "vendor.manageMembers"
  | "vendor.editProfile"
  /* Admin-only. Listed here so an attempt is answered rather than unhandled. */
  | "vendor.setCommission"
  | "vendor.approve"
  | "product.review"
  | "platform.viewAll"
  | "platform.manageUsers";

/** The lowest vendor rank that clears each capability. */
const NEEDS: Partial<Record<Capability, VendorRole>> = {
  "product.view": "staff",
  "stock.adjust": "staff",
  "vendor.viewMembers": "staff",
  "product.create": "manager",
  "product.edit": "manager",
  "product.publish": "manager",
  "product.delete": "manager",
  "vendor.editProfile": "owner",
  "vendor.manageMembers": "owner",
};

/**
 * Capabilities no vendor rank can reach, at any level.
 *
 * Commission is the load-bearing one: the requirements say rates are "entirely
 * outside the vendor's control", so an owner is deliberately not enough. It is
 * absent from NEEDS, and this list says so out loud rather than leaving it to
 * be inferred from an omission.
 */
const ADMIN_ONLY: Capability[] = [
  "vendor.setCommission",
  "vendor.approve",
  "product.review",
  "platform.viewAll",
  // Who reaches the admin panel is decided by people who are already in it.
  // A vendor owner runs their own team — `vendor.manageMembers` — and that is
  // a different question from who is an administrator of NetLet.
  "platform.manageUsers",
];

/**
 * May this actor do this, to this vendor's things?
 *
 * `vendorId` is the vendor the action touches. Leaving it out asks whether the
 * actor could do it to anything at all, which is how a UI decides whether to
 * show a control before a specific product is in hand.
 */
export function can(actor: Actor, capability: Capability, vendorId?: number): boolean {
  if (actor.kind === "admin") return true;
  if (actor.kind === "customer") return false;
  if (ADMIN_ONLY.includes(capability)) return false;

  // Scope first: rank inside another vendor means nothing here.
  if (vendorId !== undefined && vendorId !== actor.vendorId) return false;

  const needed = NEEDS[capability];
  if (!needed) return false;
  return RANK[actor.role] >= RANK[needed];
}

/**
 * The same question, as a throw.
 *
 * Routers want the guard to end the request rather than return a boolean they
 * might forget to check — the failure mode of `can()` used as a statement is
 * silent and total.
 */
export function assertCan(actor: Actor, capability: Capability, vendorId?: number): void {
  if (!can(actor, capability, vendorId)) {
    throw new Error(`FORBIDDEN:${capability}`);
  }
}

/** Vendor ids this actor may read, or "all" for an admin. */
export function readableVendors(actor: Actor): number[] | "all" {
  if (actor.kind === "admin") return "all";
  if (actor.kind === "vendor") return [actor.vendorId];
  return [];
}
