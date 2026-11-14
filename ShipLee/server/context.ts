/**
 * The server's setup, read from the environment once per instance.
 *
 *   DATABASE_URL (or POSTGRES_URL)  the database. Unset, tracking is closed —
 *                                   unless SHIPLEE_DEMO=1 asks for the
 *                                   sample parcels, kept in memory.
 *   STAFF_PASSWORD                  the staff desk's password, 12 characters
 *                                   or more. Unset, the desk is closed.
 *   SESSION_SECRET                  optional: signs staff sessions instead of
 *                                   the password.
 *   SHIPLEE_PHONE, SHIPLEE_WHATSAPP, SHIPLEE_EMAIL
 *                                   the contact details the help page shows.
 *
 * Nothing here throws: an unset value turns its feature off, and the pages say
 * so in words.
 */
import type { Context } from "./handle.js";
import { postgresDb } from "./db.js";
import { memoryStore, sqlStore } from "./store.js";
import type { Store } from "./store.js";
import { staffKey } from "./auth.js";
import { contactFromEnv } from "./contact.js";

let kept: { key: string; store: Store | null } | null = null;

export function contextFromEnv(env: Record<string, string | undefined> = process.env): Context {
  const url = env.DATABASE_URL || env.POSTGRES_URL || "";
  const demo = env.SHIPLEE_DEMO === "1" || env.SHIPLEE_DEMO === "true";
  const key = `${url}|${demo}`;
  if (!kept || kept.key !== key) kept = { key, store: url ? sqlStore(postgresDb(url)) : demo ? memoryStore() : null };
  return { store: kept.store, staff: staffKey(env), contact: contactFromEnv(env) };
}
