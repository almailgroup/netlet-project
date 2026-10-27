/**
 * Which maps the pin picker may offer, and the token Apple's map is opened with.
 *
 * The token is checked by verifying it — with the public half of a key made
 * here — rather than by reading it, because what matters is that MapKit would
 * accept it: ES256, Apple's key id in the header, the team as issuer, the page's
 * origin, and an expiry short enough that a copied token is soon worth nothing.
 */
import { generateKeyPairSync } from "node:crypto";
import { decodeProtectedHeader, importSPKI, jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const load = async () => {
  vi.resetModules();
  return import("./maps.js");
};

beforeEach(() => vi.unstubAllEnvs());
afterEach(() => vi.unstubAllEnvs());

describe("which maps are offered", () => {
  it("offers neither until a key is set, which is the OpenStreetMap fallback", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    vi.stubEnv("APPLE_MAPKIT_TOKEN", "");
    vi.stubEnv("APPLE_MAPKIT_TEAM_ID", "");
    expect((await load()).mapProviders()).toEqual({ google: null, apple: false, drivingTimes: false });
  });

  it("hands the browser Google's key, and only says whether Apple's map is on", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "browser-key");
    vi.stubEnv("APPLE_MAPKIT_TOKEN", "ready-made");
    expect((await load()).mapProviders()).toEqual({ google: "browser-key", apple: true, drivingTimes: false });
  });

  it("needs all three signing values before Apple's map counts as set up", async () => {
    vi.stubEnv("APPLE_MAPKIT_TOKEN", "");
    vi.stubEnv("APPLE_MAPKIT_TEAM_ID", "TEAM123456");
    vi.stubEnv("APPLE_MAPKIT_KEY_ID", "KEY1234567");
    vi.stubEnv("APPLE_MAPKIT_PRIVATE_KEY", "");
    expect((await load()).mapProviders().apple).toBe(false);
  });
});

describe("Apple's map token", () => {
  it("passes a ready-made token through as it is", async () => {
    vi.stubEnv("APPLE_MAPKIT_TOKEN", "ready-made");
    expect(await (await load()).appleMapToken("https://netlet.example")).toBe("ready-made");
  });

  it("is null while Apple's map is off", async () => {
    vi.stubEnv("APPLE_MAPKIT_TOKEN", "");
    vi.stubEnv("APPLE_MAPKIT_TEAM_ID", "");
    expect(await (await load()).appleMapToken("https://netlet.example")).toBeNull();
  });

  it("signs a half-hour ES256 token for the page's origin, with Apple's key id", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    vi.stubEnv("APPLE_MAPKIT_TOKEN", "");
    vi.stubEnv("APPLE_MAPKIT_TEAM_ID", "TEAM123456");
    vi.stubEnv("APPLE_MAPKIT_KEY_ID", "KEY1234567");
    /* As it arrives from a dashboard that keeps a PEM on one line. */
    vi.stubEnv("APPLE_MAPKIT_PRIVATE_KEY", pem.replace(/\n/g, "\\n"));

    const token = (await (await load()).appleMapToken("https://netlet.example"))!;
    expect(decodeProtectedHeader(token)).toEqual({ alg: "ES256", kid: "KEY1234567", typ: "JWT" });
    const verifier = await importSPKI(publicKey.export({ type: "spki", format: "pem" }).toString(), "ES256");
    const { payload } = await jwtVerify(token, verifier, { issuer: "TEAM123456" });
    expect(payload.origin).toBe("https://netlet.example");
    expect(payload.exp! - payload.iat!).toBe(30 * 60);
  });
});
