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
 * 22.12 is not arbitrary. `firebase-admin` pulls in `jwks-rsa`, which is
 * CommonJS and does `require('jose')` — and jose 6 is ESM-only. Node gained
 * `require()` of an ES module in 22.12, so below that the import throws
 * ERR_REQUIRE_ESM and the whole server is dead at load. It is the same reason
 * `engines.node` is pinned for Vercel.
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
 * All three or none, for the reason the Firebase block below says: with any one
 * missing the server quietly uses the next store down, which looks like
 * "Supabase Auth isn't working" rather than like a typo. Naming the missing one
 * is the whole point.
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

/* ------------------------------------------------------------- firebase --- */

// All four or none: with any one missing the server quietly uses the local
// password digest instead, which looks like "Firebase isn't working" rather
// than like a typo. Naming the missing ones is the whole point of this check.
const firebaseVars = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_API_KEY",
] as const;
const firebaseMissing = firebaseVars.filter(name => !process.env[name]?.trim());

if (firebaseMissing.length === 0) {
  const key = process.env.FIREBASE_PRIVATE_KEY ?? "";
  if (!key.includes("BEGIN PRIVATE KEY")) {
    add("blocked", "FIREBASE_PRIVATE_KEY", "does not look like a PEM private key",
      "Copy the private_key value from the service-account JSON verbatim, in double quotes");
  } else if (!key.includes("\\n") && !key.includes("\n")) {
    add("blocked", "FIREBASE_PRIVATE_KEY", "is a single line with no newlines — every signature will fail",
      'Keep the JSON\'s \\n escapes: FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\nMIIE...\\n-----END PRIVATE KEY-----\\n"');
  } else {
    add("ok", "Firebase", supabaseAuthMissing.length === 0
      ? `still read for accounts made before the move, in project ${process.env.FIREBASE_PROJECT_ID}`
      : `accounts are stored in project ${process.env.FIREBASE_PROJECT_ID}`);
  }
} else if (firebaseMissing.length === firebaseVars.length) {
  /* Not a warning when Supabase Auth is set: Firebase is legacy, and a fresh
     deployment leaving it blank is the expected state rather than a gap. */
  if (supabaseAuthMissing.length === 0) {
    add("ok", "Firebase", "not set, which is right — Supabase Auth holds the passwords");
  } else {
    add("warn", "Firebase", "not set — registration and sign-in use the local password digest instead",
      "Legacy. New deployments use Supabase Auth: see docs/SUPABASE-AUTH.md");
  }
} else {
  add("blocked", "Firebase", `partly set: ${firebaseMissing.join(", ")} missing, so the local password path is used instead`,
    "Set all four, or clear them all to stay on the local path — see docs/FIREBASE.md");
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
