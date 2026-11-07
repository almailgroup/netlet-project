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
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { ENV } from "./env.js";
import { COOKIE_NAME } from "../../../Shared/const.js";
import { MAP_TILE_ORIGIN } from "../../../Shared/commerce/geo.js";
import { gatewayConfigured, gatewayOrigin } from "./aiGateway.js";

/**
 * Sources the storefront legitimately loads from.
 *
 * Kept explicit rather than permissive: the point of a CSP is that anything
 * not listed cannot run, so a script injected through a product title or a
 * review has nowhere to phone home. `'unsafe-inline'` is present for styles
 * only — React sets element styles directly for the gallery lens and the
 * card fade, and there is no nonce plumbing on a static index.html.
 */
/*
 * Google's "I'm not a robot" box on Create account, only while it is
 * configured: the script that draws it, and the frame it is drawn in. Unset, the
 * policy names nothing of Google's.
 */
const CAPTCHA_SCRIPTS = ENV.recaptchaSiteKey && ENV.recaptchaSecretKey
  ? ["https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/"]
  : [];
const CAPTCHA_FRAMES = CAPTCHA_SCRIPTS.length ? ["https://www.google.com/recaptcha/", "https://recaptcha.google.com/recaptcha/"] : [];

/*
 * Sign in with Apple on the website, only while a Services ID is set: Apple's
 * own script, and the page it opens. The page is a popup that hands the answer
 * back to this window, which needs the opener kept — see the opener policy
 * below.
 */
const APPLE_WEB_SIGN_IN = Boolean(ENV.appleSigninServicesId);
const APPLE_SIGN_IN_SCRIPTS = APPLE_WEB_SIGN_IN ? ["https://appleid.cdn-apple.com"] : [];
const APPLE_SIGN_IN_FRAMES = APPLE_WEB_SIGN_IN ? ["https://appleid.apple.com"] : [];
/* Sign in with Google on the website is a popup onto Google's own page, which
   hands the token back to `/google-return.html` on this origin — nothing of
   Google's runs in this page, so the policy names nothing of Google's. */
const GOOGLE_WEB_SIGN_IN = Boolean(ENV.googleSigninWebClientId);
/* Sign in with Microsoft is the same shape, to `/microsoft-return.html`. */
const MICROSOFT_WEB_SIGN_IN = Boolean(ENV.microsoftSigninClientId);

/*
 * The pin picker's two maps (3.2.7), each only while its keys are set — the
 * hosts Google and Apple publish for their map scripts, tiles and data. Both
 * draw tiles in workers built from blobs.
 */
const GOOGLE_MAPS = Boolean(ENV.googleMapsKey);
const APPLE_MAPS = Boolean(ENV.appleMapkitToken || (ENV.appleMapkitTeamId && ENV.appleMapkitKeyId && ENV.appleMapkitPrivateKey));
const MAP_SCRIPTS = [
  ...(GOOGLE_MAPS ? ["https://*.googleapis.com", "https://*.gstatic.com", "https://*.google.com", "https://*.ggpht.com", "https://*.googleusercontent.com"] : []),
  ...(APPLE_MAPS ? ["https://cdn.apple-mapkit.com"] : []),
];
const MAP_CONNECT = [
  ...(GOOGLE_MAPS ? ["https://*.googleapis.com", "https://*.google.com", "https://*.gstatic.com"] : []),
  ...(APPLE_MAPS ? ["https://*.apple-mapkit.com", "https://*.ls.apple.com"] : []),
];
const MAP_IMAGES = [
  ...(GOOGLE_MAPS ? ["https://*.googleapis.com", "https://*.gstatic.com", "https://*.google.com", "https://*.googleusercontent.com"] : []),
  ...(APPLE_MAPS ? ["https://*.apple-mapkit.com", "https://*.ls.apple.com"] : []),
];
const MAP_FRAMES = GOOGLE_MAPS ? ["https://*.google.com"] : [];

/* The AI gateway (`Backend/gateway/`), which the browser streams the
   assistant's answers from — only while it is configured. */
const AI_GATEWAY = gatewayConfigured() ? [gatewayOrigin()!] : [];
const MAP_WORKERS = GOOGLE_MAPS || APPLE_MAPS ? ["blob:"] : [];

const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", ...CAPTCHA_SCRIPTS, ...MAP_SCRIPTS, ...APPLE_SIGN_IN_SCRIPTS],
  frameSrc: ["'self'", ...CAPTCHA_FRAMES, ...MAP_FRAMES, ...APPLE_SIGN_IN_FRAMES],
  workerSrc: ["'self'", ...MAP_WORKERS],
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
  // Product imagery: whatever MEDIA_HOST names, or any https origin while
  // that is unset — see ENV.mediaHost. The demo catalog draws its own
  // artwork as inline SVG data URIs.
  // The map picker's tiles (3.2.7) come from one named host, which has to be
  // listed once MEDIA_HOST narrows the rest.
  imgSrc: ["'self'", "data:", "blob:", ...(ENV.mediaHost ? [ENV.mediaHost, MAP_TILE_ORIGIN, ...MAP_IMAGES] : ["https:"])],
  // The catalog, the cart and checkout are all NetLet's own API; off-origin
  // is only the maps and the AI gateway, each while it is configured.
  connectSrc: ["'self'", ...MAP_CONNECT, ...AI_GATEWAY, ...APPLE_SIGN_IN_FRAMES],
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
 *
 * **This is the coarse layer, and it counts in memory.** One long-lived server
 * is what `express-rate-limit`'s default store assumes: a `Map` that lives as
 * long as the process. Served from a pool of short-lived instances instead,
 * every instance starts with an empty one, so the real ceiling is this number
 * times however many are warm and it resets whenever one recycles. Good enough
 * to blunt a flood before it reaches application code; not something to rely
 * on for credential guessing, which `Backend/src/services/rateLimit.ts` counts in Postgres
 * where every instance can see it.
 */
/** Which ceiling a request is over, written on it for `createContext` to read. */
export type Throttled = "auth" | "api";
type Marked = { netletThrottled?: Throttled };

export function throttledAs(req: unknown): Throttled | undefined {
  return (req as Marked).netletThrottled;
}

/**
 * What a request over a ceiling is answered with. **The API's own refusal,
 * never the limiter's**: the limiter answered in plain text ("Too many
 * requests…") and the site's client could read none of it, so a shopper
 * browsing quickly — or one of many behind a mobile network's one address —
 * met "Unexpected token 'T'… is not valid JSON" where a sentence belonged,
 * and a page that drew it as a failure. Found by the browser sweep, which
 * browses as quickly as anybody. A tRPC request is marked and passed on, and
 * the base procedure refuses it as `TOO_MANY_REQUESTS` with a message key, in
 * the shape a batch and a stream both read; `createContext` skips the session
 * lookup for it, so a flood still costs no database read. Anything else is
 * answered here, as JSON with a key.
 */
const overCeiling = (kind: Throttled) => (req: Request, res: Response, next: NextFunction) => {
  if (req.originalUrl.startsWith("/api/trpc")) {
    const marked = req as Marked;
    marked.netletThrottled = marked.netletThrottled ?? kind;
    next();
    return;
  }
  res.status(429).json({ error: kind === "auth" ? "auth.tooManyAttempts" : "error.tooManyRequests" });
};

export const authRateLimit: RequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: overCeiling("auth"),
});

/**
 * Signing in, counted on failures alone — the Postgres throttle's rule
 * (`rateLimit.ts`). Counting every sign-in meant twenty people signing in
 * correctly from one office, or one mobile network's shared address, locked
 * the next one out for a quarter of an hour; a wrong password is what a
 * guessing attack is made of, and only that is counted now.
 */
export const signInRateLimit: RequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: overCeiling("auth"),
});

/** A far looser ceiling for everything else, to blunt scraping and floods. */
export const apiRateLimit: RequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: overCeiling("api"),
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
      /* Apple's sign-in window answers this one through its opener, and
         Google's and Microsoft's popups are watched for being closed, all of
         which the default same-origin policy would cut. Kept tight while
         there is no such button. */
      crossOriginOpenerPolicy: { policy: APPLE_WEB_SIGN_IN || GOOGLE_WEB_SIGN_IN || MICROSOFT_WEB_SIGN_IN ? "same-origin-allow-popups" : "same-origin" },
    }),
  );

  // 535KB of JavaScript uncompressed. gzip takes that to roughly a third, and
  // on a home connection serving Kuwait that is the difference between a fast
  // first load and a slow one.
  //
  // Except a streamed tRPC batch. Its answers go out one at a time as each
  // procedure finishes, so one slow query cannot hold the rest of a page on
  // "Loading…" — and gzip buffers until the end unless something flushes it,
  // which the tRPC adapter does not, so compressing the stream quietly turned
  // it back into the all-or-nothing batch it replaced.
  app.use(compression({
    filter: (req, res) => req.headers["trpc-accept"] === "application/jsonl" ? false : compression.filter(req, res),
  }));
}
