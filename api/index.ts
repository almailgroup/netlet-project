/**
 * The Vercel entry point.
 *
 * Vercel's Node runtime accepts an Express app as a request handler, so this is
 * the same app `pnpm dev` runs — no second copy of the routes to drift.
 *
 * Built once per cold start, not per request: `createApp()` at module scope
 * means a warm instance reuses it, and the database pool inside it survives
 * with the instance rather than being rebuilt on every call.
 *
 * Static files never reach here. `vercel.json` sends only `/api/*` to this
 * function; everything else is served from the CDN, so the function is not
 * woken to hand back a stylesheet.
 */
import "dotenv/config";
import { createApp } from "../server/_core/app.js";

export default createApp();
