/**
 * The database, as the rest of the server sees it: a query, a transaction and
 * a script. Two things answer it — postgres.js against the real database, and
 * PGlite in the tests — so the SQL the tests run is the SQL production runs.
 */
import postgres from "postgres";

export type Row = Record<string, unknown>;

export interface Db {
  query<T extends Row = Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  transaction<T>(work: (tx: Db) => Promise<T>): Promise<T>;
  /** Several statements and no parameters: the schema. */
  script(text: string): Promise<void>;
}

/**
 * At most this many connections per server instance, and at most this many
 * queries at once (NetLet's lesson, written down in its CLAUDE.md): postgres.js
 * pipelines a query onto a busy connection once every one is taken, and
 * Supabase's transaction pooler never answers a query sent that way — the
 * request hangs until the platform kills it. Queuing here means a connection
 * is always free when a query is sent.
 */
const MAX_CONNECTIONS = 2;
/** An idle connection is closed after this long, so a server instance frozen between requests does not hold it. */
const IDLE_SECONDS = 5;

function gate(size: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(work: () => Promise<T>): Promise<T> {
    if (running >= size) await new Promise<void>(resolve => waiting.push(resolve));
    running++;
    try {
      return await work();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };
}

type Sql = postgres.Sql | postgres.TransactionSql;

function wrap(sql: Sql, run: <T>(work: () => Promise<T>) => Promise<T>, top: postgres.Sql | null): Db {
  return {
    query: <T extends Row>(text: string, params: readonly unknown[] = []) =>
      run(() => sql.unsafe(text, params as postgres.ParameterOrJSON<never>[]) as unknown as Promise<T[]>),
    transaction: <T>(work: (tx: Db) => Promise<T>) => {
      if (!top) return work(wrap(sql, inside, null));
      /* The transaction holds one connection for its whole length, so it takes one place at the gate; its own queries run on that connection. */
      return run(() => top.begin(tx => work(wrap(tx, inside, null))) as Promise<T>);
    },
    script: text => run(async () => { await sql.unsafe(text); }),
  };
}

const inside = <T>(work: () => Promise<T>) => work();

export function postgresDb(url: string): Db {
  const sql = postgres(url, {
    prepare: false,
    max: MAX_CONNECTIONS,
    idle_timeout: IDLE_SECONDS,
    connect_timeout: 10,
    onnotice: () => {},
  });
  return wrap(sql, gate(MAX_CONNECTIONS), sql);
}
