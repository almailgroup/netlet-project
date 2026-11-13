/**
 * NetLet's own departments as rows of `categories`, written where they are
 * missing.
 *
 * The departments are code (`Shared/commerce/departments.ts`) and a product is
 * filed under one by its category row's id, so a department added in code has
 * no row on a database that predates it — and the product editor, which lists
 * the rows, would not offer it until somebody pasted the bootstrap again. This
 * writes the missing rows the first time an instance lists the categories or
 * reads them for an import: insert-only, `ON CONFLICT (slug) DO NOTHING`, so a
 * row an administrator renamed keeps its name and a merchant's own department
 * is never touched. The seed (`Backend/scripts/seed.ts`) and the bootstrap
 * write the same rows; this is what keeps a live shop from waiting on either.
 *
 * Once per database object, and tried again after a failure, since a read
 * that cannot write (a replica, a role without INSERT) must not stop the list
 * it was asked for.
 */
import { DEPARTMENTS } from "../../../Shared/commerce/departments.js";
import { categories } from "../../database/schema.js";
import type { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const written = new WeakMap<object, Promise<void>>();

export function ensureDepartmentRows(db: Db): Promise<void> {
  const known = written.get(db);
  if (known) return known;
  const attempt = db
    .insert(categories)
    .values(DEPARTMENTS.map(({ slug, name, nameAr, position }) => ({ slug, name, nameAr, position })))
    .onConflictDoNothing({ target: categories.slug })
    .then(
      () => undefined,
      (error: unknown) => {
        written.delete(db);
        console.warn("[departments] could not write the missing department rows:", error instanceof Error ? error.message : error);
      },
    );
  written.set(db, attempt);
  return attempt;
}
