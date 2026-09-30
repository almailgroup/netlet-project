/**
 * Which store owns an account, and the order sign-in asks them in.
 *
 * Against a real Postgres, because the part worth testing is what happens to
 * the *row*: an account adopted by Supabase has to end up with one credential
 * column set and the other cleared, or `storeFor` answers whichever it happens
 * to check first and the account is signed in against a service that does not
 * hold its password.
 *
 * Supabase is stubbed. What it answers is its own module's tests; this is about
 * the dispatch.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { users } from "../../drizzle/schema.js";

let db: ReturnType<typeof drizzle>;
let store: typeof import("./passwordStore.js");

/** What the stubbed services were asked, so the order can be asserted. */
let asked: string[];
/** Which passwords each service accepts, keyed `email:password`. */
const supabaseKnows = new Map<string, { uid: string; name: string | null }>();
/** Stands in for the real `SupabaseEmailTaken`, which the stub replaces. */
class SupabaseEmailTakenStub extends Error {}
let supabaseOn = true;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../drizzle");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
}, 60_000);

beforeEach(async () => {
  asked = [];
  supabaseKnows.clear();
  supabaseOn = true;
  await db.delete(users);
  vi.resetModules();

  vi.doMock("./supabaseAuth.js", () => ({
    isSupabaseAuthConfigured: () => supabaseOn,
    verifySupabasePassword: async (email: string, password: string) => {
      asked.push("supabase.verify");
      return supabaseKnows.get(`${email}:${password}`) ? { ...supabaseKnows.get(`${email}:${password}`)!, email } : null;
    },
    createSupabaseUser: async (input: { email: string; password: string; name?: string | null }) => {
      asked.push("supabase.create");
      /* Supabase refuses a second account on one address, and the refusal is
         the gate `createLogin` relies on — a stub that allowed it would be
         testing a door that is not there. */
      if ([...supabaseKnows.keys()].some(key => key.startsWith(`${input.email}:`))) {
        throw new SupabaseEmailTakenStub();
      }
      const uid = `sb-${supabaseKnows.size + 1}`;
      supabaseKnows.set(`${input.email}:${input.password}`, { uid, name: input.name ?? null });
      return { uid, email: input.email, name: input.name ?? null };
    },
    updateSupabaseUser: async () => { asked.push("supabase.update"); },
    deleteSupabaseUser: async () => { asked.push("supabase.delete"); },
    sendSupabasePasswordReset: async () => { asked.push("supabase.reset"); },
    isSupabaseEmailTaken: (error: unknown) => error instanceof SupabaseEmailTakenStub,
    SupabaseEmailTaken: SupabaseEmailTakenStub,
  }));

  /* `logins.ts` takes `getDb` from `db.ts` as an import, which is the whole
     reason those three writes live outside it — so this redirects the real
     thing rather than reimplementing it in the mock. */
  vi.doMock("../db.js", async () => {
    const actual = await vi.importActual<typeof import("../db.js")>("../db.js");
    return { ...actual, getDb: async () => db };
  });

  store = await import("./passwordStore.js");
});

afterEach(() => vi.doUnmock("./supabaseAuth.js"));

const row = async (email: string) => (await db.select().from(users).where(eq(users.email, email)))[0];

describe("which store owns an account", () => {
  /* The column is the provider, so there is no flag to disagree with it. */
  it("reads it off the column that is set", () => {
    expect(store.storeFor({ supabaseUid: "s", passwordHash: null })).toBe("supabase");
    expect(store.storeFor({ supabaseUid: null, passwordHash: "h" })).toBe("local");
  });

  /*
   * Supabase wins a row that somehow has both. It has to be a fixed order
   * rather than "whichever we notice", and the hosted store is the right one:
   * `linkExternalUser` clears the digest precisely so this never happens, and
   * if it did, the account was most recently moved to Supabase.
   */
  it("prefers Supabase on a row that has both, rather than answering at random", () => {
    expect(store.storeFor({ supabaseUid: "s", passwordHash: "h" })).toBe("supabase");
  });

  /*
   * Never "local" for a hosted account whose service is switched off. Falling
   * through to a null digest is the one case that could be read as a match.
   */
  it("still names the service when that service is unconfigured", () => {
    supabaseOn = false;
    expect(store.storeFor({ supabaseUid: "s", passwordHash: null })).toBe("supabase");
    expect(store.isUsable({ supabaseUid: "s", passwordHash: null })).toBe(false);
  });

  it("calls an account with no credential at all unusable", () => {
    expect(store.isUsable({ supabaseUid: null, passwordHash: null })).toBe(false);
  });
});

describe("where a new account goes", () => {
  it("is Supabase when it is configured", () => {
    expect(store.activeStore()).toBe("supabase");
  });

  /* The fallback is what lets `pnpm dev` run before any third-party account
     exists, which is the whole reason the local digest is still here. */
  it("falls back to the local digest when it is not", async () => {
    supabaseOn = false;
    expect(store.activeStore()).toBe("local");
  });
});

describe("creating a login", () => {
  it("puts the credential in Supabase and mirrors the row", async () => {
    const user = await store.createLogin({ email: "new@shop.test", password: "Harbour-Falcon-2026", name: "Noura" });
    expect(user.supabaseUid).toBe("sb-1");
    expect(user.passwordHash).toBeNull();
    expect((await row("new@shop.test")).supabaseUid).toBe("sb-1");
  });

  it("uses the local digest when nothing is configured", async () => {
    supabaseOn = false;
    const user = await store.createLogin({ email: "local@shop.test", password: "Harbour-Falcon-2026" });
    expect(user.supabaseUid).toBeNull();
    expect(user.passwordHash).toBeTruthy();
  });

  it("refuses a second account on the same address", async () => {
    await store.createLogin({ email: "twice@shop.test", password: "Harbour-Falcon-2026" });
    await expect(store.createLogin({ email: "twice@shop.test", password: "Harbour-Falcon-2026" }))
      .rejects.toBeInstanceOf(store.EmailTakenError);
  });

  /*
   * The takeover. Registering cannot adopt a row, because the store's own
   * "already registered" refusal is silent for an address the store has never
   * held — which is every account whose password is somewhere else. Both of
   * these passed as a *takeover* before `createLogin` stopped writing through
   * `linkExternalUser`: same id, same role, and the register procedure then
   * signs a session cookie for it.
   *
   * Asserted on the row as well as on the refusal, because the damage is done by
   * the UPDATE rather than by what is returned: a cleared `password_hash` locks
   * the real owner out even if the attacker is handed nothing.
   */
  it("refuses an address whose row holds a local digest, and leaves that digest alone", async () => {
    await db.insert(users).values({
      email: "shopper@shop.test", passwordHash: "scrypt-digest", name: "Shopper", role: "admin",
    });

    await expect(store.createLogin({ email: "shopper@shop.test", password: "Attacker-Pass-2026" }))
      .rejects.toBeInstanceOf(store.EmailTakenError);

    const after = await row("shopper@shop.test");
    expect(after.passwordHash).toBe("scrypt-digest");
    expect(after.supabaseUid).toBeNull();
    expect(after.role).toBe("admin");
  });

  /*
   * And a row with no usable credential at all is refused too, which is the
   * sharper case: it looks like an address going spare, and it is not. Rows
   * like this exist — an account whose credential was removed in the Supabase
   * dashboard, or a row left behind by a provider this codebase has since
   * dropped. The orders and the role hanging off that id are still somebody's.
   */
  it("refuses an address whose row has no usable credential", async () => {
    await db.insert(users).values({ email: "old@shop.test", name: "Old", role: "admin" });

    await expect(store.createLogin({ email: "old@shop.test", password: "Attacker-Pass-2026" }))
      .rejects.toBeInstanceOf(store.EmailTakenError);

    const after = await row("old@shop.test");
    expect(after.supabaseUid).toBeNull();
    expect(after.role).toBe("admin");
  });

  /*
   * And the credential it had just made goes back, or the address is held
   * against the honest retry forever — the store would answer "already
   * registered" for a user nothing points at.
   */
  it("hands back the credential it created when the address turns out to be taken", async () => {
    await db.insert(users).values({ email: "taken@shop.test", passwordHash: "scrypt-digest" });
    await expect(store.createLogin({ email: "taken@shop.test", password: "Attacker-Pass-2026" }))
      .rejects.toBeInstanceOf(store.EmailTakenError);
    expect(asked).toEqual(["supabase.create", "supabase.delete"]);
  });
});

describe("signing in", () => {
  it("asks Supabase first and stops there", async () => {
    await store.createLogin({ email: "a@shop.test", password: "Harbour-Falcon-2026" });
    asked = [];
    const user = await store.signIn("a@shop.test", "Harbour-Falcon-2026");
    expect(user?.email).toBe("a@shop.test");
    expect(asked).toEqual(["supabase.verify"]);
  });

  /*
   * An account written before Supabase was configured keeps working after it
   * is, which is the property that makes turning it on a safe change: the
   * active store is asked first and the row's own store second.
   */
  it("still signs in an account on the local digest", async () => {
    supabaseOn = false;
    await store.createLogin({ email: "hash@shop.test", password: "Harbour-Falcon-2026" });
    supabaseOn = true;
    const user = await store.signIn("hash@shop.test", "Harbour-Falcon-2026");
    expect(user?.email).toBe("hash@shop.test");
  });

  /*
   * A credential added by hand in the Supabase dashboard is a NetLet login on
   * first sign-in. That is what makes the Authentication page a place an admin
   * can actually work from rather than only read.
   */
  it("adopts a credential that exists in Supabase with no row here yet", async () => {
    supabaseKnows.set("dashboard@shop.test:Harbour-Falcon-2026", { uid: "sb-dash", name: "Added By Hand" });
    expect(await row("dashboard@shop.test")).toBeUndefined();

    const user = await store.signIn("dashboard@shop.test", "Harbour-Falcon-2026");
    expect(user?.supabaseUid).toBe("sb-dash");
    expect((await row("dashboard@shop.test")).name).toBe("Added By Hand");
  });

  /*
   * Adopting must leave exactly one credential column set, or the row has two
   * password stores and `storeFor` picks one of them.
   */
  it("clears the old credential when it adopts a row", async () => {
    await db.insert(users).values({ email: "moving@shop.test", passwordHash: "old-digest" });
    supabaseKnows.set("moving@shop.test:Harbour-Falcon-2026", { uid: "sb-moved", name: null });

    await store.signIn("moving@shop.test", "Harbour-Falcon-2026");
    const after = await row("moving@shop.test");
    expect(after.supabaseUid).toBe("sb-moved");
    expect(after.passwordHash).toBeNull();
  });

  it("answers null for a wrong password without saying which store refused", async () => {
    await store.createLogin({ email: "b@shop.test", password: "Harbour-Falcon-2026" });
    await expect(store.signIn("b@shop.test", "not-the-password")).resolves.toBeNull();
  });

  it("answers null for an address with no account anywhere", async () => {
    await expect(store.signIn("nobody@shop.test", "Harbour-Falcon-2026")).resolves.toBeNull();
  });
});

describe("confirming the current password", () => {
  it("asks the store that holds it, not the one new accounts use", async () => {
    supabaseOn = false;
    await store.createLogin({ email: "old2@shop.test", password: "Harbour-Falcon-2026" });
    supabaseOn = true;
    const user = await row("old2@shop.test");

    await expect(store.verifyCurrent(user, "Harbour-Falcon-2026")).resolves.toBe(true);
    /* Supabase is the active store and was never asked: the row decides. */
    expect(asked).toEqual([]);
    await expect(store.verifyCurrent(user, "wrong")).resolves.toBe(false);
  });

  /* A null digest must never be read as a match. */
  it("refuses an account with no credential rather than waving it through", async () => {
    await db.insert(users).values({ email: "empty@shop.test" });
    const user = await row("empty@shop.test");
    await expect(store.verifyCurrent(user, "anything")).resolves.toBe(false);
  });
});

describe("sending a reset", () => {
  /*
   * Without looking the address up first. Asking which store holds it would
   * make the reply vary by address, which is the enumeration this endpoint is
   * built not to allow.
   */
  it("asks the configured service, without looking up the address first", async () => {
    await store.sendReset("whoever@shop.test", "en");
    expect(asked).toEqual(["supabase.reset"]);
  });

  it("reports honestly that nothing can be sent when none is configured", async () => {
    supabaseOn = false;
    expect(store.canSendReset()).toBe(false);
    await store.sendReset("whoever@shop.test", "en");
    expect(asked).toEqual([]);
  });
});
