import { describe, expect, it } from "vitest";
import { ADMIN_ONLY, can, COURIER_CAPABILITIES, fullAdmin, NEEDS, onTeam, type Actor, type Capability } from "./permissions.js";
import {
  AREA_CAPABILITIES,
  areasAllow,
  capabilitiesOf,
  cleanAreas,
  READY_ROLE_AREAS,
  READY_ROLES,
  roleName,
  roleProblems,
  storedNames,
  TEAM_AREAS,
  teamMoveRefusal,
  type TeamArea,
} from "./team.js";

const member = (areas: TeamArea[]): Actor => ({
  kind: "admin",
  userId: 7,
  team: { roleId: 1, slug: null, name: "Role", nameAr: null, areas },
});

describe("what a team role opens", () => {
  it("opens exactly its areas' capabilities and nothing else", () => {
    const finance = member(["money", "orders"]);
    expect(can(finance, "finance.view")).toBe(true);
    expect(can(finance, "payouts.record")).toBe(true);
    expect(can(finance, "orders.view")).toBe(true);
    expect(can(finance, "product.edit")).toBe(false);
    expect(can(finance, "team.manage")).toBe(false);
    expect(can(finance, "platform.configure")).toBe(false);
    expect(can(finance, "audit.view")).toBe(false);
  });

  it("reaches across every store, like the administrator's rights it is cut from", () => {
    const catalogue = member(["catalogue"]);
    expect(can(catalogue, "product.edit", 3)).toBe(true);
    expect(can(catalogue, "product.edit", 99)).toBe(true);
  });

  it("never reaches making a full administrator, whatever it opens", () => {
    const everything = member([...TEAM_AREAS]);
    expect(can(everything, "platform.manageUsers")).toBe(false);
    expect(can(everything, "platform.devices")).toBe(false);
  });

  it("leaves a full administrator with everything, and the devices to the owner alone", () => {
    const full: Actor = { kind: "admin", userId: 1 };
    const owner: Actor = { kind: "admin", userId: 2, owner: true };
    expect(can(full, "platform.manageUsers")).toBe(true);
    expect(can(full, "team.manage")).toBe(true);
    expect(can(full, "platform.devices")).toBe(false);
    expect(can(owner, "platform.devices")).toBe(true);
    expect(fullAdmin(full)).toBe(true);
    expect(onTeam(full)).toBe(false);
    expect(onTeam(member(["team"]))).toBe(true);
  });

  it("gives every area the overview, and no store rank or company more than before", () => {
    for (const area of TEAM_AREAS) expect(AREA_CAPABILITIES[area]).toContain("portal.home");
    const staff: Actor = { kind: "vendor", userId: 3, vendorId: 1, role: "staff" };
    expect(can(staff, "orders.view", 1)).toBe(true);
    expect(can(staff, "orders.manage", 1)).toBe(true);
    expect(can(staff, "portal.home", 1)).toBe(true);
    expect(can(staff, "finance.view")).toBe(false);
    const courier: Actor = { kind: "courier", userId: 4, courierId: 1 };
    expect(can(courier, "portal.home")).toBe(false);
  });

  it("keeps every NetLet-wide capability out of a store's reach", () => {
    const owner: Actor = { kind: "vendor", userId: 5, vendorId: 1, role: "owner" };
    for (const capability of ["finance.view", "stores.view", "stores.manage", "audit.view", "fraud.view", "promotion.netlet", "bundles.netlet", "content.manage", "ads.review", "team.manage"] as Capability[]) {
      expect(ADMIN_ONLY).toContain(capability);
      expect(NEEDS[capability]).toBeUndefined();
      expect(can(owner, capability)).toBe(false);
    }
  });

  it("names only capabilities the code has, in every area", () => {
    for (const area of TEAM_AREAS) {
      for (const capability of AREA_CAPABILITIES[area]) {
        expect(ADMIN_ONLY.includes(capability) || NEEDS[capability] !== undefined || COURIER_CAPABILITIES.includes(capability), capability).toBe(true);
      }
    }
  });

  it("puts nobody's team rights in a capability no area holds, but the full administrator's", () => {
    const held = capabilitiesOf([...TEAM_AREAS]);
    expect(held.has("platform.manageUsers")).toBe(false);
    expect(held.has("platform.devices")).toBe(false);
    for (const capability of ADMIN_ONLY) {
      if (capability === "platform.manageUsers" || capability === "platform.devices") continue;
      expect(held.has(capability)).toBe(true);
    }
  });
});

describe("the ready-made roles", () => {
  it("are the seven named, each opening one area at least", () => {
    expect(READY_ROLES).toEqual(["manager", "finance", "hr", "customerService", "catalogue", "operations", "marketing"]);
    for (const slug of READY_ROLES) expect(READY_ROLE_AREAS[slug].length).toBeGreaterThan(0);
  });

  it("keep the manager off the team and the settings, and HR on the team alone", () => {
    expect(READY_ROLE_AREAS.manager).not.toContain("team");
    expect(READY_ROLE_AREAS.manager).not.toContain("settings");
    expect(READY_ROLE_AREAS.hr).toEqual(["team"]);
    expect(areasAllow(READY_ROLE_AREAS.finance, "payouts.record")).toBe(true);
    expect(areasAllow(READY_ROLE_AREAS.customerService, "support.answer")).toBe(true);
    expect(areasAllow(READY_ROLE_AREAS.operations, "delivery.assign")).toBe(true);
    expect(areasAllow(READY_ROLE_AREAS.marketing, "ads.review")).toBe(true);
    expect(areasAllow(READY_ROLE_AREAS.catalogue, "product.review")).toBe(true);
  });
});

describe("a role's name", () => {
  const ready = { slug: "finance" as const, name: null, nameAr: null };
  it("is the ready-made one's until it is renamed", () => {
    expect(roleName(ready, "en")).toEqual({ key: "team.role.finance" });
    expect(roleName({ ...ready, name: "Accounts" }, "en")).toEqual({ text: "Accounts" });
    expect(roleName({ ...ready, name: "Accounts" }, "ar")).toEqual({ text: "Accounts" });
    expect(roleName({ ...ready, name: "Accounts", nameAr: "الحسابات" }, "ar")).toEqual({ text: "الحسابات" });
  });

  it("is refused empty for a role NetLet makes, and allowed empty for a ready-made one", () => {
    expect(roleProblems({ name: " ", nameAr: "", areas: ["money"] })).toEqual({ name: "team.nameNeeded" });
    expect(roleProblems({ name: "", nameAr: "", areas: ["money"] }, true)).toEqual({});
    expect(roleProblems({ name: "x".repeat(41), nameAr: "", areas: ["money"] })).toEqual({ name: "team.nameTooLong" });
    expect(roleProblems({ name: "Buyers", nameAr: "", areas: [] })).toEqual({ areas: "team.areasNeeded" });
    expect(roleProblems({ name: "Buyers", nameAr: "", areas: ["nope"] })).toEqual({ areas: "team.areasNeeded" });
    expect(storedNames({ name: "  Head   of  buying ", nameAr: " " })).toEqual({ name: "Head of buying", nameAr: null });
  });

  it("keeps known areas only, once each, in the menu's order", () => {
    expect(cleanAreas(["team", "nope", "catalogue", "team"])).toEqual(["catalogue", "team"]);
  });
});

describe("who may move whom on the team", () => {
  const full = { full: true, hr: true, targetIsSelf: false, targetIsOwner: false };
  const hr = { full: false, hr: true, targetIsSelf: false, targetIsOwner: false };

  it("lets a full administrator do anything, but never to the owner or to themselves", () => {
    expect(teamMoveRefusal(full, { kind: "add", to: "full" })).toBeNull();
    expect(teamMoveRefusal(full, { kind: "change", from: "full", to: "role" })).toBeNull();
    expect(teamMoveRefusal({ ...full, targetIsOwner: true }, { kind: "change", from: "full", to: "role" })).toBe("team.ownerStays");
    expect(teamMoveRefusal({ ...full, targetIsSelf: true }, { kind: "remove", from: "full" })).toBe("team.notYourself");
  });

  it("lets HR move members holding a role, never a full administrator, and never themselves", () => {
    expect(teamMoveRefusal(hr, { kind: "add", to: "role" })).toBeNull();
    expect(teamMoveRefusal(hr, { kind: "change", from: "role", to: "role" })).toBeNull();
    expect(teamMoveRefusal(hr, { kind: "remove", from: "role" })).toBeNull();
    expect(teamMoveRefusal(hr, { kind: "add", to: "full" })).toBe("team.fullOnly");
    expect(teamMoveRefusal(hr, { kind: "change", from: "role", to: "full" })).toBe("team.fullOnly");
    expect(teamMoveRefusal(hr, { kind: "change", from: "full", to: "role" })).toBe("team.fullOnly");
    expect(teamMoveRefusal(hr, { kind: "remove", from: "full" })).toBe("team.fullOnly");
    expect(teamMoveRefusal({ ...hr, targetIsSelf: true }, { kind: "change", from: "role", to: "role" })).toBe("team.notYourself");
  });

  it("refuses anybody else", () => {
    expect(teamMoveRefusal({ full: false, hr: false, targetIsSelf: false, targetIsOwner: false }, { kind: "add", to: "role" })).toBe("team.notAllowed");
  });
});
