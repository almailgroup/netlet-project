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
  /**
   * Somebody acting for a delivery company (2.2, 3.4.2).
   *
   * The fifth party the requirements name, and the one that had no interface
   * at all. There is no rank: a delivery company's people all do the same job,
   * and inventing `driver`/`dispatcher` would be a permission model nobody
   * asked for. Scope is the whole of it — they reach the parcels assigned to
   * *their* company and nothing else, which the queries enforce the way vendor
   * scope is enforced.
   */
  | { kind: "courier"; userId: number; courierId: number }
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
  /*
   * Quoting one shopper a special price, and reading the requests for one.
   * They are a single capability rather than a view and an answer, because a
   * rank that may read the inbox and not reply is a rank that watches requests
   * expire. `manager` rather than `staff`: this is a pricing decision, and
   * `staff` moves stock.
   */
  | "offer.answer"
  /*
   * Answering shoppers' messages (3.8). `staff`, unlike quoting a price: a
   * question about whether the blue one is in stock is answered by whoever is
   * on the shop floor, and a rank that can see the inbox and not reply is a
   * rank that watches questions go stale.
   */
  | "chat.answer"
  /*
   * Returns (3.2.8). `manager`: answering a request a rule could not decide,
   * and saying what came back and whether it goes on the shelf, are decisions
   * about money and stock together, which is a manager's.
   */
  | "returns.handle"
  | "vendor.viewMembers"
  | "vendor.manageMembers"
  | "vendor.editProfile"
  /*
   * Dispatch (2.2, 3.4.2). `view` is the board; `move` is "collected" and
   * "handed over", the two things a delivery company actually witnesses.
   * Assigning a parcel to a company is admin-only and listed below — a courier
   * who could assign would be helping themselves to a rival's work.
   */
  | "delivery.view"
  | "delivery.move"
  /* Admin-only. Listed here so an attempt is answered rather than unhandled. */
  | "delivery.assign"
  /*
   * Damage in transit (3.4.2). Filing is the seller's — whoever packs the
   * parcels is who hears about a broken one first, so `staff` reaches it.
   * Deciding is NetLet's alone: a claim is money one company owes another,
   * and neither of them gets to rule on it.
   */
  | "delivery.fileClaim"
  | "delivery.decideClaims"
  | "vendor.setCommission"
  | "vendor.approve"
  | "product.review"
  | "platform.viewAll"
  | "platform.manageUsers"
  /* The feature switchboard (2.3). Turning a feature off for every store and
     every shopper at once is NetLet's decision about NetLet. */
  | "platform.configure";

/** The lowest vendor rank that clears each capability. */
const NEEDS: Partial<Record<Capability, VendorRole>> = {
  "product.view": "staff",
  "stock.adjust": "staff",
  "vendor.viewMembers": "staff",
  "delivery.fileClaim": "staff",
  "chat.answer": "staff",
  "returns.handle": "manager",
  "product.create": "manager",
  "product.edit": "manager",
  "product.publish": "manager",
  "product.delete": "manager",
  "offer.answer": "manager",
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
  /* Who carries a parcel is NetLet's arrangement with a company, not a
     decision either the seller or the driver gets to make. */
  "delivery.assign",
  "delivery.decideClaims",
  "vendor.setCommission",
  "vendor.approve",
  "product.review",
  "platform.viewAll",
  // Who reaches the admin panel is decided by people who are already in it.
  // A vendor owner runs their own team — `vendor.manageMembers` — and that is
  // a different question from who is an administrator of NetLet.
  "platform.manageUsers",
  "platform.configure",
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
  /*
   * A delivery company reaches dispatch and nothing else — not a product, not
   * a price, not another company's board. *Which* parcels is scoped inside the
   * queries by `actor.courierId`, exactly as a vendor's rows are: a check up
   * here would be one a second caller could skip.
   */
  if (actor.kind === "courier") return capability === "delivery.view" || capability === "delivery.move";
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

/**
 * The delivery company whose parcels this actor may read, or "all".
 *
 * The mirror of `readableVendors`, and what the dispatch queries scope on.
 * Anybody else gets an empty list rather than a throw, so a page that asks
 * before checking gets nothing rather than an error.
 */
export function readableCouriers(actor: Actor): number[] | "all" {
  if (actor.kind === "admin") return "all";
  if (actor.kind === "courier") return [actor.courierId];
  return [];
}
