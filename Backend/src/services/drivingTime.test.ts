/**
 * Apple's driving time for tracking (3.4.3), through a stand-in for Apple's
 * Maps Server API — the sandbox these run in cannot reach it. What is checked
 * is the conversation: a signed `server_api` token traded for an access token,
 * the ETA asked with it, an answer kept for a minute, and every way Apple does
 * not answer being null, which the tracking falls back from to the distance.
 */
import { generateKeyPairSync } from "node:crypto";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transport } from "./drivingTime.js";

const driver = { lat: 29.3759, lng: 47.9774 };
const door = { lat: 29.3339, lng: 48.0763 };

type Seen = { url: string; bearer: string };
let seen: Seen[] = [];
let etaReply: { status: number; body: unknown } = { status: 200, body: { etas: [{ expectedTravelTimeSeconds: 1860, distanceMeters: 14200 }] } };
let tokenReply: { status: number; body: unknown } = { status: 200, body: { accessToken: "access-1", expiresInSeconds: 1800 } };

const apple: Transport = async (url, init) => {
  seen.push({ url, bearer: init.headers.Authorization.replace(/^Bearer /, "") });
  const reply = url.includes("/v1/token") ? tokenReply : etaReply;
  return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
};

async function load(signing = true) {
  vi.resetModules();
  if (signing) {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    vi.stubEnv("APPLE_MAPKIT_TEAM_ID", "TEAM123456");
    vi.stubEnv("APPLE_MAPKIT_KEY_ID", "KEY1234567");
    vi.stubEnv("APPLE_MAPKIT_PRIVATE_KEY", privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  } else {
    vi.stubEnv("APPLE_MAPKIT_TEAM_ID", "");
    vi.stubEnv("APPLE_MAPKIT_PRIVATE_KEY", "");
  }
  vi.stubEnv("APPLE_MAPKIT_TOKEN", "");
  const module = await import("./drivingTime.js");
  module.useTransport(apple);
  return module;
}

beforeEach(() => {
  seen = [];
  etaReply = { status: 200, body: { etas: [{ expectedTravelTimeSeconds: 1860, distanceMeters: 14200 }] } };
  tokenReply = { status: 200, body: { accessToken: "access-1", expiresInSeconds: 1800 } };
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("asking Apple", () => {
  it("trades a signed server token for an access token, then asks the ETA with it", async () => {
    const { drivingTime } = await load();
    expect(await drivingTime(driver, door, 1_000)).toEqual({ seconds: 1860, meters: 14200 });

    expect(seen.map(call => new URL(call.url).pathname)).toEqual(["/v1/token", "/v1/etas"]);
    const auth = seen[0].bearer;
    expect(decodeProtectedHeader(auth)).toEqual({ alg: "ES256", kid: "KEY1234567", typ: "JWT" });
    expect(decodeJwt(auth)).toMatchObject({ iss: "TEAM123456", scope: "server_api" });
    expect(decodeJwt(auth).origin).toBeUndefined();

    const eta = new URL(seen[1].url);
    expect(seen[1].bearer).toBe("access-1");
    expect(Object.fromEntries(eta.searchParams)).toEqual({
      origin: "29.3759,47.9774",
      destinations: "29.3339,48.0763",
      transportType: "Automobile",
    });
  });

  it("keeps an answer for a minute and the access token until shortly before it lapses", async () => {
    const { drivingTime } = await load();
    await drivingTime(driver, door, 0);
    await drivingTime(driver, door, 30_000);
    expect(seen).toHaveLength(2);
    await drivingTime(driver, door, 61_000);
    expect(seen.map(call => new URL(call.url).pathname)).toEqual(["/v1/token", "/v1/etas", "/v1/etas"]);
    await drivingTime({ lat: 29.36, lng: 48.0 }, door, 30 * 60_000);
    expect(seen.filter(call => call.url.includes("/v1/token"))).toHaveLength(2);
  });

  it("is null with no signing key, without asking anybody", async () => {
    const { drivingTime } = await load(false);
    expect(await drivingTime(driver, door)).toBeNull();
    expect(seen).toEqual([]);
  });
});

describe("every way Apple does not answer is null", () => {
  it("a body of another shape", async () => {
    for (const body of [{}, { etas: [] }, { etas: [{ expectedTravelTimeSeconds: "soon" }] }, { etas: [{ expectedTravelTimeSeconds: -5 }] }, null]) {
      const { drivingTime } = await load();
      etaReply = { status: 200, body };
      expect(await drivingTime(driver, door)).toBeNull();
    }
  });

  it("a lapsed access token, which is dropped so the next ask fetches another", async () => {
    const { drivingTime } = await load();
    etaReply = { status: 401, body: {} };
    expect(await drivingTime(driver, door, 0)).toBeNull();
    etaReply = { status: 200, body: { etas: [{ expectedTravelTimeSeconds: 600 }] } };
    expect(await drivingTime(driver, door, 1_000)).toEqual({ seconds: 600, meters: 0 });
    expect(seen.filter(call => call.url.includes("/v1/token"))).toHaveLength(2);
  });

  it("a key Apple refuses, or a spent quota, which pauses the asking for a quarter of an hour", async () => {
    const { drivingTime } = await load();
    tokenReply = { status: 401, body: {} };
    expect(await drivingTime(driver, door, 0)).toBeNull();
    expect(await drivingTime(driver, door, 60_000)).toBeNull();
    expect(seen).toHaveLength(1);
    tokenReply = { status: 200, body: { accessToken: "access-2", expiresInSeconds: 1800 } };
    expect(await drivingTime(driver, door, 16 * 60_000)).not.toBeNull();

    etaReply = { status: 429, body: {} };
    expect(await drivingTime({ lat: 29.3, lng: 48.0 }, door, 17 * 60_000)).toBeNull();
    const asked = seen.length;
    expect(await drivingTime({ lat: 29.31, lng: 48.0 }, door, 18 * 60_000)).toBeNull();
    expect(seen).toHaveLength(asked);
  });

  it("a timeout or a dropped connection", async () => {
    const { drivingTime, useTransport } = await load();
    useTransport(async () => { throw new Error("The operation was aborted due to timeout"); });
    expect(await drivingTime(driver, door)).toBeNull();
  });
});
