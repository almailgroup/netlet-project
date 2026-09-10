/**
 * `pnpm setup:env` — create or fill in `.env`.
 *
 * `.env` is gitignored, so a fresh clone has no such file and there is nothing
 * to open. This writes one from `.env.example`, which means the copy keeps
 * every comment explaining what each value switches off.
 *
 * It also does the two steps that are pure busywork:
 *
 *   - `JWT_SECRET` has no external source. It is generated here rather than
 *     left as a step someone skips, which would leave sign-in quietly broken.
 *   - Firebase's private key has to be pasted as one double-quoted line with
 *     its newlines written as the two characters \n. Doing that by hand is the
 *     single most common way this setup fails, so pass the service-account JSON
 *     and the three values are written correctly:
 *
 *       pnpm setup:env ~/Downloads/netlet-firebase-adminsdk.json
 *
 * Existing values are never clobbered. Run it as often as you like: it only
 * fills blanks, except for the Firebase values, which a freshly supplied key
 * file is understood to be replacing.
 *
 * No secret is ever printed — only the name of each key that was set.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
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

/* ------------------------------------------------------------- firebase --- */

const args = process.argv.slice(2);
const keyFile = args.find(arg => !arg.startsWith("--"));
const apiKey = args.find(arg => arg.startsWith("--api-key="))?.slice("--api-key=".length);

if (keyFile) {
  const resolved = path.resolve(process.cwd(), keyFile);
  if (!existsSync(resolved)) {
    console.error(`No such file: ${resolved}`);
    process.exit(1);
  }

  let account: { project_id?: string; client_email?: string; private_key?: string };
  try {
    account = JSON.parse(readFileSync(resolved, "utf-8"));
  } catch {
    console.error(`${keyFile} is not valid JSON. Pass the service-account key file Firebase downloaded.`);
    process.exit(1);
  }

  const missing = (["project_id", "client_email", "private_key"] as const).filter(field => !account[field]);
  if (missing.length) {
    console.error(`${keyFile} is missing ${missing.join(", ")} — this looks like the wrong file.`);
    console.error("You want the one from Project settings -> Service accounts -> Generate new private key.");
    process.exit(1);
  }

  env = setValue(env, "FIREBASE_PROJECT_ID", account.project_id!);
  env = setValue(env, "FIREBASE_CLIENT_EMAIL", account.client_email!);
  // The escaping this script exists for: real newlines become the two
  // characters \n, quoted so the value survives being one line in a shell file.
  env = setValue(env, "FIREBASE_PRIVATE_KEY", `"${account.private_key!.replace(/\n/g, "\\n")}"`);
  set.push("FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY");
}

if (apiKey) {
  env = setValue(env, "FIREBASE_API_KEY", apiKey);
  set.push("FIREBASE_API_KEY");
}

/* ---------------------------------------------------------------- write --- */

writeFileSync(ENV_PATH, env, "utf-8");
// Owner-only: this file holds a database password and a service-account key.
chmodSync(ENV_PATH, 0o600);

console.log(`${created ? "Created" : "Updated"} ${ENV_PATH}`);
if (set.length) console.log(`  set:  ${set.join(", ")}`);
if (kept.length) console.log(`  kept: ${kept.join(", ")} (already had a value)`);

const stillEmpty = [
  "DATABASE_URL",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_API_KEY",
].filter(key => !readValue(env, key));

if (stillEmpty.length) {
  console.log("\nStill to fill in, by hand:");
  for (const key of stillEmpty) console.log(`  ${key}`);
  console.log("\n.env.example documents each one. docs/FIREBASE.md covers the Firebase four.");
  if (stillEmpty.some(key => key.startsWith("FIREBASE_"))) {
    console.log("Shortcut for three of them:  pnpm setup:env path/to/serviceAccountKey.json --api-key=AIza...");
  }
}
console.log("\nThen check it with:  pnpm preflight");
