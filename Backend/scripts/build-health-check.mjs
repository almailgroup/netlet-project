/**
 * Generates `docs/health-check.sql`: one paste that says whether the shop is
 * working, and what to do about each thing that is not.
 *
 * `docs/schema-audit.sql` answers "did every migration land". That is the
 * question after a bootstrap, and a database can pass it and still show
 * shoppers nothing: no product published, no store approved, no administrator
 * to do either, cash on delivery switched off so nobody can order. This asks
 * the questions after that — whether the shop can sell, whether the money
 * adds up, what is waiting on somebody in the portal, whether the daily jobs
 * run — each one a rule the code already keeps, read back off the data.
 *
 * **One check that cannot run never stops the others.** A database that is
 * behind is exactly when somebody pastes this, and in plain SQL one missing
 * column fails the whole statement before it reports anything. So each check
 * is a query handed to a temporary function that runs it and catches its
 * error: the row then reads "not run" with Postgres's own sentence, which
 * names the missing column, and every other row still answers. The function
 * is created in `pg_temp` — the session's own schema, gone when it ends — so
 * the database itself is not changed.
 *
 * The table list and the departments are read from the Drizzle snapshot and
 * `Shared/commerce/departments.ts`, the way the audit reads them; the checks
 * themselves are written here. `bootstrap.test.ts` runs the file on a real
 * Postgres, fails while the committed copy is stale, and fails on any check
 * that does not run against a current schema — which is what keeps a check
 * from naming a column that is not there.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const metaDir = path.join(root, "Backend/database/meta");

const snapshots = readdirSync(metaDir).filter(name => /^\d+_snapshot\.json$/.test(name)).sort();
if (!snapshots.length) throw new Error("No Drizzle snapshot found — run `pnpm drizzle-kit generate` first.");
const snapshot = JSON.parse(readFileSync(path.join(metaDir, snapshots.at(-1)), "utf-8"));

const refuse = message => {
  throw new Error(`build-health-check: ${message}`);
};
const tables = Object.values(snapshot.tables).map(table => table.name).sort();
if (tables.some(name => !/^[a-z_][a-z0-9_]*$/.test(name))) refuse("a table name the packed list cannot carry.");

/* A table a later migration dropped, still standing, means the bootstrap did not run. */
const migrationSql = readdirSync(path.join(root, "Backend/database"))
  .filter(name => /^\d+_.+\.sql$/.test(name))
  .sort()
  .map(name => readFileSync(path.join(root, "Backend/database", name), "utf-8"))
  .join("\n");
const dropped = [...new Set([...migrationSql.matchAll(/DROP TABLE(?: IF EXISTS)? "([^"]+)"/g)].map(([, name]) => name))]
  .filter(name => !tables.includes(name))
  .sort();

const departmentsSource = readFileSync(path.join(root, "Shared/commerce/departments.ts"), "utf-8");
const departments = [...departmentsSource.matchAll(/\{\s*slug:\s*"([^"]+)",\s*name:\s*"[^"]+",\s*nameAr:\s*"[^"]+",\s*position:\s*\d+[^}]*\}/g)]
  .map(([, slug]) => slug);
if (!departments.length) refuse("no departments parsed from Shared/commerce/departments.ts.");
if (departments.some(slug => !/^[a-z0-9-]+$/.test(slug))) refuse("a department slug the list cannot carry.");

/* What a shopper sees: a published product of an approved store — `publishedCatalog`'s rule. */
const SHOWN = "products p JOIN vendors v ON v.id = p.vendor_id WHERE p.status = 'published' AND v.status = 'approved'";
/* A store that sells, as opposed to NetLet's own house store. */
const SELLER = "v.status = 'approved' AND v.slug <> 'netlet'";
const BOOTSTRAP = "Run docs/supabase-bootstrap.sql again, in full, then docs/schema-audit.sql for the detail.";
const CRON = "The daily job is not running: set CRON_SECRET in Vercel's environment variables (vercel.json schedules it), then redeploy.";

/*
 * Each check is a query returning one row of two columns: what it found, as
 * words, and whether that is a problem. `kind` says how serious a problem is:
 *
 *   fail   the shop is broken for shoppers, or money is wrong
 *   warn   worth fixing; nothing is broken yet
 *   todo   work waiting on somebody in the portal
 *   info   a fact, never a problem
 */
const checks = [
  ["Database", "Postgres version", "info", `SELECT split_part(version(), ' on ', 1), false`, ""],
  ["Database", "Database size", "info", `SELECT pg_size_pretty(pg_database_size(current_database())), false`, ""],
  ["Database", "Photos and seller documents stored", "info",
    `SELECT pg_size_pretty(coalesce((SELECT sum(byte_size) FROM media_files), 0) + coalesce((SELECT sum(byte_size) FROM application_documents), 0)) || ' — ' || (SELECT count(*) FROM media_files) || ' photos, ' || (SELECT count(*) FROM application_documents) || ' documents', false`, ""],
  ["Database", "Connections in use", "warn",
    `SELECT count(*) || ' of ' || current_setting('max_connections'), count(*) > 0.8 * current_setting('max_connections')::int FROM pg_stat_activity`,
    "Nearly every connection is taken. DATABASE_URL in Vercel should be Supabase's Transaction pooler (port 6543), not the direct connection: see docs/SUPABASE.md."],
  ["Database", "Sessions stuck inside a transaction", "warn",
    `SELECT count(*)::text, count(*) > 0 FROM pg_stat_activity WHERE state LIKE 'idle in transaction%' AND state_change < now() - interval '5 minutes'`,
    "They hold locks that make other writes, and the bootstrap, wait. End each with SELECT pg_terminate_backend(pid) on its row of pg_stat_activity."],
  ["Database", "Queries running over five minutes", "warn",
    `SELECT count(*)::text, count(*) > 0 FROM pg_stat_activity WHERE state = 'active' AND pid <> pg_backend_pid() AND query_start < now() - interval '5 minutes'`,
    "Look at them in pg_stat_activity; end one with SELECT pg_cancel_backend(pid)."],

  ["Schema", "Tables the code expects", "fail",
    `SELECT count(*) FILTER (WHERE to_regclass(format('public.%I', t)) IS NOT NULL) || ' of ' || count(*), bool_or(to_regclass(format('public.%I', t)) IS NULL) FROM unnest(string_to_array('${tables.join(",")}', ',')) t`,
    BOOTSTRAP],
  ["Schema", "Tables a later migration removed", "fail",
    dropped.length
      ? `SELECT count(*) FILTER (WHERE to_regclass(format('public.%I', t)) IS NOT NULL)::text, bool_or(to_regclass(format('public.%I', t)) IS NOT NULL) FROM unnest(string_to_array('${dropped.join(",")}', ',')) t`
      : `SELECT '0', false`,
    `Still here means the newest bootstrap has not run. ${BOOTSTRAP}`],

  ["Shop", "Departments", "fail",
    `SELECT count(*) || ' of ${departments.length}', count(*) < ${departments.length} FROM categories WHERE slug IN (${departments.map(slug => `'${slug}'`).join(", ")})`,
    BOOTSTRAP],
  ["Shop", "NetLet's own store", "fail",
    `SELECT coalesce(max(status::text), 'missing'), coalesce(max(status::text), '') <> 'approved' FROM vendors WHERE slug = 'netlet'`,
    `It owns NetLet's own products and must be approved. ${BOOTSTRAP}`],
  ["Shop", "Products a shopper can see", "fail",
    `SELECT count(*)::text, count(*) = 0 FROM ${SHOWN}`,
    "The shop shows nothing. Publish a product at /admin/products, and approve its store at /admin/vendors."],
  ["Shop", "Stores with something on sale", "info", `SELECT count(DISTINCT v.id)::text, false FROM ${SHOWN}`, ""],
  ["Shop", "Published products hidden by their store", "warn",
    `SELECT count(*)::text, count(*) > 0 FROM products p JOIN vendors v ON v.id = p.vendor_id WHERE p.status = 'published' AND v.status <> 'approved'`,
    "Their store is pending or suspended, so shoppers do not see them. Approve the store at /admin/vendors, unless the suspension is meant."],
  ["Shop", "Shown products with no variant", "warn",
    `SELECT count(*)::text, count(*) > 0 FROM ${SHOWN} AND NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id)`,
    "Shoppers see them and cannot buy them. Add a price on the product's page, or unpublish it."],
  ["Shop", "Shown products priced at zero", "fail",
    `SELECT count(DISTINCT p.id)::text, count(*) > 0 FROM ${SHOWN} AND EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.price <= 0)`,
    "These can be bought for nothing. Set a price on the product's page, or unpublish it."],
  ["Shop", "Shown products with no photo", "warn",
    `SELECT count(*)::text, count(*) > 0 FROM ${SHOWN} AND NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id AND pi.kind = 'image')`,
    "Shoppers see a placeholder. Add a photo on the product's page."],
  ["Shop", "Shown products sold out", "info",
    `SELECT count(*)::text, false FROM ${SHOWN} AND NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND (pv.stock > 0 OR pv.preorder_stock > 0))`, ""],
  ["Shop", "Stock below zero", "fail",
    `SELECT count(*)::text, count(*) > 0 FROM product_variants WHERE stock < 0 OR preorder_stock < 0`,
    "The stock take is meant to make this impossible. Correct the count at /admin/stock, and tell the developer."],
  ["Shop", "Savings hidden for want of a discount permit", "todo",
    `SELECT count(DISTINCT p.id)::text, count(*) > 0 FROM ${SHOWN} AND EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.compare_at_price > pv.price) AND (nullif(trim(v.discount_licence_number), '') IS NULL OR v.discount_licence_expires_at < now())`,
    "These sell at their price with the was-price withheld, as the law requires. Record or renew the store's discount permit on its page to show the saving."],
  ["Shop", "Cash on delivery", "fail",
    `SELECT coalesce((SELECT CASE WHEN enabled THEN 'on' ELSE 'off' END FROM feature_switches WHERE key = 'cashOnDelivery'), 'on'), coalesce((SELECT NOT enabled FROM feature_switches WHERE key = 'cashOnDelivery'), false)`,
    "Cash is the only way to pay, so nobody can order. Switch it on at /admin/features."],
  ["Shop", "Features an administrator switched off", "info",
    `SELECT coalesce(string_agg(key, ', ' ORDER BY key), 'none'), false FROM feature_switches WHERE NOT enabled`, ""],

  ["Accounts", "Administrators", "fail",
    `SELECT count(*)::text, count(*) = 0 FROM users WHERE role = 'admin'`,
    "Nobody can open the admin portal. Set OWNER_EMAIL in Vercel and register with that address, or run UPDATE users SET role = 'admin' WHERE email = 'you@example.com'."],
  ["Accounts", "Accounts", "info",
    `SELECT count(*) || ' — ' || count(*) FILTER (WHERE last_signed_in > now() - interval '30 days') || ' signed in this month', false FROM users`, ""],
  ["Accounts", "Accounts with two password stores", "warn",
    `SELECT count(*)::text, count(*) > 0 FROM users WHERE supabase_uid IS NOT NULL AND password_hash IS NOT NULL`,
    "Exactly one of supabase_uid and password_hash should be set. Tell the developer."],
  ["Accounts", "Selling stores without an owner", "warn",
    `SELECT count(*)::text, count(*) > 0 FROM vendors v WHERE ${SELLER} AND NOT EXISTS (SELECT 1 FROM vendor_members m WHERE m.vendor_id = v.id AND m.role = 'owner')`,
    "Nobody runs their team. Add an owner on the store's page under /admin/vendors."],

  ["Money", "Orders", "info",
    `SELECT count(*) || ' — ' || count(*) FILTER (WHERE placed_at > now() - interval '7 days') || ' this week', false FROM orders`, ""],
  ["Money", "Order lines that do not add up", "fail",
    `SELECT count(*)::text, count(*) > 0 FROM order_items WHERE commission_amount + vendor_net <> line_total`,
    "Commission plus the seller's share must equal the line, or finance and payouts are wrong for these orders. Tell the developer."],
  ["Money", "Selling stores charging no commission", "warn",
    `SELECT count(*)::text, count(*) > 0 FROM vendors v WHERE ${SELLER} AND v.commission_percent = 0 AND coalesce(v.commission_fixed, 0) = 0`,
    "Zero is allowed, but is more often a rate nobody set. Set it on the store's page if 0% was not meant."],
  ["Money", "Stores selling without a payout IBAN", "warn",
    `SELECT count(DISTINCT v.id)::text, count(*) > 0 FROM ${SHOWN} AND v.slug <> 'netlet' AND nullif(trim(v.payout_iban), '') IS NULL`,
    "Their payouts cannot be prepared. Add the IBAN on the store's page."],
  ["Money", "Payouts prepared, not marked sent", "todo",
    `SELECT count(*)::text, count(*) > 0 FROM payout_runs WHERE status = 'prepared'`,
    "Send the bank file, then mark each sent with the bank's reference at /admin/payouts."],

  ["Waiting on you", "Products waiting for review", "todo",
    `SELECT count(*)::text, count(*) > 0 FROM products WHERE status = 'pending_review'`, "/admin/review"],
  ["Waiting on you", "Seller applications to decide", "todo",
    `SELECT count(*)::text, count(*) > 0 FROM vendor_applications WHERE status = 'submitted'`, "/admin/applications"],
  ["Waiting on you", "Returns waiting for NetLet's decision", "todo",
    `SELECT count(*)::text, count(*) > 0 FROM return_requests WHERE status = 'review'`, "/admin/returns"],
  ["Waiting on you", "Refunds owed to shoppers", "todo",
    `SELECT count(*)::text, count(*) > 0 FROM return_requests WHERE status = 'refunded' AND refund_paid_at IS NULL`,
    "The item came back and the money has not: /admin/returns"],
  ["Waiting on you", "Help conversations waiting for a reply", "todo",
    `SELECT count(*)::text, count(*) > 0 FROM support_conversations WHERE status = 'open'`, "/admin/support"],
  ["Waiting on you", "Home banners to approve", "todo",
    `SELECT count(*)::text, count(*) > 0 FROM ad_bookings WHERE banner_status = 'pending' AND cancelled_on IS NULL AND ends_on >= (now() AT TIME ZONE 'Asia/Kuwait')::date`,
    "/admin/ads — a day it waits is a day it does not run"],
  ["Waiting on you", "Commission proposals", "todo",
    `SELECT count(*)::text, count(*) > 0 FROM commission_proposals WHERE status = 'pending'`, "/admin/commission"],
  ["Waiting on you", "Damage claims open", "todo",
    `SELECT count(*)::text, count(*) > 0 FROM damage_claims WHERE status = 'open'`, "/admin/claims"],

  ["Daily jobs", "Emails that gave up", "warn",
    `SELECT count(*)::text, count(*) > 0 FROM notification_deliveries WHERE status = 'failed'`,
    "Check RESEND_API_KEY and NOTIFY_EMAIL_FROM in Vercel; each row's last_error says why it failed."],
  ["Daily jobs", "Emails waiting more than two days", "warn",
    `SELECT count(*)::text, count(*) > 0 FROM notification_deliveries WHERE status = 'pending' AND next_attempt_at < now() - interval '2 days'`,
    CRON],
  ["Daily jobs", "Standing orders overdue", "warn",
    `SELECT count(*)::text, count(*) > 0 FROM subscriptions WHERE status = 'active' AND next_run_on < (now() AT TIME ZONE 'Asia/Kuwait')::date - 1`,
    CRON],

  ["Security", "Tables the anon key can read", "warn",
    `SELECT count(*)::text, count(*) > 0 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND has_table_privilege('anon', c.oid, 'SELECT')`,
    "Row-level security is off on these, so Supabase's Data API serves them to anybody holding the anon key. docs/SUPABASE-AUTH.md, \"One thing to check while you are in the dashboard\", has the two ways to close it."],
];

const quote = value => `'${String(value).replace(/'/g, "''")}'`;
/* A check's query is dollar-quoted, so its own quotes need no escaping — and must not hold the marker. */
for (const [area, name, kind, query] of checks) {
  if (!["fail", "warn", "todo", "info"].includes(kind)) refuse(`"${name}" has kind "${kind}".`);
  if (query.includes("$q$")) refuse(`"${area} / ${name}" holds the $q$ marker.`);
}
const rows = checks
  .map(([area, name, kind, query, advice], index) =>
    `  (${index + 1}, ${quote(area)}, ${quote(name)}, ${quote(kind)},\n   $q$${query}$q$,\n   ${quote(advice)})`)
  .join(",\n");

const sql = `-- NetLet health check — generated by Backend/scripts/build-health-check.mjs. Do not edit.
--
-- Is the shop working? Paste the whole file into the Supabase SQL editor and
-- run it. Each row is one check, and the LAST row is the verdict:
--
--   status  ok       nothing to do
--           fail     the shop is broken for shoppers, or money is wrong
--           warn     worth fixing; nothing is broken yet
--           to do    work waiting for somebody in the portal
--           info     a fact, for reference
--           not run  the check could not run — almost always a schema that is
--                    behind; the row says which column or table is missing
--
-- Every row that is not ok says what to do in its last column.
--
-- It changes nothing in the database. The one thing it creates is a temporary
-- function in pg_temp, which belongs to this session and is gone when it ends.
-- docs/schema-audit.sql is its companion: that one says whether every migration
-- landed, this one whether the shop works on top of them.
--
-- ${checks.length} checks, ${tables.length} tables, ${departments.length} departments.

-- (Not "found": inside PL/pgSQL that name is the built-in FOUND flag.)
CREATE OR REPLACE FUNCTION pg_temp.netlet_measure(query text, OUT reading text, OUT flagged boolean, OUT problem text)
LANGUAGE plpgsql AS $measure$
BEGIN
  EXECUTE query INTO reading, flagged;
EXCEPTION WHEN others THEN
  reading := NULL;
  flagged := NULL;
  problem := SQLERRM;
END
$measure$;

WITH
checks (position, area, name, kind, query, advice) AS (VALUES
${rows}
),
measured AS (
  SELECT c.*, m.reading, m.flagged, m.problem
  FROM checks c CROSS JOIN LATERAL pg_temp.netlet_measure(c.query) m
),
judged AS (
  SELECT position, area, name, reading, advice, problem,
    CASE
      WHEN problem IS NOT NULL THEN 'not run'
      WHEN kind = 'info' THEN 'info'
      WHEN flagged THEN CASE kind WHEN 'todo' THEN 'to do' ELSE kind END
      ELSE 'ok'
    END AS status
  FROM measured
)
SELECT "#", area, "check", result, status, "what to do" FROM (
  SELECT position AS "#", area, name AS "check", coalesce(reading, '') AS result, status,
    CASE
      WHEN problem IS NOT NULL THEN problem || '. ${BOOTSTRAP}'
      WHEN status IN ('fail', 'warn', 'to do') THEN advice
      ELSE ''
    END AS "what to do"
  FROM judged
  UNION ALL
  SELECT ${checks.length + 1}, 'Result', 'Overall',
    coalesce(nullif(concat_ws(', ',
      nullif(count(*) FILTER (WHERE status = 'fail') || ' failing', '0 failing'),
      nullif(count(*) FILTER (WHERE status = 'not run') || ' not run', '0 not run'),
      nullif(count(*) FILTER (WHERE status = 'warn') || ' to look at', '0 to look at'),
      nullif(count(*) FILTER (WHERE status = 'to do') || ' waiting on you', '0 waiting on you')), ''), 'all clear'),
    CASE
      WHEN count(*) FILTER (WHERE status IN ('fail', 'not run')) > 0 THEN 'fail'
      WHEN count(*) FILTER (WHERE status = 'warn') > 0 THEN 'warn'
      ELSE 'ok'
    END,
    CASE
      WHEN count(*) FILTER (WHERE status IN ('fail', 'not run')) > 0 THEN 'Fix the failing rows first; each says how. Then run this again.'
      WHEN count(*) FILTER (WHERE status = 'warn') > 0 THEN 'The shop works. The warn rows above are worth a look.'
      ELSE 'Healthy: the shop can sell, the money adds up, and nothing is broken.'
    END
  FROM judged
) AS report
ORDER BY "#";
`;

const target = path.join(root, "docs/health-check.sql");
/* \`--check\` is the suite asking whether the committed file is current. */
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf-8") !== sql) {
    console.error("docs/health-check.sql is stale — run `node Backend/scripts/build-health-check.mjs`.");
    process.exit(1);
  }
  process.exit(0);
}
writeFileSync(target, sql);
console.log(`docs/health-check.sql — ${checks.length} checks, ${tables.length} tables, ${dropped.length} dropped, ${departments.length} departments; ${sql.split("\n").length} lines, ${Buffer.byteLength(sql)} bytes`);
