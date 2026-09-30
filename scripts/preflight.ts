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
  }
} else if (supabaseAuthMissing.length === supabaseAuthVars.length) {
  add("warn", "Supabase Auth", "not set — registrations will not appear under Authentication in the Supabase dashboard",
    "Optional, and the reason that page is empty. docs/SUPABASE-AUTH.md has the setup");
} else {
  add("blocked", "Supabase Auth", `partly set: ${supabaseAuthMissing.join(", ")} missing, so a different password store is used instead`,
    "Set all three, or clear them all — see docs/SUPABASE-AUTH.md");
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
