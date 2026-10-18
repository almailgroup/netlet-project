/**
 * The scheduler's door, served by the real app.
 *
 * The secret is compared in constant time, and `timingSafeEqual` throws when
 * its two buffers differ in length — which a header the same number of
 * *characters* as the secret, in characters wider than a byte, used to reach.
 * In an Express 4 async handler that throw is an unhandled rejection, not a
 * response.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const SECRET = "s".repeat(32);
let server: Server;
let base = "";

beforeAll(async () => {
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("JWT_SECRET", "a-test-secret-for-signing-sessions-0123456789");
  vi.resetModules();
  const { createApp } = await import("./app.js");
  server = createApp().listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

const call = (authorization: string) =>
  fetch(`${base}/api/cron/subscriptions`, { headers: { authorization } });

describe("the subscriptions cron endpoint", () => {
  it("answers a wrong secret with a 404, whatever it is made of", async () => {
    expect((await call("Bearer wrong")).status).toBe(404);
    /* As many characters as the secret, twice as many bytes. */
    expect((await call(`Bearer ${"é".repeat(SECRET.length)}`)).status).toBe(404);
  });
});
