/**
 * `pnpm preflight` — configuration check for a self-hosted NetLet.
 *
 * Reports what is ready and what is missing, in the order it has to be fixed,
 * so setting the Mac mini up is one command rather than a guess about which
 * step silently failed. Checks configuration only — it opens no connections
 * beyond the port probe.
 *
 * Exits non-zero if anything blocking is wrong, so it can gate a deploy script.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { debtorProblem } from "../shared/commerce/payoutFile.js";
import { supportNumber } from "../shared/commerce/support.js";
import { SOCIAL_PLATFORMS, contactEmail, socialLink } from "../shared/commerce/contact.js";

const ROOT = path.resolve(import.meta.dirname, "..");

type Status = "ok" | "warn" | "blocked";
type Check = { status: Status; title: string; detail: string; fix?: string };

const checks: Check[] = [];
const add = (status: Status, title: string, detail: string, fix?: string) =>
  checks.push({ status, title, detail, fix });

/* ------------------------------------------------------------- toolchain --- */

/*
 * 22.12 was not arbitrary: `firebase-admin` pulled in `jwks-rsa`, CommonJS,
 * which did `require('jose')` on an ESM-only package, and `require()` of an ES
 * module arrived in 22.12 — below that the whole server was dead at load. That
 * dependency is gone and nothing here reaches for `require()` any more, so the
 * floor now simply matches `engines.node` and what Vercel runs. It is kept
 * because raising a floor later is harder than holding one.
 */
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(n => Number.parseInt(n, 10));
const nodeNewEnough = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 12);
if (nodeNewEnough) {
  add("ok", "Node", `v${process.versions.node}`);
} else {
  add("blocked", "Node", `v${process.versions.node} cannot require() an ES module — 22.12 or newer is required`,
    "Install Node 22 LTS: https://nodejs.org");
}

try {
  const pnpmVersion = execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim();
  add("ok", "pnpm", `v${pnpmVersion}`);
} catch {
  add("blocked", "pnpm", "not on PATH",
    "corepack enable && corepack prepare pnpm@latest --activate");
}

/* --------------------------------------------------------- configuration --- */

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
if (!databaseUrl) {
  add("blocked", "DATABASE_URL", "not set — there is no catalog without it",
    "Supabase -> Project Settings -> Database -> Connection string -> URI, then pnpm db:push");
} else if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
  // A pasted dashboard fragment rather than the URI is the usual shape here,
  // and it surfaces as a connect failure with no hint about why.
  add("blocked", "DATABASE_URL", "does not look like a postgres:// URI",
    "Copy the URI form, not the host and password separately");
} else {
  add("ok", "DATABASE_URL", "set — catalog, cart and accounts are on");
}

// Checked after the value itself: under launchd the environment can come from
// the plist instead, and a missing .env is then merely informational.
const envPath = path.join(ROOT, ".env");
if (existsSync(envPath)) {
  add("ok", ".env", "present");
} else if (databaseUrl) {
  add("ok", ".env", "absent, but DATABASE_URL is set in the environment");
} else {
  add("blocked", ".env", "missing, and nothing is set in the environment either",
    "cp .env.example .env, then fill in DATABASE_URL");
}

if (process.env.JWT_SECRET?.trim() || !process.env.DATABASE_URL?.trim()) {
  if (process.env.DATABASE_URL?.trim()) add("ok", "JWT_SECRET", "set");
} else {
  add("blocked", "JWT_SECRET", "a database is configured but sessions cannot be signed",
    "Set JWT_SECRET to a long random string: openssl rand -base64 32");
}

/* ------------------------------------------------------- supabase auth --- */

/*
 * All three or none: with any one missing the server quietly uses the local
 * password digest instead, which looks like "Supabase Auth isn't working"
 * rather than like a typo. Naming the missing one is the whole point.
 */
const supabaseAuthVars = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const supabaseAuthMissing = supabaseAuthVars.filter(name => !process.env[name]?.trim());

if (supabaseAuthMissing.length === 0) {
  const url = process.env.SUPABASE_URL ?? "";
  const anon = process.env.SUPABASE_ANON_KEY ?? "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!/^https:\/\//.test(url)) {
    add("blocked", "SUPABASE_URL", "is not an https URL",
      "Project Settings -> Data API -> Project URL, e.g. https://abcdefghijklm.supabase.co");
  } else if (new URL(url).pathname.replace(/\/+$/, "") !== "") {
    /*
     * The origin, not an endpoint on it. Every call appends its own path, so a
     * value carrying one produces `/rest/v1/auth/v1/admin/users` — a 404 from
     * PostgREST rather than an answer from the auth service. The RESTful
     * endpoint sits directly beside the Project URL on that settings page,
     * which is how this gets copied, and in production it surfaces as a
     * redacted 500 on the register form with the reason only in the log.
     */
    add("blocked", "SUPABASE_URL", `ends in ${new URL(url).pathname}, and should be the origin alone`,
      `Drop everything after the host: https://${new URL(url).host}`);
  } else if (anon === service) {
    /* The likeliest way to get this wrong, and the most expensive: the sign-in
       endpoint would then carry the key that owns the whole project. */
    add("blocked", "SUPABASE_SERVICE_ROLE_KEY", "is the same value as SUPABASE_ANON_KEY",
      "They are two different keys. Project Settings -> API Keys has both — anon/public and service_role");
  } else {
    add("ok", "Supabase Auth", `accounts are stored in ${new URL(url).host}`);
    /*
     * Create account sends a six-digit code and makes nothing until it comes
     * back. With "Confirm email" switched off, Supabase confirms every address
     * itself, sends no code, and the step cannot happen — accounts are made on
     * the spot, unproven. Asked of the project's public settings.
     */
    try {
      const settings = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/settings`, {
        headers: { apikey: anon, authorization: `Bearer ${anon}` },
        signal: AbortSignal.timeout(10_000),
      });
      const body = settings.ok ? ((await settings.json()) as { mailer_autoconfirm?: boolean }) : {};
      if (body.mailer_autoconfirm === true) {
        add("blocked", "Sign-up code", "\"Confirm email\" is off, so Supabase sends no code and accounts are made unproven",
          "Authentication -> Sign In / Providers -> Email -> turn on Confirm email; docs/SUPABASE-AUTH.md, under The sign-up code");
      } else if (body.mailer_autoconfirm === false) {
        add("ok", "Sign-up code", "Supabase emails a code before an account exists — the template must show {{ .Token }} (docs/SUPABASE-AUTH.md, under The sign-up code)");
      }
    } catch {
      add("warn", "Sign-up code", "could not ask Supabase whether Confirm email is on", "Check it by hand: docs/SUPABASE-AUTH.md, under The sign-up code");
    }
  }
} else if (supabaseAuthMissing.length === supabaseAuthVars.length) {
  add("warn", "Supabase Auth", "not set — registrations will not appear under Authentication in the Supabase dashboard, and sign-up codes go to the server's log instead of an inbox",
    "Optional, and the reason that page is empty. docs/SUPABASE-AUTH.md has the setup");
} else {
  add("blocked", "Supabase Auth", `partly set: ${supabaseAuthMissing.join(", ")} missing, so a different password store is used instead`,
    "Set all three, or clear them all — see docs/SUPABASE-AUTH.md");
}

/* ---------------------------------------------------- human check, maps --- */

{
  /* Google's "I'm not a robot" box on Create account. Both keys or neither: a
     site key alone draws a box the server cannot check. */
  const site = (process.env.RECAPTCHA_SITE_KEY ?? "").trim();
  const secret = (process.env.RECAPTCHA_SECRET_KEY ?? "").trim();
  if (site && secret) add("ok", "Human check", "Google reCAPTCHA is on for Create account");
  else if (site || secret) add("blocked", "Human check", `${site ? "RECAPTCHA_SECRET_KEY" : "RECAPTCHA_SITE_KEY"} missing, so the box is off`, "Both come from google.com/recaptcha/admin (v2, \"I'm not a robot\" checkbox)");
  else add("warn", "Human check", "RECAPTCHA_SITE_KEY and RECAPTCHA_SECRET_KEY not set — Create account has no \"I'm not a robot\" box", "google.com/recaptcha/admin -> v2 checkbox, with NetLet's domain");

  /* The pin picker's two maps. Neither is OpenStreetMap, which still works. */
  const google = Boolean((process.env.GOOGLE_MAPS_API_KEY ?? "").trim());
  const appleSigning = ["APPLE_MAPKIT_TEAM_ID", "APPLE_MAPKIT_KEY_ID", "APPLE_MAPKIT_PRIVATE_KEY"].filter(name => (process.env[name] ?? "").trim());
  const apple = Boolean((process.env.APPLE_MAPKIT_TOKEN ?? "").trim()) || appleSigning.length === 3;
  if (appleSigning.length > 0 && appleSigning.length < 3 && !apple) {
    add("blocked", "Maps", `Apple Maps partly set (${appleSigning.join(", ")}), so it is off`, "Set APPLE_MAPKIT_TOKEN alone, or all three of APPLE_MAPKIT_TEAM_ID, APPLE_MAPKIT_KEY_ID and APPLE_MAPKIT_PRIVATE_KEY");
  } else if (google || apple) {
    add("ok", "Maps", `the pin picker offers ${[google && "Google Maps", apple && "Apple Maps"].filter(Boolean).join(" and ")}`);
  } else {
    add("warn", "Maps", "no Google or Apple map key — the pin picker draws OpenStreetMap", "Set GOOGLE_MAPS_API_KEY and/or APPLE_MAPKIT_TOKEN; docs/MAPS.md");
  }
}

/* -------------------------------------------------------------- invoices --- */

/*
 * Invoices are issued whatever this says (3.6.6) — refusing to issue one is
 * worse than issuing one with a blank — but a Kuwaiti invoice names its
 * issuer's commercial registration, and a missing one is the kind of gap
 * nobody notices until somebody official asks.
 */
if ((process.env.CRON_SECRET ?? "").trim().length >= 16) {
  add("ok", "Standing orders", "CRON_SECRET set — the scheduler can run Subscribe & Save");
} else {
  add("warn", "Standing orders", "CRON_SECRET not set (or shorter than 16 characters) — no subscription runs on its own",
    "Set CRON_SECRET to a long random string, and the same value in Vercel; /admin/subscriptions can still run them by hand");
}

for (const [name, label] of [["SUPPORT_WHATSAPP", "WhatsApp support"], ["SUPPORT_PHONE", "Phone support"]] as const) {
  const value = (process.env[name] ?? "").trim();
  if (!value) add("warn", label, `${name} not set — the Help section offers no ${label.toLowerCase()} channel`, `Set ${name} to NetLet's number in international form`);
  else if (!supportNumber(value)) add("blocked", label, `${name} is not an international number`, "Write it like 96550001234 or +965 5000 1234");
  else add("ok", label, `+${supportNumber(value)}`);
}

{
  /* The footer's email and profiles: unset is fine and simply absent, but a
     value that is set and refused would vanish without a word, so it blocks. */
  const email = (process.env.SUPPORT_EMAIL ?? "").trim();
  if (!email) add("warn", "Support email", "SUPPORT_EMAIL not set — the footer offers no email address", "Set SUPPORT_EMAIL to NetLet's support address");
  else if (!contactEmail(email)) add("blocked", "Support email", "SUPPORT_EMAIL is not an email address", "Write it like support@netlet.com.kw");
  else add("ok", "Support email", contactEmail(email)!);
  for (const platform of SOCIAL_PLATFORMS) {
    const name = `SOCIAL_${platform.toUpperCase()}`;
    const value = (process.env[name] ?? "").trim();
    if (value && !socialLink(platform, value)) add("blocked", "Social profile", `${name} is not an https link to ${platform}'s own site`, `Paste the full profile address, like https://www.${platform === "x" ? "x" : platform}.com/netlet`);
  }
}

if ((process.env.INVOICE_ISSUER_LICENCE ?? "").trim()) {
  add("ok", "Invoices", `issued by ${(process.env.INVOICE_ISSUER_NAME ?? "").trim() || "NetLet"}, registration ${process.env.INVOICE_ISSUER_LICENCE!.trim()}`);
} else {
  add("warn", "Invoices", "INVOICE_ISSUER_LICENCE not set — invoices say the commercial registration is not recorded",
    "Set INVOICE_ISSUER_NAME, INVOICE_ISSUER_NAME_AR, INVOICE_ISSUER_LICENCE and INVOICE_ISSUER_ADDRESS");
}

{
  /* NetLet's own account for the ISO 20022 payout file (3.3.21). Unset is a
     warning, not a block: the CSV still works and the page says why the other
     format is greyed out. Set and wrong is a block — a bank file naming an
     account that does not exist is refused at the bank, after somebody has
     already decided the payouts are going today. */
  const name = (process.env.PAYOUT_FROM_NAME || process.env.INVOICE_ISSUER_NAME || "").trim();
  const iban = (process.env.PAYOUT_FROM_IBAN ?? "").trim();
  const bic = (process.env.PAYOUT_FROM_BIC ?? "").trim().toUpperCase();
  const problem = debtorProblem({ name, iban, bic });
  if (!problem) add("ok", "Payout bank file", `ISO 20022 from ${name}${bic ? `, ${bic}` : ""}`);
  else if (!iban) add("warn", "Payout bank file", "PAYOUT_FROM_IBAN not set — payouts download as CSV only", "Set PAYOUT_FROM_IBAN (and PAYOUT_FROM_NAME, or INVOICE_ISSUER_NAME) to NetLet's own account");
  else add("blocked", "Payout bank file", `${problem.replace("payouts.", "")}: NetLet's own account is set but cannot be written into a bank file`, "Check PAYOUT_FROM_NAME, PAYOUT_FROM_IBAN and PAYOUT_FROM_BIC");
}

/* ---------------------------------------------------------------- build --- */

const serverBundle = path.join(ROOT, "dist", "index.js");
const clientIndex = path.join(ROOT, "dist", "public", "index.html");
if (existsSync(serverBundle) && existsSync(clientIndex)) {
  add("ok", "Build", "dist/index.js and dist/public are present");
} else {
  add("warn", "Build", "not built yet", "pnpm install && pnpm build");
}

/* ----------------------------------------------------------------- port --- */

const port = Number.parseInt(process.env.PORT || "3000", 10);
const portFree = await new Promise<boolean>((resolve) => {
  const probe = net.createServer();
  probe.once("error", () => resolve(false));
  probe.once("listening", () => probe.close(() => resolve(true)));
  probe.listen(port);
});
if (portFree) {
  add("ok", "Port", `${port} is free`);
} else {
  // Not blocking: this is exactly what a healthy, already-running NetLet looks like.
  add("warn", "Port", `${port} is in use — NetLet may already be running`,
    `lsof -nP -iTCP:${port} -sTCP:LISTEN  shows what is holding it`);
}

/* --------------------------------------------------------------- report --- */

const mark = { ok: "  ok  ", warn: " warn ", blocked: "BLOCKED" } as const;
console.log("\nNetLet preflight\n");
for (const check of checks) {
  console.log(`[${mark[check.status]}] ${check.title}`);
  console.log(`           ${check.detail}`);
  if (check.fix && check.status !== "ok") console.log(`           -> ${check.fix}`);
}

const blocked = checks.filter((check) => check.status === "blocked");
console.log("");
if (blocked.length) {
  console.log(`${blocked.length} thing${blocked.length === 1 ? "" : "s"} to fix before NetLet can serve a catalog:`);
  for (const check of blocked) console.log(`  - ${check.title}`);
  console.log("\nSee docs/SELF-HOSTING.md for the full walkthrough.");
  process.exit(1);
}

console.log("Configuration looks right. Next:");
console.log("  pnpm db:push          create the tables this connection string points at");
console.log("  pnpm build            if the build check above said otherwise");
console.log("  pnpm start            serve on http://localhost:" + port + "/");
