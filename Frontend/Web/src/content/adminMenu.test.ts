import { describe, expect, it } from "vitest";
import { ADMIN_MENU, menuFor } from "./adminMenu";
import type { Actor } from "@shared/inventory/permissions";

const hrefs = (actor: Actor) => menuFor(actor).flatMap(group => group.links.map(link => link.href));
const STORE_ONLY = ["/admin/team", "/admin/store-documents"];

describe("menuFor", () => {
  it("leaves a store's own pages out of an administrator's menu, on the owner's word", () => {
    const admin = hrefs({ kind: "admin", userId: 1 });
    for (const href of STORE_ONLY) expect(admin).not.toContain(href);
    /* An administrator still reaches each store's team and papers on its page. */
    expect(admin).toContain("/admin/vendors");
    expect(admin).toContain("/admin/staff");
    const member = hrefs({ kind: "admin", userId: 2, team: { roleId: 1, slug: "manager", name: null, nameAr: null, areas: ["team", "stores"] } });
    for (const href of STORE_ONLY) expect(member).not.toContain(href);
  });

  it("keeps both for the store's owner, and the team for its staff", () => {
    const owner = hrefs({ kind: "vendor", userId: 3, vendorId: 7, role: "owner" });
    for (const href of STORE_ONLY) expect(owner).toContain(href);
    expect(owner).not.toContain("/admin/staff");
    const staff = hrefs({ kind: "vendor", userId: 4, vendorId: 7, role: "staff" });
    expect(staff).toContain("/admin/team");
    expect(staff).not.toContain("/admin/store-documents");
  });

  it("marks exactly the store's own pages", () => {
    const marked = ADMIN_MENU.flatMap(group => group.links.filter(link => link.storeOnly).map(link => link.href));
    expect(marked.sort()).toEqual([...STORE_ONLY].sort());
  });

  it("drops a group with nothing left in it", () => {
    for (const group of menuFor({ kind: "courier", userId: 5, courierId: 2 })) expect(group.links.length).toBeGreaterThan(0);
  });
});
