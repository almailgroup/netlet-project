/**
 * The Express app, without deciding how it is served.
 *
 * A long-lived process listens on a port; a serverless platform hands the same
 * app one request at a time and does the listening itself. Both want exactly
 * these routes and exactly this security, so the routes live here and the two
 * entry points differ only in what they do with the result:
 *
 *   server/_core/index.ts — adds Vite or static files, then listens
 *   api/index.ts          — exports it as a Vercel function
 *
 * Static files are deliberately not here. Where this runs behind a CDN, the CDN
 * serves them and the function should never be woken to hand back a .js file.
 */
import express, { type Express } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers.js";
import { createContext } from "./context.js";
import { applySecurity, apiRateLimit, authRateLimit } from "./security.js";
import { sql } from "drizzle-orm";
import { describeError } from "./describeError.js";
import { getDb } from "../db.js";

export function createApp(): Express {
  const app = express();

  // Before any route, so a blocked request never reaches application code.
  applySecurity(app);

  // 50mb was inherited from a template that proxied file uploads. Nothing here
  // accepts a file: the largest body the API sees is a cart mutation. Leaving
  // it meant any unauthenticated caller could make the process buffer 50MB per
  // request. 256kb is generous for JSON and bounded.
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ limit: "256kb", extended: true }));

  /*
   * Some platforms rewrite `/api/trpc/x` onto a function mounted at `/api` and
   * hand the app the rewritten path rather than the original. The router below
   * is mounted at `/api/trpc`, so on those platforms nothing would match and
   * every call would 404 — with no error to read, because a 404 is a valid
   * reply.
   *
   * Putting the prefix back costs one string comparison per request and makes
   * the app indifferent to which behaviour it gets.
   */
  app.use((req, _res, next) => {
    if (req.url.startsWith("/trpc")) req.url = `/api${req.url}`;
    next();
  });

  // Liveness. Any uptime monitor needs one URL that answers without touching
  // the database, so a red check means this process is down rather than a
  // dependency being slow.
  app.get(["/healthz", "/api/healthz"], (_req, res) => {
    res.json({ status: "ok", uptime: Math.round(process.uptime()) });
  });

  /**
   * Is the database actually reachable?
   *
   * Deliberately separate from `/healthz`, which must answer even when every
   * dependency is down — that is what makes a red check mean "this process is
   * gone" rather than "something it talks to is slow".
   *
   * It reports a verdict and never the reason. Connection strings, hostnames
   * and driver messages are not for an unauthenticated caller; the reason goes
   * to the log, where the operator can read it.
   */
  app.get(["/readyz", "/api/readyz"], async (_req, res) => {
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ database: "not configured" });
      return;
    }
    try {
      const db = await getDb();
      if (!db) throw new Error("no client");
      await db.execute(sql`select 1`);
      res.json({ database: "ok" });
    } catch (error) {
      console.error(`[readyz] database unreachable: ${describeError(error)}`);
      res.status(503).json({ database: "unreachable" });
    }
  });

  app.use("/api/trpc/auth.login", authRateLimit);
  app.use("/api/trpc/auth.register", authRateLimit);
  app.use("/api/trpc", apiRateLimit);
  /**
   * Server errors are logged, not just returned.
   *
   * tRPC catches a thrown error and answers 500 with a sanitised message, so
   * without this the platform log records an empty line and the real cause —
   * a Postgres failure, a bad credential — is visible nowhere. That turns any
   * production problem into a guessing game, which is exactly how this cost a
   * day.
   *
   * INTERNAL_SERVER_ERROR only: a 403 or a NOT_FOUND is the system working,
   * and logging those would bury the ones that are not.
   */
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError({ error, path, type }) {
        if (error.code !== "INTERNAL_SERVER_ERROR") return;
        console.error(`[trpc] ${type} ${path ?? "<no path>"} failed: ${describeError(error)}`);
      },
    }),
  );

  return app;
}
