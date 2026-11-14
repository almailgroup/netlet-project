/** The test database: Postgres in-process, behind the same `Db` the server uses. */
import { PGlite } from "@electric-sql/pglite";
import type { Db, Row } from "./db.js";

type Querier = Pick<PGlite, "query" | "exec">;

function wrap(pg: Querier, top: PGlite | null): Db {
  return {
    query: async <T extends Row>(text: string, params: readonly unknown[] = []) => (await pg.query<T>(text, [...params])).rows,
    transaction: <T>(work: (tx: Db) => Promise<T>) => (top ? top.transaction(tx => work(wrap(tx, null))) : work(wrap(pg, null))),
    script: async text => { await pg.exec(text); },
  };
}

export async function testDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const pg = new PGlite();
  await pg.waitReady;
  return { db: wrap(pg, pg), close: () => pg.close() };
}
