import { describe, expect, it } from "vitest";
import {
  MAX_CHAT_TURNS,
  MAX_IMAGES,
  TOKEN_TTL_SECONDS,
  checkCatalogRequest,
  checkChatRequest,
  createSseReader,
  parseChatEvent,
  signGatewayToken,
  sseEvent,
  verifyGatewayToken,
  type GatewayClaims,
} from "./gateway.js";

const SECRET = "s".repeat(40);
const NOW = 1_800_000_000;
const claims = (overrides: Partial<GatewayClaims> = {}): GatewayClaims => ({ v: 1, scope: "chat", sub: "u:42", vendor: null, exp: NOW + TOKEN_TTL_SECONDS, ...overrides });

describe("gateway tokens", () => {
  it("verifies what it signed", async () => {
    const token = await signGatewayToken(claims(), SECRET);
    expect(await verifyGatewayToken(token, SECRET, NOW)).toEqual(claims());
  });

  it("refuses another secret, a changed claim and a changed signature", async () => {
    const token = await signGatewayToken(claims(), SECRET);
    expect(await verifyGatewayToken(token, "t".repeat(40), NOW)).toBeNull();
    const [version, , signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify(claims({ scope: "catalog", vendor: 7 }))).toString("base64url");
    expect(await verifyGatewayToken(`${version}.${forged}.${signature}`, SECRET, NOW)).toBeNull();
    const flipped = signature.startsWith("A") ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    expect(await verifyGatewayToken(`${token.split(".").slice(0, 2).join(".")}.${flipped}`, SECRET, NOW)).toBeNull();
  });

  it("refuses an expired token, and one that lives longer than any token is minted for", async () => {
    expect(await verifyGatewayToken(await signGatewayToken(claims({ exp: NOW - 60 }), SECRET), SECRET, NOW)).toBeNull();
    expect(await verifyGatewayToken(await signGatewayToken(claims({ exp: NOW + 86_400 }), SECRET), SECRET, NOW)).toBeNull();
    /* A clock a few seconds behind Cloudflare's is not a forgery. */
    expect(await verifyGatewayToken(await signGatewayToken(claims({ exp: NOW - 5 }), SECRET), SECRET, NOW)).not.toBeNull();
  });

  it("refuses garbage, an oversized token and a short secret", async () => {
    for (const junk of ["", "v1", "v1..", "v2.a.b", "v1.a.b.c", "v1.!!!.???", "v1.e30.e30"]) {
      expect(await verifyGatewayToken(junk, SECRET, NOW)).toBeNull();
    }
    expect(await verifyGatewayToken(`v1.${"a".repeat(2000)}.b`, SECRET, NOW)).toBeNull();
    const token = await signGatewayToken(claims(), SECRET);
    expect(await verifyGatewayToken(token, "short", NOW)).toBeNull();
    await expect(signGatewayToken(claims(), "short")).rejects.toThrow();
  });

  it("refuses well-signed claims of the wrong shape", async () => {
    for (const bad of [{ sub: "x:1" }, { sub: "u:" }, { vendor: -1 }, { vendor: 1.5 }, { scope: "admin" }]) {
      const token = await signGatewayToken({ ...claims(), ...bad } as GatewayClaims, SECRET);
      expect(await verifyGatewayToken(token, SECRET, NOW)).toBeNull();
    }
  });
});

describe("checkChatRequest", () => {
  const ask = { locale: "en", messages: [{ role: "user", text: "How do returns work?" }] };

  it("takes a question, and a conversation ending on one", () => {
    expect(checkChatRequest(ask).ok).toBe(true);
    const longer = { ...ask, messages: [{ role: "user", text: "hi" }, { role: "assistant", text: "Hello" }, { role: "user", text: "returns?" }] };
    expect(checkChatRequest(longer).ok).toBe(true);
  });

  it("names the first thing wrong", () => {
    const field = (body: unknown) => { const checked = checkChatRequest(body); return checked.ok ? null : checked.field; };
    expect(field(null)).toBe("body");
    expect(field({ ...ask, locale: "fr" })).toBe("locale");
    expect(field({ ...ask, messages: [] })).toBe("messages");
    expect(field({ ...ask, messages: [{ role: "assistant", text: "hi" }] })).toBe("messages");
    expect(field({ ...ask, messages: [{ role: "system", text: "hi" }] })).toBe("messages.0.role");
    expect(field({ ...ask, messages: [{ role: "user", text: "  " }] })).toBe("messages.0.text");
    expect(field({ ...ask, messages: [{ role: "user", text: "x".repeat(1001) }] })).toBe("messages.0.text");
    expect(field({ ...ask, messages: Array.from({ length: MAX_CHAT_TURNS + 1 }, () => ({ role: "user", text: "q" })) })).toBe("messages");
    expect(field({ ...ask, product: { title: "", category: null, vendor: null, description: "", specs: [] } })).toBe("product.title");
  });

  it("keeps only the fields it knows", () => {
    const checked = checkChatRequest({ ...ask, messages: [{ role: "user", text: "q", injected: true }], extra: 1 });
    expect(checked.ok && checked.value).toEqual({ locale: "en", messages: [{ role: "user", text: "q" }], product: null });
  });
});

describe("checkCatalogRequest", () => {
  const slugs = ["electronics", "beauty"];
  const field = (body: unknown) => { const checked = checkCatalogRequest(body, slugs); return checked.ok ? null : checked.field; };

  it("takes notes, photos or both", () => {
    expect(field({ locale: "ar", notes: "Samsung S26 Ultra 256GB black" })).toBeNull();
    expect(field({ locale: "en", notes: "", images: [{ mimeType: "image/webp", data: "AAAA" }] })).toBeNull();
    expect(field({ locale: "en", notes: "x", department: "electronics" })).toBeNull();
  });

  it("refuses an empty request, an unknown department and a bad photo", () => {
    expect(field({ locale: "en", notes: "   " })).toBe("notes");
    expect(field({ locale: "en", notes: "x", department: "weapons" })).toBe("department");
    expect(field({ locale: "en", notes: "x", images: [{ mimeType: "image/svg+xml", data: "AAAA" }] })).toBe("images.0.mimeType");
    expect(field({ locale: "en", notes: "x", images: [{ mimeType: "image/png", data: "not base64!" }] })).toBe("images.0.data");
    expect(field({ locale: "en", notes: "x", images: Array.from({ length: MAX_IMAGES + 1 }, () => ({ mimeType: "image/png", data: "AAAA" })) })).toBe("images");
  });
});

describe("Server-Sent Events", () => {
  it("reads events however the chunks fall", () => {
    const text = sseEvent({ type: "delta", text: "Hello" }) + sseEvent({ type: "delta", text: " world\nagain" }) + sseEvent({ type: "done", finish: "stop" });
    for (const size of [1, 3, 7, text.length]) {
      const seen: string[] = [];
      const reader = createSseReader(data => seen.push(data));
      for (let at = 0; at < text.length; at += size) reader.push(text.slice(at, at + size));
      reader.end();
      expect(seen.map(parseChatEvent)).toEqual([
        { type: "delta", text: "Hello" },
        { type: "delta", text: " world\nagain" },
        { type: "done", finish: "stop" },
      ]);
    }
  });

  it("reads CRLF events and a last event with no blank line after it", () => {
    const seen: string[] = [];
    const reader = createSseReader(data => seen.push(data));
    reader.push('data: {"a":1}\r\n\r\ndata: {"a":2}');
    reader.end();
    expect(seen).toEqual(['{"a":1}', '{"a":2}']);
  });

  it("ignores an event it does not know rather than throwing", () => {
    expect(parseChatEvent("not json")).toBeNull();
    expect(parseChatEvent('{"type":"delta"}')).toBeNull();
    expect(parseChatEvent('{"type":"error","code":"made_up"}')).toBeNull();
    expect(parseChatEvent('{"type":"error","code":"rate_limited"}')).toEqual({ type: "error", code: "rate_limited" });
  });
});
