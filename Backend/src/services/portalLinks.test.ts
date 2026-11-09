/**
 * Links that leave the shop for the portal's own addresses (`Shared/portal.ts`):
 * an email's button, and where a link in Supabase's mail comes back to. The
 * shop has no `/admin` of its own, on the owner's word, so with no
 * `PORTAL_DOMAIN` the portals hang from the shop's own address.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { emailLink } from "./notifications.js";
import { linkLanding } from "../core/passwordStore.js";

afterEach(() => vi.unstubAllEnvs());

describe("an email's button", () => {
  it("goes to the portal on the shop's own domain when no setting names one", () => {
    vi.stubEnv("PORTAL_DOMAIN", "");
    expect(emailLink("https://netlet.net", "/admin/orders", "seller")).toBe("https://vendor.netlet.net/orders");
    expect(emailLink("https://www.netlet.net", "/admin/review", "staff")).toBe("https://admin.netlet.net/review");
    expect(emailLink("https://netlet.net", "/account/orders?order=NL-1", "shopper")).toBe("https://netlet.net/account/orders?order=NL-1");
    expect(emailLink("https://netlet.net", null, "seller")).toBeNull();
  });

  it("goes to the portal its reader signs in on", () => {
    vi.stubEnv("PORTAL_DOMAIN", "netlet.net");
    expect(emailLink("https://netlet.net", "/admin/orders", "seller")).toBe("https://vendor.netlet.net/orders");
    expect(emailLink("https://netlet.net", "/admin", "applicant")).toBe("https://vendor.netlet.net/");
    expect(emailLink("https://netlet.net", "/admin/review", "staff")).toBe("https://admin.netlet.net/review");
    // A shop page stays the shop's.
    expect(emailLink("https://netlet.net", "/account/orders", "shopper")).toBe("https://netlet.net/account/orders");
  });
});

describe("where a link in Supabase's mail comes back to", () => {
  it("is the portal's own sign-in when asked from a portal", () => {
    vi.stubEnv("PORTAL_DOMAIN", "netlet.net");
    expect(linkLanding("https://vendor.netlet.net")).toBe("https://vendor.netlet.net/signin");
    expect(linkLanding("https://admin.netlet.net")).toBe("https://admin.netlet.net/signin");
  });

  it("is what it always was otherwise, whatever address asked", () => {
    const before = (origin: string) => {
      vi.stubEnv("PORTAL_DOMAIN", "");
      const answer = linkLanding(origin);
      vi.stubEnv("PORTAL_DOMAIN", "netlet.net");
      return answer;
    };
    for (const origin of ["https://netlet.net", "https://admin.netlet.net.evil.example", "https://subadmin.netlet.net"]) {
      const expected = before(origin);
      expect(linkLanding(origin)).toBe(expected);
    }
  });
});
