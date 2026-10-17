/**
 * "Refine with NetLet AI"'s ceiling, against a real Postgres.
 *
 * Every refinement spends at a third party, so an endpoint open to a
 * signed-out browser needs a ceiling that counts somewhere every instance
 * shares — a `Map` in one short-lived serverless process is not a ceiling, it
 * is a ceiling times however many are warm.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authAttempts } from "../drizzle/schema.js";
import { MAX_SEARCH_REFINE_PER_ADDRESS } from "../shared/auth/rateLimit.js";

let db: ReturnType<typeof drizzle>;
let limits: typeof import("./rateLimit.js");

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../drizzle");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", async importOriginal => ({
    ...(await importOriginal<typeof import("./db.js")>()),
    getDb: async () => db,
  }));
  limits = await import("./rateLimit.js");
}, 60_000);

beforeEach(async () => { await db.delete(authAttempts); });

const ADDRESS = "203.0.113.9";

/* "Refine with NetLet AI" was the one model call open to a signed-out
   browser with no ceiling at all. */
describe("the search refinement's hourly ceiling", () => {
  it("refuses once the address has spent its hour's worth, and only that address", async () => {
    for (let i = 0; i < MAX_SEARCH_REFINE_PER_ADDRESS; i += 1) await limits.recordSearchRefine(ADDRESS);
    expect((await limits.checkSearchRefineAllowed(ADDRESS)).allowed).toBe(false);
    expect((await limits.checkSearchRefineAllowed("198.51.100.4")).allowed).toBe(true);
  });

  /* Sign-in throttling and refinement throttling must not drain each other. */
  it("counts separately from sign-in attempts on the same address", async () => {
    for (let i = 0; i < MAX_SEARCH_REFINE_PER_ADDRESS; i += 1) await limits.recordSearchRefine(ADDRESS);
    expect((await limits.checkAuthAllowed({ address: ADDRESS }, "login")).allowed).toBe(true);
  });
});
