import { describe, expect, it } from "vitest";
import { externalPath, internalPath, isPortalPath, portalDomain, portalSideFor, portalSideOfHost, portalUrl } from "./portal";

describe("the portal's own addresses", () => {
  it("reads the setting as a domain or as off", () => {
    expect(portalDomain("netlet.net")).toBe("netlet.net");
    expect(portalDomain(" https://www.NetLet.net/ ")).toBe("netlet.net");
    expect(portalDomain("")).toBeNull();
    expect(portalDomain(undefined)).toBeNull();
    expect(portalDomain("not a host")).toBeNull();
    expect(portalDomain("localhost")).toBeNull();
  });

  it("knows which portal an address is, and nothing else", () => {
    expect(portalSideOfHost("admin.netlet.net", "netlet.net")).toBe("admin");
    expect(portalSideOfHost("VENDOR.netlet.net", "netlet.net")).toBe("vendor");
    expect(portalSideOfHost("netlet.net", "netlet.net")).toBeNull();
    expect(portalSideOfHost("www.netlet.net", "netlet.net")).toBeNull();
    expect(portalSideOfHost("admin.netlet.net.evil.example", "netlet.net")).toBeNull();
    expect(portalSideOfHost("subadmin.netlet.net", "netlet.net")).toBeNull();
    // Off: no address is a portal, so the portal stays at /admin.
    expect(portalSideOfHost("admin.netlet.net", null)).toBeNull();
  });

  it("leaves the portal's /admin off the address bar and puts it back", () => {
    expect(internalPath("/")).toBe("/admin");
    expect(internalPath("/orders")).toBe("/admin/orders");
    expect(internalPath("/products/12?tab=stock")).toBe("/admin/products/12?tab=stock");
    expect(externalPath("/admin")).toBe("/");
    expect(externalPath("/admin/orders")).toBe("/orders");
    expect(externalPath("/admin/products/12?tab=stock")).toBe("/products/12?tab=stock");
    expect(externalPath("/admin?x=1")).toBe("/?x=1");
  });

  it("keeps the sign-in, an invoice and the legal pages as they are", () => {
    for (const path of ["/signin", "/signin?next=%2Fadmin", "/invoices/NL-1", "/terms", "/privacy", "/seller-agreement"]) {
      expect(internalPath(path)).toBe(path);
      expect(externalPath(path)).toBe(path);
    }
  });

  it("reads an old address that still carries /admin as it is", () => {
    expect(internalPath("/admin/orders")).toBe("/admin/orders");
    expect(internalPath("/admin")).toBe("/admin");
  });

  it("answers a shop page as the shop's, never a portal page of the same name", () => {
    expect(externalPath("/")).toBeNull();
    expect(externalPath("/products/brass-lamp")).toBeNull();
    expect(externalPath("/account")).toBeNull();
    expect(externalPath("/administrator")).toBeNull();
    expect(isPortalPath("/administrator")).toBe(false);
    expect(isPortalPath("/admin/people")).toBe(true);
  });

  it("builds a portal's full address for a page", () => {
    expect(portalUrl("vendor", "netlet.net", "/admin/orders")).toBe("https://vendor.netlet.net/orders");
    expect(portalUrl("admin", "netlet.net", "/admin")).toBe("https://admin.netlet.net/");
    expect(portalUrl("admin", "netlet.net", "/admin/people?q=a#top")).toBe("https://admin.netlet.net/people?q=a#top");
  });

  it("sends each kind of person to their own portal", () => {
    expect(portalSideFor({ kind: "admin", userId: 1 })).toBe("admin");
    expect(portalSideFor({ kind: "customer", userId: 2, grants: ["vendor.setCommission"] })).toBe("admin");
    expect(portalSideFor({ kind: "vendor", userId: 3, vendorId: 1, role: "staff" })).toBe("vendor");
    expect(portalSideFor({ kind: "courier", userId: 4, courierId: 1 })).toBe("vendor");
    expect(portalSideFor({ kind: "customer", userId: 5 })).toBeNull();
    expect(portalSideFor(null)).toBeNull();
  });
});
