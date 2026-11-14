import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handle } from "./handle.js";
import type { Context } from "./handle.js";
import { memoryStore, sqlStore } from "./store.js";
import type { Store } from "./store.js";
import { staffKey, MAX_FAILURES } from "./auth.js";
import { testDb } from "./pglite.js";
import { checkDigit, parseTrackingNumber } from "../shared/tracking.js";
import { demoParcels } from "../shared/demo.js";

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
    ctx = { store: await storeOf(kind), staff: staffKey({ STAFF_PASSWORD: PASSWORD }), contact: { phone: null, whatsapp: null, email: null }, now: () => clock };
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
    const bare: Context = { store: null, staff: null, contact: { phone: null, whatsapp: null, email: null } };
    const track = await handle(new Request(`${BASE}/api/track/${demoParcels()[0]!.trackingNumber}`), bare);
    expect(track.status).toBe(503);
    const session = await handle(new Request(`${BASE}/api/staff/session`), bare);
    expect(await session.json()).toEqual({ open: false, signedIn: false, store: null, staff: false });
  });
});

describe("the demo store", () => {
  it("answers its sample parcels, each with a real number", async () => {
    const ctx: Context = { store: memoryStore(), staff: null, contact: { phone: null, whatsapp: null, email: null } };
    const config = await (await handle(new Request(`${BASE}/api/config`), ctx)).json();
    expect(config.demo).toBe(true);
    for (const number of config.samples) {
      expect(parseTrackingNumber(number)).toEqual({ ok: true, number });
      expect((await handle(new Request(`${BASE}/api/track/${number}`), ctx)).status).toBe(200);
    }
  });
});
