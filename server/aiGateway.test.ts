/**
 * Who gets a token for the AI gateway, and what it says. The token is
 * checked with the gateway's own `verifyGatewayToken`, so this is the same
 * question the Worker asks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const switches = vi.hoisted(() => ({ ai: true }));
vi.mock("./features.js", () => ({ featureOn: async (key: string) => (key === "ai" ? switches.ai : true) }));

import { ENV } from "./_core/env.js";
import { gatewayOrigin, guestSubject } from "./_core/aiGateway.js";
import { catalogSession, chatSession, gatewayAvailable } from "./aiGateway.js";
import { verifyGatewayToken } from "../Shared/ai/gateway.js";
import type { Actor } from "../Shared/inventory/permissions.js";

const SECRET = "q".repeat(40);
const saved = { url: ENV.aiGatewayUrl, secret: ENV.aiGatewaySecret };

beforeEach(() => {
  ENV.aiGatewayUrl = "https://ai.netlet.net";
  ENV.aiGatewaySecret = SECRET;
  switches.ai = true;
});
afterEach(() => {
  ENV.aiGatewayUrl = saved.url;
  ENV.aiGatewaySecret = saved.secret;
});

const now = () => Math.floor(Date.now() / 1000);

describe("gatewayOrigin", () => {
  it("takes https, and plain http only to this machine", () => {
    expect(gatewayOrigin("https://netlet-ai-gateway.example.workers.dev")).toBe("https://netlet-ai-gateway.example.workers.dev");
    expect(gatewayOrigin("https://ai.netlet.net/")).toBe("https://ai.netlet.net");
    expect(gatewayOrigin("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(gatewayOrigin("http://ai.netlet.net")).toBeNull();
  });

  it("refuses an address with a path, a query or credentials, and junk", () => {
    for (const bad of ["https://ai.netlet.net/api", "https://ai.netlet.net/?x=1", "https://user:pw@ai.netlet.net", "javascript:alert(1)", "not a url", ""]) {
      expect(gatewayOrigin(bad)).toBeNull();
    }
  });
});

describe("chatSession", () => {
  it("signs a chat token for an account, good for five minutes", async () => {
    const session = await chatSession(42, "203.0.113.9");
    expect(session.available).toBe(true);
    if (!session.available) return;
    expect(session.url).toBe("https://ai.netlet.net");
    const claims = await verifyGatewayToken(session.token, SECRET, now());
    expect(claims).toMatchObject({ scope: "chat", sub: "u:42", vendor: null });
    expect(claims!.exp - now()).toBeGreaterThan(290);
  });

  it("names a guest by a keyed hash of the address — the same each time, and never the address", async () => {
    const first = await chatSession(null, "203.0.113.9");
    const again = await chatSession(null, "203.0.113.9");
    const other = await chatSession(null, "198.51.100.4");
    if (!first.available || !again.available || !other.available) throw new Error("unavailable");
    const sub = (await verifyGatewayToken(first.token, SECRET, now()))!.sub;
    expect(sub).toMatch(/^a:/);
    expect(sub).not.toContain("203");
    expect((await verifyGatewayToken(again.token, SECRET, now()))!.sub).toBe(sub);
    expect((await verifyGatewayToken(other.token, SECRET, now()))!.sub).not.toBe(sub);
    expect(guestSubject("203.0.113.9")).toBe(sub);
  });

  it("is unavailable with no address, a short secret, or model calls switched off", async () => {
    ENV.aiGatewayUrl = "";
    expect(await chatSession(1, null)).toEqual({ available: false });
    ENV.aiGatewayUrl = "https://ai.netlet.net";
    ENV.aiGatewaySecret = "short";
    expect(await chatSession(1, null)).toEqual({ available: false });
    ENV.aiGatewaySecret = SECRET;
    switches.ai = false;
    expect(await chatSession(1, null)).toEqual({ available: false });
    expect(await gatewayAvailable()).toBe(false);
  });
});

describe("catalogSession", () => {
  const manager: Actor = { kind: "vendor", userId: 5, vendorId: 3, role: "manager" };

  it("signs a catalogue token for a seller who may add products, naming their store", async () => {
    const session = await catalogSession(manager, 3);
    if (!session.available) throw new Error("unavailable");
    expect(await verifyGatewayToken(session.token, SECRET, now())).toMatchObject({ scope: "catalog", sub: "u:5", vendor: 3 });
  });

  it("names the seller's own store even when asked for none", async () => {
    const session = await catalogSession(manager, null);
    if (!session.available) throw new Error("unavailable");
    expect((await verifyGatewayToken(session.token, SECRET, now()))!.vendor).toBe(3);
  });

  it("refuses a shopper, staff, a courier, and a seller asking for another store", async () => {
    const refusals: [Actor, number | null][] = [
      [{ kind: "customer", userId: 1 }, null],
      [{ kind: "vendor", userId: 6, vendorId: 3, role: "staff" }, 3],
      [{ kind: "courier", userId: 7, courierId: 1 }, null],
      [manager, 4],
    ];
    for (const [actor, vendorId] of refusals) {
      await expect(catalogSession(actor, vendorId)).rejects.toThrow("FORBIDDEN:product.create");
    }
  });

  it("lets an administrator draft for any store", async () => {
    const session = await catalogSession({ kind: "admin", userId: 1 }, 9);
    if (!session.available) throw new Error("unavailable");
    expect((await verifyGatewayToken(session.token, SECRET, now()))!.vendor).toBe(9);
  });
});
