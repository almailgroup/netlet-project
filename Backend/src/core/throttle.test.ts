/**
 * A request over one of `security.ts`'s ceilings is refused in the API's own
 * shape, which the site's client reads — not the limiter's plain text, which
 * it could not, so a shopper browsing quickly met "Unexpected token 'T'… is
 * not valid JSON" where a sentence belonged. Driven through the real app with
 * the site's own links: the stream a query rides and the batch a mutation does.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTRPCClient, httpBatchLink, httpBatchStreamLink, TRPCClientError } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../routes/index.js";

let server: Server;
let base = "";

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", "a-test-secret-for-signing-sessions-0123456789");
  vi.stubEnv("DATABASE_URL", "");
  vi.resetModules();
  const { createApp } = await import("./app.js");
  server = createApp().listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

const refusal = async (call: () => Promise<unknown>) => {
  try {
    await call();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(TRPCClientError);
    const failure = error as TRPCClientError<AppRouter>;
    return { message: failure.message, code: failure.data?.code };
  }
};

describe("a request over a ceiling", () => {
  it("is the API's own refusal, with words, on the stream and the batch alike", async () => {
    const stream = createTRPCClient<AppRouter>({ links: [httpBatchStreamLink({ url: `${base}/api/trpc`, transformer: superjson })] });
    const batch = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${base}/api/trpc`, transformer: superjson })] });
    /* The ceiling for everything else is 300 a minute from one address. */
    for (let sent = 0; sent < 300; sent += 50) {
      await Promise.all(Array.from({ length: 50 }, () => fetch(`${base}/api/trpc/ai.available`)));
    }
    expect(await refusal(() => stream.ai.available.query())).toEqual({ message: "error.tooManyRequests", code: "TOO_MANY_REQUESTS" });
    expect(await refusal(() => batch.customer.photo.remove.mutate())).toEqual({ message: "error.tooManyRequests", code: "TOO_MANY_REQUESTS" });
    /* Outside the API it is a key in JSON too. */
    const maps = await fetch(`${base}/api/maps/apple-token`);
    expect(maps.status).toBe(429);
    expect(await maps.json()).toEqual({ error: "error.tooManyRequests" });
  });

  /*
   * The ceiling counts a signed-in shopper on their own and everybody else by
   * address, so a mobile network's one address does not throttle every
   * shopper behind it. It read `req.cookies`, which nothing in this app sets —
   * the session cookie is parsed by hand — so every shopper was counted by
   * address. A cookie is counted on its own only when it is a session this
   * server signed, or a made-up one would be a fresh allowance each time.
   * Runs after the test above, with this address's allowance spent.
   */
  it("counts a signed-in shopper apart from their address, and a forged cookie with it", async () => {
    const { signSession } = await import("./auth.js");
    const { COOKIE_NAME } = await import("../../../Shared/const.js");
    const asked = (cookie?: string) => fetch(`${base}/api/trpc/ai.available`, { headers: cookie ? { cookie: `${COOKIE_NAME}=${cookie}` } : {} });
    expect((await asked()).status).toBe(429);
    expect((await asked(await signSession(41))).status).toBe(200);
    expect((await asked("not-a-session-this-server-signed")).status).toBe(429);
  });
});
