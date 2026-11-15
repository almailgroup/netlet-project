import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handle } from "./handle.js";
import type { Context } from "./handle.js";
import { memoryStore, sqlStore } from "./store.js";
import type { Store } from "./store.js";
import { staffKey, MAX_FAILURES } from "./auth.js";
import { testDb } from "./pglite.js";
import { checkDigit, parseTrackingNumber } from "../shared/tracking.js";
import { demoParcels } from "../shared/demo.js";
import { MAX_ASKS_PER_HOUR } from "./ai.js";
import { AI_ROUTE } from "./gateway.js";

const AI = { url: "https://gateway.test", secret: "s".repeat(48) };

type Asked = { url: string; authorization: string; body: Record<string, unknown> };

/** NetLet's Worker, as far as ShipLee can tell: one answer per call, and a record of what it was sent. */
function standInGateway(answer: (body: Record<string, unknown>) => unknown, status = 200) {
  const asked: Asked[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    asked.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") ?? "", body });
    if (status !== 200) return Response.json({ ok: false, error: { code: "model_unavailable", message: "x" } }, { status });
    return Response.json({ ok: true, data: { text: JSON.stringify(answer(body)) } });
  }) as typeof fetch;
  return { fetcher, asked };
}

const PASSWORD = "pine-green-desk-2026";
const BASE = "https://shiplee.delivery";
const closers: (() => Promise<void>)[] = [];
afterAll(async () => { for (const close of closers) await close(); });

type Kind = "postgres" | "demo";

async function storeOf(kind: Kind): Promise<Store> {
  if (kind === "demo") return memoryStore(new Date());
  const { db, close } = await testDb();
  closers.push(close);
  return sqlStore(db);
}

function sequence(...digits: number[]) {
  let i = 0;
  return () => digits[i++ % digits.length]!;
}

describe.each<Kind>(["postgres", "demo"])("the API against the %s store", kind => {
  let ctx: Context;
  let cookie = "";
  let clock = new Date("2026-11-14T09:00:00Z");

  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const init: RequestInit = { method, headers: { cookie, "x-real-ip": "10.0.0.1", ...headers } };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)["content-type"] = "application/json";
    }
    const response = await handle(new Request(BASE + path, init), ctx);
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  };

  const signIn = async () => {
    const response = await call("POST", "/api/staff/session", { password: PASSWORD });
    expect(response.status).toBe(204);
    cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  };

  const newShipment = (extra: Record<string, unknown> = {}) =>
    call("POST", "/api/staff/shipments", { senderName: "Dar Home", recipientName: "Fatima Al-Enezi", recipientPhone: "5512 3456", governorate: "hawalli", area: "Salmiya", address: "Block 10, Street 4", pieces: "2", cod: "12.5", ...extra });

  beforeEach(async () => {
    cookie = "";
    clock = new Date("2026-11-14T09:00:00Z");
    ctx = { store: await storeOf(kind), staff: staffKey({ STAFF_PASSWORD: PASSWORD }), contact: { phone: null, whatsapp: null, email: null }, ai: null, now: () => clock };
  });

  it("tracks a parcel and shows nothing about who it is for", async () => {
    await signIn();
    const created = await newShipment();
    expect(created.status).toBe(201);
    const number: string = created.body.trackingNumber;
    expect(parseTrackingNumber(number)).toEqual({ ok: true, number });
    cookie = "";
    const tracked = await call("GET", `/api/track/${number.toLowerCase()}`);
    expect(tracked.status).toBe(200);
    expect(Object.keys(tracked.body).sort()).toEqual(["area", "codFils", "createdAt", "events", "expectedOn", "governorate", "pieces", "senderName", "status", "trackingNumber"]);
    expect(tracked.body).toMatchObject({ status: "created", senderName: "Dar Home", area: "Salmiya", governorate: "hawalli", pieces: 2, codFils: 12_500 });
    expect(JSON.stringify(tracked.body)).not.toMatch(/Fatima|55123456|Block 10/);
  });

  it("answers a number that is not one, and one nobody has", async () => {
    expect((await call("GET", "/api/track/SL123")).body).toEqual({ error: "badNumber.shape" });
    expect((await call("GET", "/api/track/SL1111111112")).body).toEqual({ error: "badNumber.check" });
    const candidate = `SL123456789${checkDigit("123456789")}`;
    expect((await call("GET", `/api/track/${candidate}`)).status).toBe(404);
  });

  it("is reached through Vercel's rewrite as well as its own path", async () => {
    expect((await call("GET", "/api?route=health")).body).toMatchObject({ ok: true, store: kind });
    expect((await call("GET", "/api/health")).body).toMatchObject({ ok: true, store: kind });
  });

  it("keeps the desk shut without the password, and counts wrong ones", async () => {
    expect((await call("GET", "/api/staff/shipments")).status).toBe(401);
    expect((await call("POST", "/api/staff/session", { password: "not it at all" })).status).toBe(401);
    for (let i = 1; i < MAX_FAILURES; i++) await call("POST", "/api/staff/session", { password: `wrong ${i}` });
    /* Past the ceiling even the right password waits, or the answer would say which guess was right. */
    expect((await call("POST", "/api/staff/session", { password: PASSWORD })).body).toEqual({ error: "tooMany" });
    clock = new Date(clock.getTime() + 16 * 60 * 1000);
    await signIn();
    expect((await call("GET", "/api/staff/shipments")).status).toBe(200);
  });

  it("refuses a forged or lapsed session", async () => {
    await signIn();
    const [name, value] = cookie.split("=");
    const forged = `${name}=${value!.slice(0, -2)}AA`;
    expect((await call("GET", "/api/staff/shipments", undefined, { cookie: forged })).status).toBe(401);
    clock = new Date(clock.getTime() + 13 * 3600 * 1000);
    expect((await call("GET", "/api/staff/shipments")).status).toBe(401);
  });

  it("refuses a change sent as a form or from another site", async () => {
    await signIn();
    const form = await handle(new Request(`${BASE}/api/staff/shipments`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: "senderName=x" }), ctx);
    expect(form.status).toBe(403);
    const foreign = await call("POST", "/api/staff/shipments", { senderName: "x", governorate: "jahra" }, { origin: "https://evil.example", host: "shiplee.delivery" });
    expect(foreign.status).toBe(403);
    const own = await call("POST", "/api/staff/shipments", { senderName: "x", governorate: "jahra" }, { origin: BASE, host: "shiplee.delivery" });
    expect(own.status).toBe(201);
  });

  it("says each problem with a shipment under its own field", async () => {
    await signIn();
    const refused = await newShipment({ senderName: "", governorate: "riyadh", recipientPhone: "123" });
    expect(refused.status).toBe(422);
    expect(refused.body.problems).toEqual({ senderName: "form.senderNeeded", governorate: "form.governorateNeeded", recipientPhone: "form.phoneShape" });
  });

  it("draws another number when one is taken", async () => {
    await signIn();
    ctx.randomDigit = sequence(4, 8, 2, 0, 6, 1, 9, 3, 7);
    const first = await newShipment();
    const second = await newShipment();
    expect(second.status).toBe(500);
    ctx.randomDigit = sequence(4, 8, 2, 0, 6, 1, 9, 3, 7, 5, 5, 5, 5, 5, 5, 5, 5, 5);
    const third = await newShipment();
    expect(third.status).toBe(201);
    expect(third.body.trackingNumber).not.toBe(first.body.trackingNumber);
  });

  it("moves a parcel by its updates, newest by when they happened", async () => {
    await signIn();
    const { body: shipment } = await newShipment({ expectedOn: "2026-11-16" });
    const at = (hour: number) => new Date(Date.UTC(2026, 10, 14, hour)).toISOString();
    clock = new Date(at(12));
    await call("POST", `/api/staff/shipments/${shipment.id}/events`, { status: "picked_up", location: "Shuwaikh", happenedAt: at(10) });
    const out = await call("POST", `/api/staff/shipments/${shipment.id}/events`, { status: "out_for_delivery", location: "Salmiya", note: "Arriving this afternoon.", happenedAt: at(11) });
    expect(out.status).toBe(201);
    expect(out.body.status).toBe("out_for_delivery");
    expect(out.body.expectedOn).toBe("2026-11-16");
    /* An update entered late, for earlier, does not move the parcel backwards. */
    const late = await call("POST", `/api/staff/shipments/${shipment.id}/events`, { status: "in_transit", location: "Shuwaikh hub", happenedAt: at(10.5), expectedOn: "2026-11-14" });
    expect(late.body.status).toBe("out_for_delivery");
    expect(late.body.expectedOn).toBe("2026-11-14");
    expect(late.body.events.map((e: { status: string }) => e.status)).toEqual(["out_for_delivery", "in_transit", "picked_up", "created"]);
    const cleared = await call("POST", `/api/staff/shipments/${shipment.id}/events`, { status: "delivered", happenedAt: at(12), expectedOn: null });
    expect(cleared.body).toMatchObject({ status: "delivered", expectedOn: null });
    expect((await call("POST", `/api/staff/shipments/${shipment.id}/events`, { status: "delivered", happenedAt: at(14) })).body.problems).toEqual({ happenedAt: "form.timeFuture" });
    cookie = "";
    const tracked = await call("GET", `/api/track/${shipment.trackingNumber}`);
    expect(tracked.body.events[0]).toEqual({ status: "delivered", location: null, note: null, happenedAt: at(12) });
  });

  it("changes a shipment's details and finds it by any of them", async () => {
    await signIn();
    const { body: shipment } = await newShipment();
    const changed = await call("PATCH", `/api/staff/shipments/${shipment.id}`, { senderName: "Dar Home", governorate: "capital", area: "Sharq", recipientPhone: "99887766", pieces: "1" });
    expect(changed.body).toMatchObject({ governorate: "capital", area: "Sharq", recipientPhone: "99887766", recipientName: null, codFils: null });
    for (const q of ["dar", "9988", shipment.trackingNumber.slice(2, 8), "sharq"]) {
      const found = await call("GET", `/api/staff/shipments?q=${encodeURIComponent(q)}`);
      expect(found.body.rows.map((r: { id: number }) => r.id), q).toContain(shipment.id);
    }
    expect((await call("GET", "/api/staff/shipments?q=%25")).body.rows.map((r: { id: number }) => r.id)).not.toContain(shipment.id);
    expect((await call("GET", "/api/staff/shipments/99999")).status).toBe(404);
    expect((await call("GET", "/api/staff/shipments/abc")).status).toBe(404);
  });

  it("closes tracking and the desk when nothing is set up", async () => {
    const bare: Context = { store: null, staff: null, contact: { phone: null, whatsapp: null, email: null }, ai: AI };
    const track = await handle(new Request(`${BASE}/api/track/${demoParcels()[0]!.trackingNumber}`), bare);
    expect(track.status).toBe(503);
    const session = await handle(new Request(`${BASE}/api/staff/session`), bare);
    expect(await session.json()).toEqual({ open: false, signedIn: false, store: null, staff: false });
    /* ShipLee AI needs somewhere to count questions, so it is not offered without a store. */
    expect((await (await handle(new Request(`${BASE}/api/config`), bare)).json()).ai).toBe(false);
    const ask = await handle(new Request(`${BASE}/api/ai/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "Where is it?" }) }), bare);
    expect([ask.status, (await ask.json()).error]).toEqual([503, "ai.off"]);
  });

  it("answers ShipLee AI's questions from the parcel's public facts and nothing else", async () => {
    await signIn();
    const { body: shipment } = await newShipment({ expectedOn: "2026-11-15" });
    await call("POST", `/api/staff/shipments/${shipment.id}/events`, { status: "out_for_delivery", location: "Salmiya", note: "Driver is on the way.", happenedAt: "2026-11-14T08:30:00Z" });
    cookie = "";
    const gateway = standInGateway(() => ({ answer: "It is with a driver and expected tomorrow.", contact: false, suggestions: ["What do I pay at the door?", "Call 55123456?"] }));
    ctx.ai = AI;
    ctx.aiSeams = { fetcher: gateway.fetcher, now: () => clock.getTime() };
    expect((await call("GET", "/api/config")).body.ai).toBe(true);

    const asked = await call("POST", "/api/ai/ask", { question: "When will it arrive?", number: shipment.trackingNumber.toLowerCase(), lang: "en" });
    expect(asked.status).toBe(200);
    /* A suggestion carrying a phone number is dropped before the page sees it. */
    expect(asked.body).toEqual({ answer: "It is with a driver and expected tomorrow.", contact: false, suggestions: ["What do I pay at the door?"], number: shipment.trackingNumber });
    const sent = gateway.asked[0]!;
    expect(sent.url).toBe(`https://gateway.test${AI_ROUTE}`);
    expect(sent.authorization).toMatch(/^Bearer v1\./);
    expect(sent.body).toMatchObject({ json: true });
    const prompt = String(sent.body.prompt);
    expect(prompt).toContain(shipment.trackingNumber);
    expect(prompt).toContain("Out for delivery");
    expect(prompt).toContain("«Driver is on the way.»");
    expect(prompt).toContain("KWD");
    /* The recipient's name, phone and street never leave ShipLee. */
    expect(prompt).not.toMatch(/Fatima|55123456|5512|Block 10/);
    expect(String(sent.body.system)).toContain("ShipLee AI");

    /* A number typed into the question is found by itself. */
    await call("POST", "/api/ai/ask", { question: `Where is ${shipment.trackingNumber.slice(0, 6)} ${shipment.trackingNumber.slice(6)}?`, lang: "ar" });
    expect(String(gateway.asked[1]!.body.prompt)).toContain(`PARCEL ${shipment.trackingNumber}`);
    expect(String(gateway.asked[1]!.body.system)).toContain("Arabic");
  });

  it("refuses a question carrying contact details before it costs anything, and counts the rest", async () => {
    const gateway = standInGateway(() => ({ answer: "Fourteen days.", contact: true, suggestions: [] }));
    ctx.ai = AI;
    ctx.aiSeams = { fetcher: gateway.fetcher, now: () => clock.getTime() };
    for (const question of ["Call me on 9988 7766", "my email is me@example.com", "see www.example.com", "  "]) {
      const refused = await call("POST", "/api/ai/ask", { question });
      expect(refused.status, question).toBe(400);
    }
    expect((await call("POST", "/api/ai/ask", { question: "x".repeat(401) })).body).toEqual({ error: "ai.long" });
    expect(gateway.asked).toHaveLength(0);
    for (let i = 0; i < MAX_ASKS_PER_HOUR; i++) expect((await call("POST", "/api/ai/ask", { question: "How do I pay?" })).status).toBe(200);
    expect((await call("POST", "/api/ai/ask", { question: "How do I pay?" })).body).toEqual({ error: "ai.tooMany" });
    /* Another address has its own hour, and the hour passes. */
    expect((await call("POST", "/api/ai/ask", { question: "How do I pay?" }, { "x-real-ip": "10.0.0.2" })).status).toBe(200);
    clock = new Date(clock.getTime() + 61 * 60 * 1000);
    expect((await call("POST", "/api/ai/ask", { question: "How do I pay?" })).status).toBe(200);
    expect((await call("POST", "/api/ai/ask", { question: "How do I pay?" }, { origin: "https://evil.example", host: "shiplee.delivery" })).status).toBe(403);
  });

  it("says ShipLee AI could not answer when the gateway does not", async () => {
    ctx.ai = AI;
    ctx.aiSeams = { fetcher: standInGateway(() => ({}), 502).fetcher, now: () => clock.getTime() };
    expect(await call("POST", "/api/ai/ask", { question: "Where is it?" })).toMatchObject({ status: 502, body: { error: "ai.failed" } });
    ctx.aiSeams = { fetcher: standInGateway(() => ({ answer: "" })).fetcher, now: () => clock.getTime() };
    expect(await call("POST", "/api/ai/ask", { question: "Where is it?" })).toMatchObject({ status: 502, body: { error: "ai.failed" } });
  });

  it("reads an order message into the form for signed-in staff only, held to the form's rules", async () => {
    const gateway = standInGateway(() => ({
      senderName: "Dar Home", recipientName: "Noura", recipientPhone: "+965 5512 3456", governorate: "Hawalli", area: "Salmiya",
      address: "Block 10, Street 4, House 7", pieces: "2", cod: "12.5 KD", expectedOn: "2026-11-13",
    }));
    ctx.ai = AI;
    ctx.aiSeams = { fetcher: gateway.fetcher, now: () => clock.getTime() };
    const message = "Order from Dar Home\nNoura 55123456\nSalmiya block 10 street 4 house 7\n2 boxes, collect 12.5";
    expect((await call("POST", "/api/staff/ai/intake", { message })).status).toBe(401);
    await signIn();
    const read = await call("POST", "/api/staff/ai/intake", { message });
    expect(read.status).toBe(200);
    expect(read.body.draft).toEqual({ senderName: "Dar Home", recipientName: "Noura", recipientPhone: "55123456", governorate: "hawalli", area: "Salmiya", address: "Block 10, Street 4, House 7", pieces: "2", cod: "12.500" });
    expect(read.body.found).not.toContain("expectedOn");
    expect(String(gateway.asked[0]!.body.prompt)).toContain("Salmiya block 10");
    expect((await call("POST", "/api/staff/ai/intake", { message: " " })).body).toEqual({ error: "intake.empty" });
    ctx.aiSeams = { fetcher: standInGateway(() => ({ senderName: "", governorate: "Riyadh" })).fetcher, now: () => clock.getTime() };
    expect((await call("POST", "/api/staff/ai/intake", { message })).body).toEqual({ error: "intake.nothing" });
  });

  it("counts the day, groups the list by status and exports what it shows", async () => {
    await signIn();
    const today = (hour: number) => new Date(Date.UTC(2026, 10, 14, hour)).toISOString();
    clock = new Date(today(10));
    /* The demo store starts with sample parcels of its own, so the day is counted from before and after. */
    const before = (await call("GET", "/api/staff/summary")).body;
    const groupsBefore = (await call("GET", "/api/staff/shipments")).body.counts;
    const a = (await newShipment()).body;
    const b = (await newShipment({ cod: "" })).body;
    const c = (await newShipment({ senderName: "=HYPERLINK(1)" })).body;
    clock = new Date(today(11));
    await call("POST", `/api/staff/shipments/${a.id}/events`, { status: "out_for_delivery", happenedAt: today(10.5) });
    await call("POST", `/api/staff/shipments/${b.id}/events`, { status: "attempted", happenedAt: today(10.5) });
    await call("POST", `/api/staff/shipments/${c.id}/events`, { status: "delivered", happenedAt: today(10.5) });
    const summary = (await call("GET", "/api/staff/summary")).body;
    expect(summary.outNow - before.outNow).toBe(1);
    expect(summary.cashOutFils - before.cashOutFils).toBe(12_500);
    expect(summary.deliveredToday - before.deliveredToday).toBe(1);
    expect(summary.attention - before.attention).toBe(1);
    expect(summary.bookedToday - before.bookedToday).toBe(3);
    /* Each of the three moved on from waiting for pickup. */
    expect(summary.waiting).toBe(before.waiting);

    const out = await call("GET", "/api/staff/shipments?group=out");
    const outIds = out.body.rows.map((r: { id: number }) => r.id);
    expect(outIds).toContain(a.id);
    expect(outIds).not.toContain(b.id);
    expect(out.body.total).toBe(groupsBefore.out + 1);
    expect(out.body.counts).toMatchObject({ out: groupsBefore.out + 1, attention: groupsBefore.attention + 1, delivered: groupsBefore.delivered + 1, all: groupsBefore.all + 3 });
    expect(out.body.counts.all).toBe(Object.entries(out.body.counts).filter(([key]) => key !== "all").reduce((sum, [, n]) => sum + (n as number), 0));
    const searched = await call("GET", "/api/staff/shipments?group=nonsense&q=HYPERLINK");
    expect(searched.body.rows.map((r: { id: number }) => r.id)).toEqual([c.id]);

    const response = await handle(new Request(`${BASE}/api/staff/export?group=delivered&q=HYPERLINK&lang=ar`, { headers: { cookie } }), ctx);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toContain("shiplee-shipments-2026-11-14.csv");
    const bytes = new Uint8Array(await response.arrayBuffer());
    /* The byte-order mark Excel needs to read Arabic; text() would take it off. */
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("رقم التتبّع");
    /* A name that starts like a formula is written as text. */
    expect(lines[1]).toContain(`"'=HYPERLINK(1)"`);
    expect(lines[1]).toContain(c.trackingNumber);
    cookie = "";
    expect((await call("GET", "/api/staff/export")).status).toBe(401);
    expect((await call("GET", "/api/staff/summary")).status).toBe(401);
  });
});

describe("the demo store", () => {
  it("answers its sample parcels, each with a real number", async () => {
    const ctx: Context = { store: memoryStore(), staff: null, contact: { phone: null, whatsapp: null, email: null }, ai: null };
    const config = await (await handle(new Request(`${BASE}/api/config`), ctx)).json();
    expect(config.demo).toBe(true);
    for (const number of config.samples) {
      expect(parseTrackingNumber(number)).toEqual({ ok: true, number });
      expect((await handle(new Request(`${BASE}/api/track/${number}`), ctx)).status).toBe(200);
    }
  });
});
