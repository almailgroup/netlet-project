/**
 * Moves every remaining login into Supabase Auth.
 *
 *   node scripts/migrate-auth-to-supabase.mjs            # say what would happen
 *   node scripts/migrate-auth-to-supabase.mjs --commit   # do it
 *   node scripts/migrate-auth-to-supabase.mjs --commit --no-email
 *
 * ## It cannot carry passwords, and that is the whole shape of it
 *
 * A Firebase password hash cannot be imported into Supabase, and neither can
 * NetLet's own scrypt digest: Supabase stores bcrypt, and a hash cannot be
 * rehashed without the password. So every account this moves is created with a
 * random password nobody is told, and its owner is emailed a reset link.
 *
 * That is why this is a script you run on purpose rather than something that
 * happens on deploy. **Everybody it moves has to set a new password.** For a
 * shop that has not opened yet that is three test accounts; for a live one it is
 * a decision with a support cost.
 *
 * There is no alternative that avoids it, which is worth being plain about: an
 * account whose row names Firebase stays there through a reset (Firebase sends
 * that mail and handles the new password) and through a change from `/account`
 * (`storeFor` writes to the store the row names). Waiting is not a migration
 * strategy. Leaving them in Firebase indefinitely *is* supported — but then the
 * four `FIREBASE_*` values stay set for as long as one row has a `firebase_uid`.
 *
 * ## What it does per account, in this order
 *
 * 1. Creates the Supabase user, confirmed, with the display name.
 * 2. Writes `supabase_uid` onto the row and clears `firebase_uid` and
 *    `password_hash`, so exactly one credential column stays set — the rule
 *    `drizzle/schema.ts` states and `server/logins.ts` maintains.
 * 3. Emails a reset link, unless `--no-email`.
 *
 * The write is second: a row pointing at a Supabase user that does not exist
 * cannot be signed into and cannot be recovered by running this again, whereas a
 * Supabase user with no row yet is adopted by the next sign-in.
 *
 * An account Supabase already knows — because a previous run got that far, or
 * because somebody added it in the dashboard — is linked to the existing user
 * rather than skipped, so a half-finished run is safe to repeat.
 */
import "dotenv/config";
import postgres from "postgres";

const COMMIT = process.argv.includes("--commit");
const EMAIL = !process.argv.includes("--no-email");

const { DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;

function stop(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!DATABASE_URL) stop("DATABASE_URL is unset. Nothing to migrate from.");
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  stop("Supabase Auth is not configured. docs/SUPABASE-AUTH.md has the three values.");
}

const base = SUPABASE_URL.replace(/\/+$/, "");
const adminHeaders = {
  "content-type": "application/json",
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
};

/** A password nobody knows, long enough that guessing it is not a plan. */
const throwaway = () => `Nl-${crypto.randomUUID()}-${crypto.randomUUID()}`;

/** The Supabase user for this address, if there already is one. */
async function existingUser(email) {
  const url = `${base}/auth/v1/admin/users?page=1&per_page=1&filter=${encodeURIComponent(email)}`;
  const response = await fetch(url, { headers: adminHeaders });
  if (!response.ok) return null;
  const body = await response.json();
  const found = (body.users ?? []).find(user => String(user.email).toLowerCase() === email);
  return found ?? null;
}

async function createUser(email, name) {
  const response = await fetch(`${base}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      email,
      password: throwaway(),
      email_confirm: true,
      user_metadata: name ? { name } : {},
    }),
  });
  if (response.ok) return (await response.json()).id;

  /* Already there, from a previous run or from the dashboard: link it. */
  const text = await response.text();
  if (response.status === 422 || response.status === 409 || /already|registered|exists/i.test(text)) {
    const found = await existingUser(email);
    if (found?.id) return found.id;
  }
  throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
}

async function sendReset(email) {
  const response = await fetch(`${base}/auth/v1/recover`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ email }),
  });
  /* 429 is Supabase's own mail ceiling — the default project mailer is meant for
     development. Reported per account rather than fatal, so a run of two hundred
     does not stop at the fiftieth with no record of what it had done. */
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

const sql = postgres(DATABASE_URL, { max: 2 });

try {
  const rows = await sql`
    select id, email, name, firebase_uid, password_hash
    from users
    where supabase_uid is null
    order by id
  `;

  const already = await sql`select count(*)::int as n from users where supabase_uid is not null`;

  console.log(`\n${rows.length} account(s) to move. ${already[0].n} already in Supabase Auth.`);
  if (rows.length === 0) {
    console.log("Nothing to do. The four FIREBASE_* values can go, and so can server/_core/firebase.ts.\n");
    await sql.end();
    process.exit(0);
  }

  const from = row =>
    row.firebase_uid ? "firebase" : row.password_hash ? "local digest" : "no credential at all";
  for (const row of rows) console.log(`  ${row.email.padEnd(40)} from ${from(row)}`);

  if (!COMMIT) {
    console.log(`\nThis was a dry run. Nothing changed.`);
    console.log(`Every account above would be asked to set a new password: a Firebase or scrypt`);
    console.log(`hash cannot be imported into Supabase, so there is no way to carry the old one.`);
    console.log(`\nRun it for real with:  node scripts/migrate-auth-to-supabase.mjs --commit`);
    console.log(`Add --no-email to move them without sending reset links (they then cannot sign in`);
    console.log(`until somebody sends one from /admin/people).\n`);
    await sql.end();
    process.exit(0);
  }

  let moved = 0;
  let mailed = 0;
  const failures = [];

  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    try {
      const uid = await createUser(email, row.name);
      await sql`
        update users
        set supabase_uid = ${uid}, firebase_uid = null, password_hash = null
        where id = ${row.id}
      `;
      moved += 1;
      if (EMAIL) {
        try {
          await sendReset(email);
          mailed += 1;
        } catch (error) {
          failures.push(`${email}: moved, but no reset email (${String(error)})`);
        }
      }
      console.log(`  moved ${email}`);
    } catch (error) {
      failures.push(`${email}: ${String(error)}`);
      console.error(`  FAILED ${email} — ${String(error)}`);
    }
  }

  console.log(`\n${moved} moved, ${mailed} reset email(s) sent, ${failures.length} problem(s).`);
  for (const failure of failures) console.log(`  ${failure}`);
  if (failures.length) {
    console.log(`\nSafe to run again: an account already in Supabase is linked rather than duplicated.`);
  }
  if (moved && !EMAIL) {
    console.log(`\nNobody was emailed. Until each one resets, they cannot sign in — send a link from`);
    console.log(`/admin/people, or re-run without --no-email.`);
  }
  console.log();
} finally {
  await sql.end();
}
