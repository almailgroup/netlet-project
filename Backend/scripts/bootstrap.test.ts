/**
 * The bootstrap generator has to keep finding the departments.
 *
 * `docs/supabase-bootstrap.sql` is what somebody pastes into the Supabase
 * dashboard to stand a database up, and its department seed is scraped out of
 * `Shared/commerce/departments.ts` with a regular expression — deliberately,
 * so there is one copy of that list rather than two.
 *
 * A regex over source is a fragile reader, and it broke exactly the way one
 * does: it required `position` to be the last field, and a department gained a
 * label, an icon and a tint. The generator refused to write an empty seed,
 * which is the right failure — but nothing in `check`, `test`, `build` or
 * `smoke` runs the generator, so the only thing standing between that and a
 * silently stale bootstrap file was somebody happening to run it.
 *
 * This is that thing, in the suite.
 */
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { DEPARTMENTS } from "../../Shared/commerce/departments.js";

const root = path.resolve(import.meta.dirname, "../..");

/** The same pattern `Backend/scripts/build-bootstrap.mjs` reads the list with. */
function parseAsGeneratorDoes() {
  const source = readFileSync(path.join(root, "Shared/commerce/departments.ts"), "utf-8");
  return [...source.matchAll(
    /\{\s*slug:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*nameAr:\s*"([^"]+)",\s*position:\s*(\d+)[^}]*\}/g,
  )].map(([, slug, name, nameAr, position]) => ({ slug, name, nameAr, position: Number(position) }));
}

describe("the Supabase bootstrap generator", () => {
  it("still finds every department in the shared list", () => {
    const scraped = parseAsGeneratorDoes();
    expect(scraped.map(d => d.slug)).toEqual(DEPARTMENTS.map(d => d.slug));
    expect(scraped).toHaveLength(DEPARTMENTS.length);
  });

  it("reads each department's real name, Arabic name and position", () => {
    for (const [index, scraped] of parseAsGeneratorDoes().entries()) {
      const source = DEPARTMENTS[index];
      expect(scraped.name).toBe(source.name);
      expect(scraped.nameAr).toBe(source.nameAr);
      expect(scraped.position).toBe(source.position);
    }
  });

  /*
   * The other half of staleness: the file on disk has to carry every
   * migration, or "run this file" stops being the answer to "my database is
   * behind".
   */
  it("has a committed bootstrap covering every migration", () => {
    const bootstrap = readFileSync(path.join(root, "docs/supabase-bootstrap.sql"), "utf-8");
    const migrations = readFileSync(path.join(root, "Backend/database/meta/_journal.json"), "utf-8");
    for (const { tag } of JSON.parse(migrations).entries) {
      expect(bootstrap).toContain(tag);
    }
  });

  /*
   * A paste that gets cut short fails silently, and always loses the *end* of
   * the file — which is where the newest migrations are, and so exactly the
   * schema the deployed code has just started selecting from. The symptom
   * arrives later and somewhere else, as "products will not load".
   *
   * The file therefore ends by announcing that it finished. The SQL editor
   * shows the last statement's result, so a reader who cannot see that row
   * knows the paste was truncated. This keeps the announcement there.
   */
  it("ends by announcing that the whole file ran", () => {
    const bootstrap = readFileSync(path.join(root, "docs/supabase-bootstrap.sql"), "utf-8").trimEnd();
    expect(bootstrap).toMatch(/'bootstrap complete' AS status/);
    // Last statement, or the editor shows something else and the signal is lost.
    expect(bootstrap.endsWith(";")).toBe(true);
    const lastSelect = bootstrap.lastIndexOf("SELECT\n  'bootstrap complete'");
    expect(bootstrap.slice(lastSelect)).not.toContain("INSERT INTO");
  });

  it("states the migration count it actually carries", () => {
    const bootstrap = readFileSync(path.join(root, "docs/supabase-bootstrap.sql"), "utf-8");
    const journal = JSON.parse(readFileSync(path.join(root, "Backend/database/meta/_journal.json"), "utf-8"));
    expect(bootstrap).toContain(`${journal.entries.length} AS migrations_in_this_file`);
  });

  /*
   * `docs/schema-audit.sql` answers "what is this database missing?" in one
   * read-only query. It only helps if it lists what the code actually expects,
   * so it is checked against the same snapshot it was generated from — an
   * audit that has fallen behind reports a clean bill on a database that is
   * broken, which is worse than having no audit.
   */
  /* Indexes, keys and enums too: the generator says whether its output moved. */
  it("has a schema audit the generator would write today", () => {
    expect(() => execFileSync(process.execPath, [path.join(root, "Backend/scripts/build-schema-audit.mjs"), "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it("has a schema audit covering every column in the current snapshot", () => {
    const audit = readFileSync(path.join(root, "docs/schema-audit.sql"), "utf-8");
    const snapshots = readdirSync(path.join(root, "Backend/database/meta"))
      .filter(name => /^\d+_snapshot\.json$/.test(name))
      .sort();
    const snapshot = JSON.parse(readFileSync(path.join(root, "Backend/database/meta", snapshots.at(-1)!), "utf-8"));

    const missing: string[] = [];
    for (const table of Object.values(snapshot.tables) as { name: string; columns: Record<string, { name: string }> }[]) {
      // Packed one row per table: name, then its columns as name:flags.
      const packed = new RegExp(`\\('${table.name}', '([^']*)'`).exec(audit);
      const listed = packed ? packed[1].split(",").map(spec => spec.split(":")[0]) : [];
      for (const column of Object.values(table.columns)) {
        if (!listed.includes(column.name)) missing.push(`${table.name}.${column.name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

/*
 * The audit is a query, so it is checked by running it. A clean bill on a
 * broken database is the one answer it must never give, and the only way to
 * know it does not is to break a database and ask.
 */
describe("the schema audit, actually executed", () => {
  const bootstrap = readFileSync(path.join(root, "docs/supabase-bootstrap.sql"), "utf-8");
  const audit = readFileSync(path.join(root, "docs/schema-audit.sql"), "utf-8");
  type Row = { area: string; object: string; finding: string };
  const report = async (db: PGlite) => (await db.query<Row>(audit)).rows;

  it("says complete, and only that, on a database the bootstrap stood up", async () => {
    const db = new PGlite();
    await db.exec(bootstrap);
    const rows = await report(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ area: "result", object: "everything" });
    expect(rows[0].finding).toMatch(/^complete/);
    await db.close();
  }, 120_000);

  /*
   * One of each thing a missed migration can leave: a table, a column, a NOT
   * NULL and a default a later migration took off, an index, a foreign key,
   * something a later migration dropped, and the seed rows. Then the fix the
   * audit prescribes — the bootstrap again — has to make it say complete.
   */
  it("names each thing a missed migration leaves, and the bootstrap repairs them all", async () => {
    const db = new PGlite();
    await db.exec(bootstrap);
    await db.exec(`
      DROP TABLE application_documents;
      ALTER TABLE orders DROP COLUMN delivery_address_parts;
      ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
      ALTER TABLE customer_preferences ALTER COLUMN locale SET DEFAULT 'en';
      DROP INDEX product_variants_product_sku_unique;
      ALTER TABLE order_items DROP CONSTRAINT order_items_bundle_id_bundles_id_fk;
      CREATE UNIQUE INDEX product_variants_sku_unique ON product_variants (sku);
      ALTER TABLE users ADD COLUMN firebase_uid varchar(128);
      DELETE FROM categories WHERE slug = 'grocery';
      DELETE FROM vendors WHERE slug = 'netlet';
    `);
    const found = (await report(db)).map(row => `${row.area} ${row.object}: ${row.finding}`);
    expect(found).toEqual(expect.arrayContaining([
      "table application_documents: missing, with everything in it",
      "column orders.delivery_address_parts: missing",
      "column users.password_hash: is NOT NULL; should allow NULL",
      "column customer_preferences.locale: has a default; a later migration removed it",
      "index product_variants_product_sku_unique: missing",
      "foreign key order_items.bundle_id -> bundles: missing",
      "leftover product_variants_sku_unique: a later migration dropped this index; it is still here",
      "leftover users.firebase_uid: a later migration dropped this column; it is still here",
      "seed department grocery: missing from categories",
      expect.stringMatching(/^seed vendor netlet: missing/),
      "result everything: 10 problems above: run docs/supabase-bootstrap.sql again, in full, then this again",
    ]));
    expect(found).toHaveLength(11);

    await db.exec(bootstrap);
    const after = await report(db);
    expect(after).toHaveLength(1);
    expect(after[0].finding).toMatch(/^complete/);
    await db.close();
  }, 120_000);

  /* A missing table is a finding, not an error that stops the report. */
  it("still reports when the seeded tables themselves are gone", async () => {
    const db = new PGlite();
    await db.exec(bootstrap);
    await db.exec("DROP TABLE categories CASCADE; DROP TABLE vendors CASCADE;");
    const objects = (await report(db)).filter(row => row.area === "table").map(row => row.object);
    expect(objects).toEqual(["categories", "vendors"]);
    await db.close();
  }, 120_000);

  /*
   * On Supabase the anon role can read every table it is granted, and with
   * row-level security off the Data API hands those rows to anybody holding the
   * anon key. A plain Postgres has no such role and gets no such row.
   */
  it("says when the anon role can read tables that have no row-level security", async () => {
    const db = new PGlite();
    await db.exec(bootstrap);
    await db.exec("CREATE ROLE anon; GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon; ALTER TABLE users ENABLE ROW LEVEL SECURITY;");
    const security = (await report(db)).filter(row => row.area === "security");
    expect(security).toHaveLength(1);
    expect(security[0].object).toMatch(/^\d+ of \d+ tables$/);
    const [readable, total] = security[0].object.match(/\d+/g)!.map(Number);
    expect(readable).toBe(total - 1);
    await db.close();
  }, 120_000);
});

/*
 * All or nothing.
 *
 * A paste cut short has now broken a live database three times, and it always
 * loses the end of the file — the newest migrations, which are exactly the
 * ones the deployed code has just started selecting from. Wrapping the file in
 * one transaction makes that harmless: a truncated run never reaches the
 * COMMIT, so nothing is applied and the database stays as it was rather than
 * becoming a half-way state that matches neither the old code nor the new.
 *
 * The completion row deliberately comes *after* the COMMIT, so it is the last
 * result the SQL editor shows and it reports something that has actually been
 * kept rather than something still open in a transaction.
 */
describe("the bootstrap is atomic", () => {
  const file = readFileSync(path.join(root, "docs/supabase-bootstrap.sql"), "utf-8");

  it("opens a transaction before the first statement and commits at the end", () => {
    const begin = file.indexOf("\nBEGIN;");
    const commit = file.lastIndexOf("\nCOMMIT;");
    expect(begin).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(begin);

    // Nothing that does work may sit outside the transaction.
    const before = file.slice(0, begin).split("\n").filter(line => line.trim() && !line.trim().startsWith("--"));
    expect(before).toEqual([]);
  });

  it("reports completion after the commit, so the row means it was kept", () => {
    const commit = file.lastIndexOf("\nCOMMIT;");
    expect(file.indexOf("'bootstrap complete'")).toBeGreaterThan(commit);
  });

  /*
   * A transaction rules out the handful of statements Postgres refuses to run
   * inside one. None appear today; this fails the build if one is ever
   * generated, rather than letting it break the paste in somebody's dashboard.
   */
  it("holds no statement that cannot run inside a transaction", () => {
    expect(file).not.toMatch(/CONCURRENTLY|^\s*VACUUM/im);
  });

  /*
   * A new enum value can be *added* inside a transaction (Postgres 12 on; the
   * home banner's `ad_slot` was the first), but not *used* in the one that
   * added it. So nothing after an ADD VALUE may name the value — a default, a
   * check, a seed row — or the paste fails on its last stretch, which the
   * transaction would then throw away whole.
   */
  it("never uses an enum value in the transaction that adds it", () => {
    const added = [...file.matchAll(/ALTER TYPE \S+ ADD VALUE IF NOT EXISTS '([^']+)'/g)];
    expect(added.length).toBeGreaterThan(0);
    for (const match of added) {
      const after = file.slice(match.index! + match[0].length);
      expect(after.includes(`'${match[1]}'`), match[1]).toBe(false);
    }
  });
});

/*
 * Reading the file is not the same as running it, and everything above only
 * reads. "Idempotent" is a claim about what Postgres does with these statements,
 * so it is checked by giving them to Postgres — twice, against an empty database,
 * which is the shape the file promises to handle at any version.
 *
 * It earned a place when the first `DROP COLUMN` landed. Until then every
 * statement either created something or was a no-op on a second run; a drop is
 * the first shape where "run it again" and "run it on a database that never had
 * the thing" are different questions, and the generator's rewrite for it was new.
 */
describe("the bootstrap file, actually executed", () => {
  const file = readFileSync(path.join(root, "docs/supabase-bootstrap.sql"), "utf-8");

  it("stands a database up, and running it again changes nothing", async () => {
    const db = new PGlite();
    const columns = async () =>
      (await db.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_name = 'users' order by 1",
      )).rows.map(row => row.column_name);
    const departments = async () =>
      (await db.query<{ n: number }>("select count(*)::int as n from categories")).rows[0].n;

    await db.exec(file);
    const afterFirst = await columns();
    expect(afterFirst).toContain("supabase_uid");
    expect(await departments()).toBe(DEPARTMENTS.length);

    await db.exec(file);
    expect(await columns()).toEqual(afterFirst);
    /* Seeded with ON CONFLICT, so a second paste must not double the list. */
    expect(await departments()).toBe(DEPARTMENTS.length);

    await db.close();
  }, 120_000);

  /*
   * The drop is what this file has to get right for a database that predates it:
   * migration 0001 adds the column and 0035 takes it away, so a single paste has
   * to leave a database at either version in the same place.
   */
  it("leaves no firebase_uid, whichever version it was pasted onto", async () => {
    const fresh = new PGlite();
    await fresh.exec(file);
    const freshColumns = (await fresh.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'users'",
    )).rows.map(row => row.column_name);
    expect(freshColumns).not.toContain("firebase_uid");
    await fresh.close();

    /* And onto one that already has the column, which is the real migration. */
    const older = new PGlite();
    await older.exec(file);
    await older.exec('ALTER TABLE "users" ADD COLUMN "firebase_uid" varchar(128)');
    await older.exec(file);
    const olderColumns = (await older.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'users'",
    )).rows.map(row => row.column_name);
    expect(olderColumns).not.toContain("firebase_uid");
    await older.close();
  }, 120_000);

  /*
   * A database used for what the current schema allows must still take the
   * file. 0003 made SKUs unique across the marketplace and 0033 dropped that,
   * because two sellers may both type "BATT-1" — and a re-run that rebuilt the
   * old index on the way past failed on exactly that, and, being one
   * transaction, applied nothing at all. Found by re-running the file against a
   * database a fuzzer had been at, not by any test before this one.
   */
  it("runs again on a database where two sellers share a SKU", async () => {
    const db = new PGlite();
    await db.exec(file);
    await db.exec(`
      INSERT INTO vendors (slug, name) VALUES ('one', 'One'), ('two', 'Two');
      INSERT INTO products (vendor_id, handle, title) SELECT id, slug || '-battery', 'Battery' FROM vendors WHERE slug IN ('one', 'two');
      INSERT INTO product_variants (product_id, title, sku, price) SELECT id, 'Default', 'BATT-1', '1.000' FROM products WHERE handle LIKE '%-battery';
    `);
    await db.exec(file);
    const [row] = (await db.query<{ n: number }>("select count(*)::int as n from product_variants where sku = 'BATT-1'")).rows;
    expect(row.n).toBe(2);
    await db.close();
  }, 120_000);
});
