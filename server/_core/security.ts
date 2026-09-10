/**
 * Production hardening for the Express app.
 *
 * Everything here is inert in development and switched on by NODE_ENV, except
 * the rate limiters, which run everywhere so their behaviour is exercised
 * before it matters.
 */
import compression from "compression";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import helmet from "helmet";
import type { Express, RequestHandler } from "express";
import { ENV } from "./env";
import { COOKIE_NAME } from "@shared/const";

/**
 * Sources the storefront legitimately loads from.
 *
 * Kept explicit rather than permissive: the point of a CSP is that anything
 * not listed cannot run, so a script injected through a product title or a
 * review has nowhere to phone home. `'unsafe-inline'` is present for styles
 * only — React sets element styles directly for the gallery lens and the
 * card fade, and there is no nonce plumbing on a static index.html.
 */
const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
  // Product imagery: whatever MEDIA_HOST names, or any https origin while
  // that is unset — see ENV.mediaHost. The demo catalog draws its own
  // artwork as inline SVG data URIs.
  imgSrc: ["'self'", "data:", "blob:", ENV.mediaHost || "https:"],
  // Nothing off-origin to talk to: the catalog, the cart and checkout are
  // all NetLet's own API now.
  connectSrc: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  upgradeInsecureRequests: [],
} as const;

/**
 * Sign-in and registration, throttled per address rather than per request.
 *
 * scrypt already costs about 115ms a hash, which caps throughput on its own,
 * but not low enough to make an online guessing attack pointless. Keyed on the
 * client IP; behind the tunnel that is only the real client once `trust proxy`
 * is set, which `applySecurity` does.
 */
export const authRateLimit: RequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again in a few minutes." },
});

/** A far looser ceiling for everything else, to blunt scraping and floods. */
export const apiRateLimit: RequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Signed-in shoppers get their own bucket, so one busy office network does
  // not throttle everyone behind it.
  keyGenerator: (req) => {
    const session = (req as { cookies?: Record<string, string> }).cookies?.[COOKIE_NAME];
    return session ? `session:${session.slice(-32)}` : ipKeyGenerator(req.ip ?? "unknown");
  },
});

export function applySecurity(app: Express): void {
  const isProduction = process.env.NODE_ENV === "production";

  // The Mac mini sits behind a Cloudflare Tunnel, so the socket address is
  // always the tunnel. Without this every visitor shares one rate-limit
  // bucket and every log line records the same address. One hop, not `true`:
  // trusting every proxy header lets a client spoof its own address.
  app.set("trust proxy", 1);

  // Express advertises itself in a response header by default. Free
  // reconnaissance for anyone fingerprinting the stack.
  app.disable("x-powered-by");

  app.use(
    helmet({
      contentSecurityPolicy: isProduction ? { directives: CONTENT_SECURITY_POLICY } : false,
      // Vite's dev server needs a referrer; the default `no-referrer` breaks
      // the return journey.
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      // Only meaningful over HTTPS, which in development there is not.
      hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // 535KB of JavaScript uncompressed. gzip takes that to roughly a third, and
  // on a home connection serving Kuwait that is the difference between a fast
  // first load and a slow one.
  app.use(compression());
}
