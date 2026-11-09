import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { DB_CLIENT_OPTIONS, DB_MAX_CONNECTIONS, openDatabase } from "./db.js";

/**
 * The live shop's admin pages hung because postgres.js sent a query on a
 * connection that was still running another: once every connection is busy, it
 * stacks the next query onto a busy one (pipelining) whenever that one's query
 * had no parameters. Supabase's transaction pooler never answered the stacked
 * query, and the request waited until Vercel killed it — measured on the live
 * site, five queries in one request always answered and six hung half the time.
 *
 * This fake server speaks just enough of the Postgres protocol to answer a
 * SELECT and a transaction, slowly, and counts every query that arrives on a
 * connection before the one before it has finished. The database is opened the
 * way the server opens it, through drizzle.
 */

type Fake = { server: Server; port: number; stacked: number; connections: number; answered: number };

const fakes: Fake[] = [];

function message(type: string, body: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(5);
  head.write(type, 0, "latin1");
  head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
}

const int32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};
const int16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n);
  return b;
};
const text = (s: string) => Buffer.from(s + "\0", "latin1");

/** What a statement's CommandComplete says, and whether it opens or ends a transaction. */
function tagOf(statement: string): { tag: string; transaction?: boolean } {
  const word = statement.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (word === "begin") return { tag: "BEGIN", transaction: true };
  if (word === "commit") return { tag: "COMMIT", transaction: false };
  if (word === "rollback") return { tag: "ROLLBACK", transaction: false };
  return { tag: "SELECT 0" };
}

async function fakePostgres(): Promise<Fake> {
  const fake: Fake = { server: createServer(), port: 0, stacked: 0, connections: 0, answered: 0 };
  fake.server.on("connection", (socket: Socket) => {
    fake.connections += 1;
    let buffer = Buffer.alloc(0);
    let started = false;
    let running = 0;
    let inTransaction = false;
    let statement = "";
    let replies: Buffer[] = [];
    /* Replies leave in the order their messages came, as a real server's do. */
    let outbox = Promise.resolve();
    const answer = (chunks: Buffer[], after = 0) => {
      outbox = outbox
        .then(() => new Promise<void>(resolve => setTimeout(resolve, after)))
        .then(() => {
          if (socket.writable) socket.write(Buffer.concat(chunks));
        });
      return outbox;
    };
    const ready = () => message("Z", Buffer.from(inTransaction ? "T" : "I"));
    /* A query arriving while the last one is still running is a stacked query. */
    const arrive = () => {
      if (running > 0) fake.stacked += 1;
      running += 1;
    };
    /* The query takes a moment, so the client has the chance to stack. */
    const finish = (chunks: Buffer[]) =>
      void answer(chunks, 15).then(() => {
        running -= 1;
        fake.answered += 1;
      });

    socket.on("data", chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (!started) {
          if (buffer.length < 8) return;
          const length = buffer.readInt32BE(0);
          if (buffer.length < length) return;
          const code = buffer.readInt32BE(4);
          buffer = buffer.subarray(length);
          if (code === 80877103) {
            socket.write("N");
            continue;
          }
          started = true;
          answer([message("R", int32(0)), message("K", Buffer.concat([int32(1), int32(2)])), ready()]);
          continue;
        }
        if (buffer.length < 5) return;
        const type = String.fromCharCode(buffer[0]);
        const length = buffer.readInt32BE(1);
        if (buffer.length < length + 1) return;
        const body = buffer.subarray(5, length + 1);
        buffer = buffer.subarray(length + 1);

        if (type === "Q") {
          /* The simple protocol: a statement with no parameters, which is how
             drizzle's parameterless queries and every BEGIN and COMMIT go. */
          arrive();
          const { tag, transaction } = tagOf(body.toString("latin1").replace(/\0$/, ""));
          if (transaction !== undefined) inTransaction = transaction;
          finish([message("C", text(tag)), ready()]);
        } else if (type === "P") {
          arrive();
          const [, query = ""] = body.toString("latin1").split("\0");
          statement = query;
          /* One parameter of type int4 per `$n` in the statement. */
          const parameters = (query.match(/\$\d+/g) ?? []).length;
          replies.push(message("1"));
          replies.push(message("t", Buffer.concat([int16(parameters), ...Array.from({ length: parameters }, () => int32(23))])));
        } else if (type === "D") {
          replies.push(message("n"));
        } else if (type === "H") {
          answer(replies);
          replies = [];
        } else if (type === "B") {
          replies.push(message("2"));
        } else if (type === "E") {
          const { tag, transaction } = tagOf(statement);
          if (transaction !== undefined) inTransaction = transaction;
          replies.push(message("C", text(tag)));
        } else if (type === "S") {
          const held = [...replies, ready()];
          replies = [];
          finish(held);
        } else if (type === "X") {
          socket.end();
          return;
        }
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>(resolve => fake.server.listen(0, "127.0.0.1", resolve));
  fake.port = (fake.server.address() as AddressInfo).port;
  fakes.push(fake);
  return fake;
}

const ends: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(ends.splice(0).map(end => end()));
  await Promise.all(fakes.splice(0).map(fake => new Promise(resolve => fake.server.close(resolve))));
});

function databaseOn(fake: Fake) {
  const db = openDatabase({ host: "127.0.0.1", port: fake.port, user: "netlet", database: "netlet", fetch_types: false });
  ends.push(() => db.$client.end({ timeout: 1 }));
  return db;
}

/** A page's worth of reads, as an admin page sends them: four times as many as
 *  there are connections, with parameters and without, and through `.values()`. */
function aPageOfReads(db: ReturnType<typeof databaseOn>) {
  return Array.from({ length: DB_MAX_CONNECTIONS * 4 }, (_, i) =>
    i % 3 === 0
      ? db.execute(sql`select 1`)
      : i % 3 === 1
        ? db.execute(sql`select ${i}::int`)
        : db.select({ one: sql<number>`1` }).from(sql`(select 1) as t`),
  );
}

describe("the database client", () => {
  it("never sends a query on a connection that is still running one", async () => {
    const fake = await fakePostgres();
    const db = databaseOn(fake);
    await Promise.all(aPageOfReads(db));
    expect(fake.answered).toBe(DB_MAX_CONNECTIONS * 4);
    expect(fake.connections).toBeLessThanOrEqual(DB_MAX_CONNECTIONS);
    expect(fake.stacked).toBe(0);
  });

  it("stacks nothing on connections that are already open, either", async () => {
    const fake = await fakePostgres();
    const db = databaseOn(fake);
    /* The live hang came on the second request, once the first had left its
       connections open and idle. */
    await Promise.all(aPageOfReads(db));
    await Promise.all(aPageOfReads(db));
    expect(fake.answered).toBe(DB_MAX_CONNECTIONS * 8);
    expect(fake.stacked).toBe(0);
  });

  it("still runs transactions, many at once and beside plain reads", async () => {
    const fake = await fakePostgres();
    const db = databaseOn(fake);
    const transactions = Array.from({ length: DB_MAX_CONNECTIONS * 3 }, (_, i) =>
      db.transaction(async tx => {
        await tx.execute(sql`select 1`);
        await tx.execute(sql`select ${i}::int`);
        return i;
      }),
    );
    const results = await Promise.all([...transactions, ...aPageOfReads(db)]);
    expect(results.slice(0, DB_MAX_CONNECTIONS * 3)).toEqual(Array.from({ length: DB_MAX_CONNECTIONS * 3 }, (_, i) => i));
    expect(fake.stacked).toBe(0);
  });

  it("lets a transaction that fails give its connection back", async () => {
    const fake = await fakePostgres();
    const db = databaseOn(fake);
    const failing = Array.from({ length: DB_MAX_CONNECTIONS * 2 }, () =>
      db.transaction(async tx => {
        await tx.execute(sql`select 1`);
        throw new Error("refused");
      }),
    );
    const settled = await Promise.allSettled(failing);
    expect(settled.every(result => result.status === "rejected")).toBe(true);
    /* Every place was handed back: a page of reads still runs. */
    await Promise.all(aPageOfReads(db));
    expect(fake.stacked).toBe(0);
  });

  /* A check that finds nothing passes, so this one shows the fake can see the
     fault: the same reads straight through postgres.js do stack. */
  it("would stack without the gate, which is what the gate is for", async () => {
    const fake = await fakePostgres();
    const client = postgres({ ...DB_CLIENT_OPTIONS, host: "127.0.0.1", port: fake.port, user: "netlet", database: "netlet", fetch_types: false });
    ends.push(() => client.end({ timeout: 1 }));
    const db = drizzle(client);
    await Promise.all(aPageOfReads(db as unknown as ReturnType<typeof databaseOn>));
    await Promise.all(aPageOfReads(db as unknown as ReturnType<typeof databaseOn>));
    expect(fake.stacked).toBeGreaterThan(0);
  });
});
