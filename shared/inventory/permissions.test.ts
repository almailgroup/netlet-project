import { describe, expect, it } from "vitest";
import { assertCan, can, readableVendors, VENDOR_ROLES, type Actor, type Capability } from "./permissions";

const admin: Actor = { kind: "admin", userId: 1 };
const owner: Actor = { kind: "vendor", userId: 2, vendorId: 10, role: "owner" };
const manager: Actor = { kind: "vendor", userId: 3, vendorId: 10, role: "manager" };
const staff: Actor = { kind: "vendor", userId: 4, vendorId: 10, role: "staff" };
const shopper: Actor = { kind: "customer", userId: 5 };

describe("scope", () => {
  it("keeps a vendor inside its own vendor", () => {
    expect(can(manager, "product.edit", 10)).toBe(true);
    expect(can(manager, "product.edit", 11)).toBe(false);
  });

  // Rank in one vendor must not leak into another. An owner is still nobody
  // next door.
  it("does not let rank cross vendors", () => {
    expect(can(owner, "vendor.manageMembers", 11)).toBe(false);
  });

  it("lets an admin reach every vendor", () => {
    expect(can(admin, "product.edit", 999)).toBe(true);
    expect(readableVendors(admin)).toBe("all");
  });

  it("gives a vendor exactly one readable vendor, and a shopper none", () => {
    expect(readableVendors(staff)).toEqual([10]);
    expect(readableVendors(shopper)).toEqual([]);
  });
});

describe("rank", () => {
  it("lets staff see products and move stock, but not publish", () => {
    expect(can(staff, "product.view", 10)).toBe(true);
    expect(can(staff, "stock.adjust", 10)).toBe(true);
    expect(can(staff, "product.publish", 10)).toBe(false);
    expect(can(staff, "product.create", 10)).toBe(false);
  });

  it("lets a manager run the catalog but not the team", () => {
    expect(can(manager, "product.create", 10)).toBe(true);
    expect(can(manager, "product.publish", 10)).toBe(true);
    expect(can(manager, "vendor.manageMembers", 10)).toBe(false);
  });

  it("gives an owner everything a manager has, plus the team", () => {
    for (const capability of ["product.create", "product.publish", "stock.adjust"] as Capability[]) {
      expect(can(owner, capability, 10)).toBe(true);
    }
    expect(can(owner, "vendor.manageMembers", 10)).toBe(true);
  });

  // The ranks are a ladder, so anything a lower rank clears a higher one must.
  it("is monotonic in rank", () => {
    const caps: Capability[] = ["product.view", "stock.adjust", "product.create", "product.publish", "vendor.manageMembers"];
    for (const capability of caps) {
      const cleared = VENDOR_ROLES.map(role => can({ kind: "vendor", userId: 9, vendorId: 10, role }, capability, 10));
      expect(cleared).toEqual([...cleared].sort((a, b) => Number(a) - Number(b)));
    }
  });
});

describe("what a vendor can never do", () => {
  // The requirements are explicit: commission is "entirely outside the
  // vendor's control". An owner is deliberately not enough.
  it("refuses commission changes to every vendor rank", () => {
    for (const role of VENDOR_ROLES) {
      expect(can({ kind: "vendor", userId: 9, vendorId: 10, role }, "vendor.setCommission", 10)).toBe(false);
    }
    expect(can(admin, "vendor.setCommission", 10)).toBe(true);
  });

  it("refuses approving its own vendor and reviewing its own products", () => {
    expect(can(owner, "vendor.approve", 10)).toBe(false);
    expect(can(owner, "product.review", 10)).toBe(false);
  });

  it("refuses seeing the whole platform", () => {
    expect(can(owner, "platform.viewAll")).toBe(false);
    expect(can(admin, "platform.viewAll")).toBe(true);
  });
});

describe("shoppers", () => {
  it("can do nothing in the inventory system", () => {
    const caps: Capability[] = ["product.view", "product.create", "stock.adjust", "vendor.viewMembers"];
    expect(caps.filter(c => can(shopper, c, 10))).toEqual([]);
  });
});

describe("assertCan", () => {
  it("throws a capability-named error rather than returning false", () => {
    expect(() => assertCan(staff, "product.publish", 10)).toThrow("FORBIDDEN:product.publish");
    expect(() => assertCan(manager, "product.publish", 10)).not.toThrow();
  });
});

describe("platform.manageUsers", () => {
  it("is reachable by an admin", () => {
    expect(can({ kind: "admin", userId: 1 }, "platform.manageUsers")).toBe(true);
  });

  // The escalation this blocks: a vendor owner granting themselves, or a
  // colleague, administrator rights over the whole platform.
  it("is out of reach of every vendor rank, owner included", () => {
    for (const role of ["staff", "manager", "owner"] as const) {
      expect(can({ kind: "vendor", userId: 2, vendorId: 1, role }, "platform.manageUsers")).toBe(false);
    }
  });

  it("is out of reach of a shopper", () => {
    expect(can({ kind: "customer", userId: 3 }, "platform.manageUsers")).toBe(false);
  });

  // Passing a vendor id must not make it look like a vendor-scoped question.
  it("stays refused even when asked about the owner's own vendor", () => {
    expect(can({ kind: "vendor", userId: 2, vendorId: 7, role: "owner" }, "platform.manageUsers", 7)).toBe(false);
  });
});
