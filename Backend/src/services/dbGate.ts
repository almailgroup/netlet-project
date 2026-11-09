import type { Sql } from "postgres";

/**
 * Lets at most `limit` queries or transactions reach the database client at
 * once; the rest wait their turn here.
 *
 * postgres.js already queues, but not first: once every connection is busy it
 * sends the next query on one that is still running another (it pipelines),
 * whenever that one's query has no parameters. Supabase's transaction pooler
 * never answers a query sent that way, so a request running more queries than
 * there are connections hung until Vercel killed it — half of the admin
 * pages, once each page's reads went out in one request. Measured on the live
 * site: five queries in one request always answered, six hung half the time.
 *
 * With no more in flight than there are connections, postgres.js always has a
 * free or unopened connection for the next query and never pipelines. Its own
 * `max_pipeline: 0` would say the same, and breaks every transaction: postgres.js
 * marks a transaction's connection as reserved only on a branch that setting
 * skips, and then refuses it as `UNSAFE_TRANSACTION`.
 *
 * Drizzle sends every query through `unsafe` and every transaction through
 * `begin`, and a transaction's own queries go through the transaction's
 * connection, which it already holds — so those two are all that is gated, and
 * a transaction holds its place until it commits or rolls back.
 */
export function gateQueries<T extends Sql>(client: T, limit: number): T {
  const places = new Places(limit);

  async function held<R>(work: () => PromiseLike<R>): Promise<R> {
    await places.take();
    try {
      return await work();
    } finally {
      places.give();
    }
  }

  /* `unsafe` returns a query that runs when it is awaited, and drizzle asks
     some for `.values()` first; this keeps both, and takes a place only once
     somebody waits for the answer. */
  function unsafe(query: string, parameters?: unknown[], options?: unknown) {
    let values = false;
    let running: Promise<unknown> | undefined;
    const run = () =>
      (running ??= held(() => {
        const pending = client.unsafe(query, parameters as never, options as never);
        return values ? pending.values() : pending;
      }));
    const query_ = {
      values() {
        values = true;
        return query_;
      },
      then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return run().then(onFulfilled, onRejected);
      },
      catch(onRejected?: (reason: unknown) => unknown) {
        return run().catch(onRejected);
      },
      finally(onFinally?: () => void) {
        return run().finally(onFinally);
      },
    };
    return query_;
  }

  function begin(...args: unknown[]) {
    return held(() => (client.begin as (...a: unknown[]) => Promise<unknown>)(...args));
  }

  return new Proxy(client, {
    get(target, key, receiver) {
      if (key === "unsafe") return unsafe;
      if (key === "begin") return begin;
      return Reflect.get(target, key, receiver);
    },
  });
}

/** A first-come, first-served count of free places. */
class Places {
  private free: number;
  private readonly waiting: Array<() => void> = [];

  constructor(size: number) {
    this.free = size;
  }

  async take(): Promise<void> {
    if (this.free > 0) {
      this.free -= 1;
      return;
    }
    await new Promise<void>(resolve => this.waiting.push(resolve));
  }

  /** Hands the place straight to whoever waited longest, or frees it. */
  give(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.free += 1;
  }
}
