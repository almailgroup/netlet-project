import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const SECRET = "v1,whsec_" + Buffer.from("a-secret-only-supabase-and-netlet-know").toString("base64");
const sent: { phone: string; text: string }[] = [];

vi.mock("./sms.js", () => ({ smsReady: () => true, sendText: async (phone: string, text: string) => { sent.push({ phone, text }); } }));
vi.mock("./env.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./env.js")>();
  return { ENV: { ...actual.ENV, smsHookSecret: SECRET } };
});

const { codeText, handleSmsHook, signedBy } = await import("./smsHook.js");

function signed(body: string, at = Math.floor(Date.now() / 1000), secret = SECRET) {
  const key = Buffer.from(/whsec_(.+)$/.exec(secret)![1], "base64");
  const id = "msg_2Xa";
  const signature = createHmac("sha256", key).update(`${id}.${at}.${body}`).digest("base64");
  return { "webhook-id": id, "webhook-timestamp": String(at), "webhook-signature": `v1,${signature}` };
}

afterEach(() => { sent.length = 0; });

describe("Supabase's Send SMS hook", () => {
  it("texts the code to a Kuwaiti mobile when Supabase signed the call", async () => {
    const body = JSON.stringify({ user: { phone: "96550808606" }, sms: { otp: "123456" } });
    expect(await handleSmsHook(signed(body), body)).toEqual({ status: 200, body: {} });
    expect(sent).toEqual([{ phone: "+96550808606", text: codeText("123456") }]);
    expect(codeText("123456").startsWith("123456")).toBe(true);
  });

  it("refuses anything unsigned, signed with another key, altered or stale", async () => {
    const body = JSON.stringify({ user: { phone: "96550808606" }, sms: { otp: "123456" } });
    expect((await handleSmsHook({}, body)).status).toBe(401);
    expect((await handleSmsHook(signed(body, undefined, "v1,whsec_" + Buffer.from("other").toString("base64")), body)).status).toBe(401);
    expect((await handleSmsHook(signed(body), body.replace("123456", "654321"))).status).toBe(401);
    expect(signedBy(SECRET, signed(body, 1_000), body)).toBe(false);
    expect(sent).toEqual([]);
  });

  it("refuses a number abroad even when signed, since that is where a text costs", async () => {
    const body = JSON.stringify({ user: { phone: "447700900123" }, sms: { otp: "123456" } });
    expect((await handleSmsHook(signed(body), body)).status).toBe(400);
    expect(sent).toEqual([]);
  });
});
