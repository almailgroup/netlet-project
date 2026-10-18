/**
 * `pnpm setup:env` — create or fill in `.env`.
 *
 * `.env` is gitignored, so a fresh clone has no such file and there is nothing
 * to open. This writes one from `.env.example`, which means the copy keeps
 * every comment explaining what each value switches off.
 *
 * It also does the one step that is pure busywork: `JWT_SECRET` has no external
 * source, so it is generated here rather than left as a step someone skips,
 * which would leave sign-in quietly broken.
 *
 * It used to take a Firebase service-account JSON as well, because that key's
 * newline escaping was the single most common way this setup failed. Supabase
 * Auth's three values are ordinary one-line strings copied from a settings page,
 * so there is nothing left to get wrong on their behalf. `pnpm preflight` is
 * what checks them.
 *
 * Existing values are never clobbered. Run it as often as you like: it only
 * fills blanks.
 *
 * No secret is ever printed — only the name of each key that was set.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ENV_PATH = path.join(ROOT, ".env");
const EXAMPLE_PATH = path.join(ROOT, ".env.example");

/** Reads the value of `key`, or "" when it is absent or blank. */
function readValue(text: string, key: string): string {
  const line = text.split("\n").find(l => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : "";
}

/**
 * Sets `key` to `value`, keeping the file's comments and ordering.
 *
 * A key the template does not mention is appended, so this keeps working if
 * `.env.example` gains a value before this script knows about it.
 */
function setValue(text: string, key: string, value: string): string {
  const lines = text.split("\n");
  const index = lines.findIndex(l => l.startsWith(`${key}=`));
  if (index === -1) return `${text.replace(/\n*$/, "")}\n${key}=${value}\n`;
  lines[index] = `${key}=${value}`;
  return lines.join("\n");
}

const set: string[] = [];
const kept: string[] = [];

/* ------------------------------------------------------------ the file --- */

let env: string;
let created = false;
if (existsSync(ENV_PATH)) {
  env = readFileSync(ENV_PATH, "utf-8");
} else {
  if (!existsSync(EXAMPLE_PATH)) {
    console.error("No .env.example next to this script — is this the NetLet repository?");
    process.exit(1);
  }
  env = readFileSync(EXAMPLE_PATH, "utf-8");
  created = true;
}

/* ------------------------------------------------------- session secret --- */

if (readValue(env, "JWT_SECRET")) {
  kept.push("JWT_SECRET");
} else {
  // 48 bytes, the same size .env.example tells you to generate by hand.
  env = setValue(env, "JWT_SECRET", randomBytes(48).toString("base64"));
  set.push("JWT_SECRET (generated)");
}

/* ---------------------------------------------------------------- write --- */

writeFileSync(ENV_PATH, env, "utf-8");
// Owner-only: this file holds a database password and a service-account key.
chmodSync(ENV_PATH, 0o600);

console.log(`${created ? "Created" : "Updated"} ${ENV_PATH}`);
if (set.length) console.log(`  set:  ${set.join(", ")}`);
if (kept.length) console.log(`  kept: ${kept.join(", ")} (already had a value)`);

/* What a deployment actually cannot run without. Everything in Tier 3 degrades
   cleanly, so listing it here would read as a list of things still to do. */
const stillEmpty = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
].filter(key => !readValue(env, key));

if (stillEmpty.length) {
  console.log("\nStill to fill in, by hand:");
  for (const key of stillEmpty) console.log(`  ${key}`);
  console.log("\n.env.example documents each one.");
  if (stillEmpty.some(key => key.startsWith("SUPABASE_"))) {
    console.log("docs/SUPABASE-AUTH.md has all three, from Project Settings, in about five minutes.");
    console.log("Without them, registrations will not appear under Authentication in the Supabase dashboard.");
  }
}
console.log("\nThen check it with:  pnpm preflight");
