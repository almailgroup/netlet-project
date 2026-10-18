/**
 * Generates `docs/schema-audit.sql`: one query that says what a database is
 * missing, or that it is missing nothing.
 *
 * Applying the bootstrap by pasting it into a SQL editor can truncate, and
 * migrations pasted one at a time can be skipped — and either fails quietly.
 * The symptom turns up later as a page that will not load, naming one column.
 * Fixing that one column and reloading finds the next, which is a slow way to
 * learn what a whole missed step cost.
 *
 * This asks the question once, of everything a migration can leave half-done:
 * every table and column, whether each column takes NULL and has a default
 * (six migrations change exactly that and nothing else, so a column can be
 * present and still wrong), every primary key, enum value, index and foreign
 * key with its delete rule, the objects a later migration dropped, and the
 * seed rows. It reads the current Drizzle snapshot rather than a list typed
 * here, so it cannot drift from the schema it is checking.
 *
 * It also says whether Supabase's Data API can read the tables with the anon
 * key, because "is everything okay in Supabase" is the question it is pasted
 * to answer, and that is the one thing wrong with a complete schema that the
 * schema itself cannot show.
 *
 * Read-only. It changes nothing and is safe on production.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const metaDir = path.join(root, "drizzle/meta");

const snapshots = readdirSync(metaDir).filter(name => /^\d+_snapshot\.json$/.test(name)).sort();
if (!snapshots.length) throw new Error("No Drizzle snapshot found — run `pnpm drizzle-kit generate` first.");
const snapshot = JSON.parse(readFileSync(path.join(metaDir, snapshots.at(-1)), "utf-8"));

/* Postgres cuts identifiers at 63 bytes, so a longer name is stored short. */
const stored = name => {
  let out = name;
  while (Buffer.byteLength(out) > 63) out = out.slice(0, -1);
  return out;
};
const refuse = message => {
  throw new Error(`build-schema-audit: ${message}`);
};
const plain = (value, what) => {
  if (/[,:>']/.test(value)) refuse(`${what} "${value}" holds a character the packed format uses.`);
  return value;
};

/*
 * One row per table, with everything about it packed into four strings,
 * rather than one row per column.
 *
 * That is not tidiness. The first version of this file listed all 219 columns
 * on their own lines and came to 252 — and it was truncated on paste at line
 * 150, which is the exact failure it exists to diagnose. Packed, the whole
 * schema is one line per table.
 *
 *   columns       name:flags   p primary key, n NOT NULL, d has a default
 *   indexes       name:flags   u unique, w partial (has a WHERE)
 *   foreign keys  column>table:rule   c cascade, n set null, r restrict, a no action
 */
const DELETE_RULE = { cascade: "c", "set null": "n", restrict: "r", "no action": "a", "set default": "d" };

const tables = Object.values(snapshot.tables)
  .map(table => {
    const columns = Object.values(table.columns)
      .map(column => {
        const flags = [
          column.primaryKey ? "p" : "",
          column.notNull || column.primaryKey ? "n" : "",
          column.default !== undefined || column.type === "serial" ? "d" : "",
        ].join("");
        return `${plain(column.name, "column")}${flags ? `:${flags}` : ""}`;
      })
      .sort();
    const indexes = [
      ...Object.values(table.indexes).map(index => ({ name: index.name, flags: `${index.isUnique ? "u" : ""}${index.where ? "w" : ""}` })),
      /* A unique constraint is backed by a unique index of the same name. */
      ...Object.values(table.uniqueConstraints).map(unique => ({ name: unique.name, flags: "u" })),
    ]
      .map(index => `${plain(stored(index.name), "index")}${index.flags ? `:${index.flags}` : ""}`)
      .sort();
    const foreignKeys = Object.values(table.foreignKeys)
      .map(key => {
        if (key.columnsFrom.length !== 1 || key.columnsTo.join() !== "id") refuse(`foreign key ${key.name} is not one column onto an id; teach the packed format first.`);
        const rule = DELETE_RULE[key.onDelete ?? "no action"] ?? refuse(`foreign key ${key.name} deletes with "${key.onDelete}".`);
        return `${plain(key.columnsFrom[0], "column")}>${plain(key.tableTo, "table")}:${rule}`;
      })
      .sort();
    return { name: plain(table.name, "table"), columns, indexes, foreignKeys };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const enums = Object.values(snapshot.enums)
  .map(type => ({ name: plain(type.name, "enum"), values: type.values.map(value => plain(value, `value of ${type.name}`)) }))
  .sort((a, b) => a.name.localeCompare(b.name));

/*
 * What a later migration dropped and the schema no longer has. Read out of the
 * migrations, so a new drop is checked the day it lands. A leftover is not
 * always harmless: the old marketplace-wide SKU index refuses two sellers the
 * same code, which is the rule its replacement exists to undo.
 */
const migrationSql = readdirSync(path.join(root, "drizzle"))
  .filter(name => /^\d+_.+\.sql$/.test(name))
  .sort()
  .map(name => readFileSync(path.join(root, "drizzle", name), "utf-8"))
  .join("\n");
const expectedIndexes = new Set(tables.flatMap(table => table.indexes.map(spec => spec.split(":")[0])));
const expectedColumns = new Set(tables.flatMap(table => table.columns.map(spec => `${table.name}.${spec.split(":")[0]}`)));
const retired = [
  ...[...migrationSql.matchAll(/DROP INDEX(?: IF EXISTS)? "([^"]+)"/g)]
    .map(([, name]) => stored(name))
    .filter(name => !expectedIndexes.has(name))
    .map(name => ({ kind: "index", table: "", name })),
  ...[...migrationSql.matchAll(/ALTER TABLE "([^"]+)" DROP COLUMN(?: IF EXISTS)? "([^"]+)"/g)]
    .filter(([, table, column]) => !expectedColumns.has(`${table}.${column}`))
    .map(([, table, name]) => ({ kind: "column", table, name })),
];
if (/DROP (TABLE|TYPE|CONSTRAINT)/i.test(migrationSql)) {
  refuse("a migration drops a table, a type or a constraint; teach the retired list that shape first.");
}

/* The departments are read the way the bootstrap generator reads them. */
const departmentsSource = readFileSync(path.join(root, "Shared/commerce/departments.ts"), "utf-8");
const departments = [...departmentsSource.matchAll(/\{\s*slug:\s*"([^"]+)",\s*name:\s*"[^"]+",\s*nameAr:\s*"[^"]+",\s*position:\s*\d+[^}]*\}/g)]
  .map(([, slug]) => plain(slug, "department"));
if (!departments.length) refuse("no departments parsed from Shared/commerce/departments.ts.");

const quote = value => `'${String(value).replace(/'/g, "''")}'`;
const count = list => list.reduce((total, table) => total + table, 0);
const totals = {
  tables: tables.length,
  columns: count(tables.map(table => table.columns.length)),
  indexes: count(tables.map(table => table.indexes.length)),
  foreignKeys: count(tables.map(table => table.foreignKeys.length)),
  enums: enums.length,
};
const tableRows = tables
  .map(table => `  (${[table.name, table.columns.join(","), table.indexes.join(","), table.foreignKeys.join(",")].map(quote).join(", ")})`)
  .join(",\n");
const enumRows = enums.map(type => `  (${quote(type.name)}, ${quote(type.values.join(","))})`).join(",\n");
const retiredRows = retired.map(item => `  (${quote(item.kind)}, ${quote(item.table)}, ${quote(item.name)})`).join(",\n");
const departmentRows = departments.map(slug => `(${quote(slug)})`).join(", ");
const summary = `${totals.tables} tables, ${totals.columns} columns, ${totals.indexes} indexes, ${totals.foreignKeys} foreign keys, ${totals.enums} enums`;

const sql = `-- NetLet schema audit — generated by scripts/build-schema-audit.mjs. Do not edit.
--
-- Answers one question: of everything the deployed code expects, what is this
-- database missing? Read-only; it changes nothing and is safe on production.
--
-- Paste the whole file into the Supabase SQL editor and run it. The LAST row
-- is the verdict:
--
--   result | everything | complete ...    nothing is missing.
--   result | everything | N problems ...   each row above it names one. The fix
--                                          is always the same: run
--                                          docs/supabase-bootstrap.sql again,
--                                          in full, and check for its
--                                          "bootstrap complete" row.
--
-- A row saying "changed by hand" is the exception: no missed migration leaves
-- it, and the bootstrap will not undo it. A "security" row is not a missing
-- migration either; docs/SUPABASE-AUTH.md says what it means and what to do.
--
-- If the editor shows a syntax error instead, the paste was cut short — this is
-- one statement, so a partial paste can never report a clean bill.
--
-- Checks ${summary}, what later migrations dropped, and the seed rows.

WITH
expected_tables (table_name, columns, indexes, foreign_keys) AS (VALUES
${tableRows}
),
expected_enums (type_name, labels) AS (VALUES
${enumRows}
),
retired (kind, table_name, object_name) AS (VALUES
${retiredRows}
),
departments (slug) AS (VALUES ${departmentRows}),

found_tables AS (
  SELECT e.*, to_regclass(format('public.%I', e.table_name)) AS rel FROM expected_tables e
),
expected_columns AS (
  SELECT t.table_name, t.rel, split_part(spec, ':', 1) AS column_name, split_part(spec, ':', 2) AS flags
  FROM found_tables t CROSS JOIN LATERAL unnest(string_to_array(t.columns, ',')) AS spec
  WHERE t.rel IS NOT NULL
),
found_columns AS (
  SELECT e.*, a.attnum, a.attnotnull, a.atthasdef
  FROM expected_columns e
  LEFT JOIN pg_attribute a ON a.attrelid = e.rel AND a.attname = e.column_name AND a.attnum > 0 AND NOT a.attisdropped
),
found_indexes AS (
  SELECT t.table_name, t.rel, split_part(spec, ':', 1) AS index_name, split_part(spec, ':', 2) AS flags, x.indrelid, x.indisunique, x.indpred IS NOT NULL AS partial
  FROM found_tables t CROSS JOIN LATERAL unnest(string_to_array(t.indexes, ',')) AS spec
  LEFT JOIN pg_index x ON x.indexrelid = to_regclass(format('public.%I', split_part(spec, ':', 1)))
  WHERE t.rel IS NOT NULL
),
found_keys AS (
  SELECT t.table_name, t.rel, split_part(split_part(spec, ':', 1), '>', 1) AS column_name,
    split_part(split_part(spec, ':', 1), '>', 2) AS target, split_part(spec, ':', 2) AS rule, k.confdeltype::text AS actual_rule
  FROM found_tables t CROSS JOIN LATERAL unnest(string_to_array(t.foreign_keys, ',')) AS spec
  LEFT JOIN LATERAL (
    SELECT k.confdeltype FROM pg_constraint k
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    WHERE k.contype = 'f' AND k.conrelid = t.rel AND cardinality(k.conkey) = 1
      AND a.attname = split_part(split_part(spec, ':', 1), '>', 1)
      AND k.confrelid = to_regclass(format('public.%I', split_part(split_part(spec, ':', 1), '>', 2)))
    ORDER BY k.confdeltype::text = split_part(spec, ':', 2) DESC
    LIMIT 1
  ) k ON true
  WHERE t.rel IS NOT NULL
),
seeded AS (
  -- Read through query_to_xml so a missing table is a finding, not an error
  -- that stops the whole audit before it reports anything.
  SELECT
    CASE WHEN EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.categories') AND attname = 'slug' AND NOT attisdropped)
      THEN coalesce((xpath('/row/s/text()', query_to_xml('SELECT string_agg(slug, '','') AS s FROM public.categories', false, true, '')))[1]::text, '')
    END AS department_slugs,
    CASE WHEN EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.vendors') AND attname = 'slug' AND NOT attisdropped)
      THEN (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.vendors WHERE slug = ''netlet''', false, true, '')))[1]::text::int
    END AS house_vendor
),
wording (by_hand) AS (
  -- No migration redefines an index or a key under the same name, so these
  -- were changed by hand, and the bootstrap keeps what it finds by name.
  VALUES ('Changed by hand: re-running the bootstrap will not fix this one')
),
problems (sort, area, object, finding) AS (
  SELECT 1, 'table', table_name, 'missing, with everything in it' FROM found_tables WHERE rel IS NULL
  UNION ALL
  SELECT 2, 'column', table_name || '.' || column_name, 'missing' FROM found_columns WHERE attnum IS NULL
  UNION ALL
  SELECT 3, 'column', table_name || '.' || column_name,
    CASE WHEN flags LIKE '%n%' THEN 'allows NULL; should be NOT NULL' ELSE 'is NOT NULL; should allow NULL' END
  FROM found_columns WHERE attnum IS NOT NULL AND attnotnull <> (flags LIKE '%n%')
  UNION ALL
  SELECT 3, 'column', table_name || '.' || column_name,
    CASE WHEN flags LIKE '%d%' THEN 'has no default; should have one' ELSE 'has a default; a later migration removed it' END
  FROM found_columns WHERE attnum IS NOT NULL AND atthasdef <> (flags LIKE '%d%')
  UNION ALL
  SELECT 3, 'primary key', table_name || '.' || column_name, 'is not the primary key'
  FROM found_columns c WHERE attnum IS NOT NULL AND flags LIKE '%p%' AND NOT EXISTS (
    SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.rel AND k.contype = 'p' AND c.attnum = ANY (k.conkey))
  UNION ALL
  SELECT 4, 'enum', type_name, 'missing' FROM expected_enums WHERE to_regtype(format('public.%I', type_name)) IS NULL
  UNION ALL
  SELECT 4, 'enum value', e.type_name || ' = ' || label, 'missing'
  FROM expected_enums e CROSS JOIN LATERAL unnest(string_to_array(e.labels, ',')) AS label
  WHERE to_regtype(format('public.%I', e.type_name)) IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_enum v WHERE v.enumtypid = to_regtype(format('public.%I', e.type_name)) AND v.enumlabel = label)
  UNION ALL
  SELECT 5, 'index', index_name,
    CASE
      WHEN indrelid IS NULL THEN 'missing'
      WHEN indrelid <> rel THEN 'is on the wrong table; should be on ' || table_name || '. ' || by_hand
      WHEN flags LIKE '%u%' AND NOT indisunique THEN 'is not unique; should be. ' || by_hand
      WHEN flags NOT LIKE '%u%' AND indisunique THEN 'is unique; should not be. ' || by_hand
      ELSE 'has the wrong WHERE clause. ' || by_hand
    END
  FROM found_indexes, wording
  WHERE indrelid IS NULL OR indrelid <> rel OR indisunique <> (flags LIKE '%u%') OR partial <> (flags LIKE '%w%')
  UNION ALL
  SELECT 6, 'foreign key', k.table_name || '.' || k.column_name || ' -> ' || k.target,
    CASE WHEN actual_rule IS NULL THEN 'missing'
      ELSE 'deletes with ' || CASE actual_rule WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'r' THEN 'RESTRICT' WHEN 'd' THEN 'SET DEFAULT' ELSE 'NO ACTION' END
        || '; should be ' || CASE rule WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'r' THEN 'RESTRICT' WHEN 'd' THEN 'SET DEFAULT' ELSE 'NO ACTION' END
        || '. ' || by_hand
    END
  FROM found_keys k, wording
  WHERE (actual_rule IS NULL OR actual_rule <> rule)
    -- A missing column or target table is already its own row.
    AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = k.rel AND a.attname = k.column_name AND NOT a.attisdropped)
    AND to_regclass(format('public.%I', k.target)) IS NOT NULL
  UNION ALL
  SELECT 7, 'leftover', CASE WHEN kind = 'column' THEN table_name || '.' || object_name ELSE object_name END,
    'a later migration dropped this ' || kind || '; it is still here'
  FROM retired r
  WHERE (kind = 'index' AND to_regclass(format('public.%I', object_name)) IS NOT NULL)
     OR (kind = 'column' AND EXISTS (SELECT 1 FROM pg_attribute a
           WHERE a.attrelid = to_regclass(format('public.%I', r.table_name)) AND a.attname = r.object_name AND NOT a.attisdropped))
  UNION ALL
  SELECT 8, 'seed', 'department ' || d.slug, 'missing from categories'
  FROM departments d, seeded s
  WHERE s.department_slugs IS NOT NULL AND NOT d.slug = ANY (string_to_array(s.department_slugs, ','))
  UNION ALL
  SELECT 8, 'seed', 'vendor netlet', 'missing — the house vendor that owns NetLet''s own products'
  FROM seeded WHERE house_vendor = 0
),
security AS (
  -- Only on Supabase, where the anon role exists: a table the anon key can
  -- read with row-level security off is readable through the Data API.
  SELECT 9 AS sort, 'security' AS area,
    count(*) || ' of ${totals.tables} tables' AS object,
    'row-level security is off and the anon role can read them, so the anon key reads them through the Data API if it is on: see docs/SUPABASE-AUTH.md' AS finding
  FROM found_tables t
  JOIN pg_class c ON c.oid = t.rel
  WHERE NOT c.relrowsecurity
    AND CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN has_table_privilege('anon', c.oid, 'SELECT') ELSE false END
  HAVING count(*) > 0
)
SELECT area, object, finding FROM (
  SELECT * FROM problems
  UNION ALL
  SELECT * FROM security
  UNION ALL
  SELECT 10, 'result', 'everything',
    CASE WHEN count(*) = 0 THEN 'complete — ${summary}, the drops and the seed all match'
      ELSE count(*) || ' problem' || CASE WHEN count(*) = 1 THEN '' ELSE 's' END || ' above: run docs/supabase-bootstrap.sql again, in full, then this again' END
  FROM problems
) AS report
ORDER BY sort, object;
`;

const target = path.join(root, "docs/schema-audit.sql");
/* \`--check\` is the suite asking whether the committed file is current. */
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf-8") !== sql) {
    console.error("docs/schema-audit.sql is stale — run `node scripts/build-schema-audit.mjs`.");
    process.exit(1);
  }
  process.exit(0);
}
writeFileSync(target, sql);
console.log(`docs/schema-audit.sql — ${summary}, ${retired.length} retired, ${departments.length} departments; ${sql.split("\n").length} lines, ${Buffer.byteLength(sql)} bytes`);
