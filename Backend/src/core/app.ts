/**
 * The Express app, without deciding how it is served.
 *
 * A long-lived process listens on a port; a serverless platform hands the same
 * app one request at a time and does the listening itself. Both want exactly
 * these routes and exactly this security, so the routes live here and the two
 * entry points differ only in what they do with the result:
 *
 *   Backend/src/core/index.ts — adds Vite or static files, then listens
 *   api/index.ts          — exports it as a Vercel function
 *
 * Static files are deliberately not here. Where this runs behind a CDN, the CDN
 * serves them and the function should never be woken to hand back a .js file.
 */
import express, { type Express } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routes/index.js";
import { createContext } from "./context.js";
import { applySecurity, apiRateLimit, authRateLimit } from "./security.js";
import { appleMapToken } from "./maps.js";
import { sql } from "drizzle-orm";
import { describeError } from "./describeError.js";
import { getDb } from "../services/db.js";
import { sitemapEntries } from "../services/sitemap.js";
import { robotsTxt, sitemapXml } from "../../../Shared/sitemap.js";
import { timingSafeEqual } from "node:crypto";
import { ENV } from "./env.js";
import { runDueSubscriptions } from "../services/subscriptions.js";
import { MediaError, readMedia, saveUpload } from "../services/media.js";
import { DocumentRefused, readDocument, uploadDocument } from "../services/applicationDocuments.js";
import { DOCUMENT_KINDS, DOCUMENT_TYPES, type DocumentKind } from "../../../Shared/inventory/applicationDocuments.js";
import { fetchManufacturerImage, ImportRefused } from "../services/manufacturerImages.js";
import { authenticateRequest } from "./auth.js";
import { resolveActor } from "../services/inventory.js";

/**
 * The origin to write into `robots.txt` and `sitemap.xml`.
 *
 * `SITE_URL` wins where a canonical host has been decided — a site reachable
 * on both a Vercel domain and a custom one should name the custom one in every
 * sitemap, not whichever host the crawler happened to use. Unset, the request's
 * own host is right far more often than any value hard-coded at build time.
 *
 * `x-forwarded-proto` is trusted only because `applySecurity` sets
 * `trust proxy` to exactly one hop, so it is the tunnel or the platform
 * speaking, not the client.
 */
export function siteOrigin(req: { protocol: string; get(name: string): string | undefined }): string {
  const configured = process.env.SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

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

  /**
   * `robots.txt` and `sitemap.xml`, generated rather than committed.
   *
   * Both were static files, and both had gone stale the way static files do:
   * `robots.txt` pointed crawlers at a sitemap that did not exist, on a host
   * spelled with a repository name the project had already renamed away from.
   * Serving them from the app means the origin is whatever origin actually
   * answered the request, so a Vercel preview, the production domain and a
   * laptop each name themselves correctly with nothing to configure.
   */
  app.get("/robots.txt", (req, res) => {
    res.type("text/plain").send(robotsTxt(siteOrigin(req)));
  });

  app.get("/sitemap.xml", async (req, res) => {
    try {
      res.type("application/xml").send(sitemapXml(siteOrigin(req), await sitemapEntries()));
    } catch (error) {
      console.error(`[sitemap] could not be built: ${describeError(error)}`);
      res.status(503).type("text/plain").send("sitemap unavailable");
    }
  });

  /**
   * Uploaded product photos (3.3.4).
   *
   * A route of its own rather than a tRPC procedure, because a photo is bytes
   * and the API's JSON limit is 256 KB on purpose. Only the two image types it
   * stores are parsed at all; anything else never reaches the handler. The
   * session cookie is SameSite=Lax and the body's type is not one an HTML form
   * can send, so a page on another site cannot post here as somebody signed in.
   */
  app.post("/api/media", express.raw({ type: ["image/webp", "image/jpeg"], limit: "1600kb" }), async (req, res) => {
    try {
      const user = await authenticateRequest(req).catch(() => null);
      if (!user) { res.status(401).json({ error: "media.notAllowed" }); return; }
      if (!Buffer.isBuffer(req.body)) { res.status(415).json({ error: "media.notAnImage" }); return; }
      const source = req.headers["x-netlet-source"];
      const saved = await saveUpload(await resolveActor(user), new Uint8Array(req.body), req.headers["content-type"] ?? "", typeof source === "string" ? source : null);
      res.status(201).json(saved);
    } catch (error) {
      if (error instanceof MediaError) {
        res.status(error.reason === "media.notAllowed" ? 403 : error.reason === "media.tooMany" ? 429 : 400).json({ error: error.reason });
        return;
      }
      console.error(`[media] upload failed: ${describeError(error)}`);
      res.status(500).json({ error: "media.failed" });
    }
  });

  /**
   * One image from a manufacturer's page (3.1.10), fetched by NetLet's server
   * for the seller's browser to prepare like an upload. Nothing is stored
   * here: what is kept is what the seller then chooses to upload.
   *
   * A JSON body, which an HTML form on another site cannot send, and a
   * SameSite=Lax cookie a cross-site request does not carry. The bytes are
   * only ever one of the image types `sniffRemoteImage` recognised, served
   * under that type with `nosniff` and a sandbox, never cached.
   */
  app.post("/api/media/remote", async (req, res) => {
    try {
      if (!req.is("application/json")) { res.status(415).json({ error: "manufacturer.badUrl" }); return; }
      const user = await authenticateRequest(req).catch(() => null);
      if (!user) { res.status(401).json({ error: "media.notAllowed" }); return; }
      const url = typeof req.body?.url === "string" ? req.body.url : "";
      const image = await fetchManufacturerImage(await resolveActor(user), url);
      res.set({
        "Content-Type": image.type,
        "Content-Length": String(image.bytes.length),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      });
      res.end(image.bytes);
    } catch (error) {
      if (error instanceof ImportRefused) {
        res.status(error.reason === "media.notAllowed" ? 403 : error.reason === "manufacturer.tooMany" ? 429 : 400).json({ error: error.reason });
        return;
      }
      console.error(`[media] remote fetch failed: ${describeError(error)}`);
      res.status(502).json({ error: "manufacturer.unreachable" });
    }
  });

  /**
   * A seller application document (3.3.1): a licence, a civil ID, a bank
   * letter. The body is the file; its kind and name ride in headers, the name
   * URI-encoded. The same reasons the photo upload above is safe from another
   * site hold — no HTML form can send a PDF or image body type, and the
   * cookie is Lax — and the bytes, not the header, decide what it is.
   */
  const documentBody = express.raw({ type: [...DOCUMENT_TYPES], limit: "4100kb" });
  app.post("/api/applications/documents", (req, res, next) => documentBody(req, res, error => {
    /* An oversized body is refused by the parser before the handler runs; said as a key, not a bare 413. */
    if (error) { res.status(413).json({ error: "documents.tooLarge" }); return; }
    next();
  }), async (req, res) => {
    try {
      const user = await authenticateRequest(req).catch(() => null);
      if (!user) { res.status(401).json({ error: "documents.notFound" }); return; }
      if (!Buffer.isBuffer(req.body)) { res.status(415).json({ error: "documents.notAccepted" }); return; }
      const kind = String(req.headers["x-netlet-document-kind"] ?? "");
      if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) { res.status(400).json({ error: "documents.notAccepted" }); return; }
      let fileName: string | null = null;
      try { fileName = decodeURIComponent(String(req.headers["x-netlet-file-name"] ?? "")) || null; } catch { fileName = null; }
      const saved = await uploadDocument(user.id, { kind: kind as DocumentKind, fileName, declaredType: req.headers["content-type"] ?? "", bytes: new Uint8Array(req.body) });
      res.status(201).json(saved);
    } catch (error) {
      if (error instanceof DocumentRefused) {
        res.status(error.reason === "documents.tooMany" ? 429 : error.reason === "documents.locked" ? 409 : 400).json({ error: error.reason });
        return;
      }
      console.error(`[documents] upload failed: ${describeError(error)}`);
      res.status(500).json({ error: "documents.failed" });
    }
  });

  /**
   * One application document, to the applicant or an administrator only, and
   * always as a download: `attachment`, `nosniff` and a sandbox, so even a
   * file that got past the checks cannot run as a page on NetLet's origin.
   * Never cached anywhere but the reader's own browser session.
   */
  app.get("/api/applications/documents/:id", async (req, res) => {
    try {
      const user = await authenticateRequest(req).catch(() => null);
      const id = Number(req.params.id);
      const found = user && /^\d{1,9}$/.test(req.params.id) ? await readDocument(await resolveActor(user), id) : null;
      if (!found) { res.status(404).type("text/plain").send("Not found"); return; }
      const ascii = found.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
      res.set({
        "Content-Type": found.contentType,
        "Content-Length": String(found.bytes.length),
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(found.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
      });
      res.end(Buffer.from(found.bytes));
    } catch (error) {
      console.error(`[documents] read failed: ${describeError(error)}`);
      res.status(503).type("text/plain").send("Unavailable");
    }
  });

  /** A stored photo, cached for a year: an id is never reused for different bytes. */
  app.get("/media/:file", async (req, res) => {
    try {
      const found = await readMedia(req.params.file);
      if (!found) { res.status(404).type("text/plain").send("Not found"); return; }
      res.set({
        "Content-Type": found.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(found.bytes.length),
      });
      res.end(Buffer.from(found.bytes));
    } catch (error) {
      console.error(`[media] read failed: ${describeError(error)}`);
      res.status(503).type("text/plain").send("Unavailable");
    }
  });

  /**
   * The scheduler's door (3.1.19): place every standing order that has come
   * due. Vercel Cron calls it daily with `Authorization: Bearer $CRON_SECRET`;
   * anything else gets the same 404 an unknown path does, so the endpoint does
   * not confirm it exists. Unset secret, unset feature — the rule every value
   * in `.env.example` follows.
   */
  app.get("/api/cron/subscriptions", async (req, res) => {
    const expected = Buffer.from(ENV.cronSecret);
    const offered = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
    /* Lengths in bytes, not characters: `timingSafeEqual` throws on buffers of
       different sizes, and a header as many characters long as the secret in
       wider ones reached it — an unhandled rejection in an Express 4 handler,
       which hung the request and could take the process with it. */
    const same = expected.length > 0 && offered.length === expected.length
      && timingSafeEqual(offered, expected);
    if (!same) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    try {
      res.json(await runDueSubscriptions());
    } catch (error) {
      console.error(`[cron] subscriptions failed: ${describeError(error)}`);
      res.status(500).json({ error: "run failed" });
    }
  });

  /**
   * A MapKit JS token for Apple's map in the pin picker (3.2.7), signed here
   * so Apple's private key never reaches a browser. Bound to the origin that
   * asked, and half an hour long. 404 while Apple's map is off — the same
   * answer an unknown path gets.
   */
  app.get("/api/maps/apple-token", apiRateLimit, async (req, res) => {
    try {
      const token = await appleMapToken(`${req.protocol}://${req.get("host")}`);
      if (!token) {
        res.status(404).type("text/plain").send("Not found");
        return;
      }
      res.set("Cache-Control", "private, no-store").type("text/plain").send(token);
    } catch (error) {
      console.error(`[maps] could not sign an Apple Maps token: ${describeError(error)}`);
      res.status(500).type("text/plain").send("Token unavailable");
    }
  });

  app.use("/api/trpc/auth.login", authRateLimit);
  app.use("/api/trpc/auth.register", authRateLimit);
  app.use("/api/trpc/auth.verifyEmail", authRateLimit);
  app.use("/api/trpc/auth.resendCode", authRateLimit);
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
