/**
 * Which store owns an account, and the order sign-in asks them in.
 *
 * Against a real Postgres, because the part worth testing is what happens to
 * the *row*: a Firebase account adopted by Supabase has to end up with one
 * credential column set and the others cleared, or `storeFor` answers whichever
 * it happens to check first and the account is signed in against a service that
 * does not hold its password.
 *
 * The two services are stubbed. What they answer is their own modules' tests;
 * this is about the dispatch.
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
const firebaseKnows = new Map<string, { uid: string; name: string | null }>();
/** Stands in for the real `SupabaseEmailTaken`, which the stub replaces. */
class SupabaseEmailTakenStub extends Error {}
let supabaseOn = true;
let firebaseOn = true;

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
  firebaseKnows.clear();
  supabaseOn = true;
  firebaseOn = true;
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

  vi.doMock("./firebase.js", () => ({
    isFirebaseConfigured: () => firebaseOn,
    verifyFirebasePassword: async (email: string, password: string) => {
      asked.push("firebase.verify");
      return firebaseKnows.get(`${email}:${password}`) ? { ...firebaseKnows.get(`${email}:${password}`)!, email } : null;
    },
    sendFirebasePasswordReset: async () => { asked.push("firebase.reset"); },
    getFirebaseAuth: () => (firebaseOn ? { updateUser: async () => { asked.push("firebase.update"); }, deleteUser: async () => { asked.push("firebase.delete"); }, createUser: async () => ({ uid: "fb-new" }) } : null),
    isEmailInUse: () => false,
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
    expect(store.storeFor({ supabaseUid: "s", firebaseUid: null, passwordHash: null })).toBe("supabase");
    expect(store.storeFor({ supabaseUid: null, firebaseUid: "f", passwordHash: null })).toBe("firebase");
    expect(store.storeFor({ supabaseUid: null, firebaseUid: null, passwordHash: "h" })).toBe("local");
  });

  /*
   * Supabase wins a row that somehow has both. It has to be a fixed order
   * rather than "whichever we notice", and the newer store is the right one:
   * `linkExternalUser` clears the other column precisely so this never happens,
   * and if it did, the account was most recently moved to Supabase.
   */
  it("prefers Supabase on a row that has both, rather than answering at random", () => {
    expect(store.storeFor({ supabaseUid: "s", firebaseUid: "f", passwordHash: "h" })).toBe("supabase");
  });

  /*
   * Never "local" for a hosted account whose service is switched off. Falling
   * through to a null digest is the one case that could be read as a match.
   */
  it("still names the service when that service is unconfigured", () => {
    supabaseOn = false;
    expect(store.storeFor({ supabaseUid: "s", firebaseUid: null, passwordHash: null })).toBe("supabase");
    expect(store.isUsable({ supabaseUid: "s", firebaseUid: null, passwordHash: null })).toBe(false);
  });

  it("calls an account with no credential at all unusable", () => {
    expect(store.isUsable({ supabaseUid: null, firebaseUid: null, passwordHash: null })).toBe(false);
  });
});

describe("where a new account goes", () => {
  it("is Supabase when it is configured", () => {
    expect(store.activeStore()).toBe("supabase");
  });

  it("falls back to Firebase, then to the local digest", async () => {
    supabaseOn = false;
    expect(store.activeStore()).toBe("firebase");
    firebaseOn = false;
    expect(store.activeStore()).toBe("local");
  });
});

describe("creating a login", () => {
  it("puts the credential in Supabase and mirrors the row", async () => {
    const user = await store.createLogin({ email: "new@shop.test", password: "Harbour-Falcon-2026", name: "Noura" });
    expect(user.supabaseUid).toBe("sb-1");
    expect(user.firebaseUid).toBeNull();
    expect(user.passwordHash).toBeNull();
    expect((await row("new@shop.test")).supabaseUid).toBe("sb-1");
  });

  it("uses the local digest when nothing is configured", async () => {
    supabaseOn = false;
    firebaseOn = false;
    const user = await store.createLogin({ email: "local@shop.test", password: "Harbour-Falcon-2026" });
    expect(user.supabaseUid).toBeNull();
    expect(user.passwordHash).toBeTruthy();
  });

  it("refuses a second account on the same address", async () => {
    await store.createLogin({ email: "twice@shop.test", password: "Harbour-Falcon-2026" });
    await expect(store.createLogin({ email: "twice@shop.test", password: "Harbour-Falcon-2026" }))
      .rejects.toBeInstanceOf(store.EmailTakenError);
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
   * The whole reason the Firebase path stays. An account made before the move
   * has its password in Firebase and nowhere else; checking only the active
   * store would lock it out on the day the move happened.
   */
  it("still signs in an account whose password is in Firebase", async () => {
    await db.insert(users).values({ email: "old@shop.test", firebaseUid: "fb-7", name: "Old Hand" });
    firebaseKnows.set("old@shop.test:Harbour-Falcon-2026", { uid: "fb-7", name: "Old Hand" });

    const user = await store.signIn("old@shop.test", "Harbour-Falcon-2026");
    expect(user?.id).toBeGreaterThan(0);
    expect(asked).toEqual(["supabase.verify", "firebase.verify"]);
  });

  it("still signs in an account on the local digest", async () => {
    supabaseOn = false;
    firebaseOn = false;
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
    await db.insert(users).values({ email: "moving@shop.test", firebaseUid: "fb-9", passwordHash: "old-digest" });
    supabaseKnows.set("moving@shop.test:Harbour-Falcon-2026", { uid: "sb-moved", name: null });

    await store.signIn("moving@shop.test", "Harbour-Falcon-2026");
    const after = await row("moving@shop.test");
    expect(after.supabaseUid).toBe("sb-moved");
    expect(after.firebaseUid).toBeNull();
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
    await db.insert(users).values({ email: "old2@shop.test", firebaseUid: "fb-11" });
    firebaseKnows.set("old2@shop.test:right", { uid: "fb-11", name: null });
    const user = await row("old2@shop.test");

    await expect(store.verifyCurrent(user, "right")).resolves.toBe(true);
    expect(asked).toEqual(["firebase.verify"]);
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
   * Both, when both are configured: the address could belong to either, and
   * looking up which would make the reply vary by address — the enumeration
   * this endpoint is built not to allow.
   */
  it("asks every configured service, without looking up the address first", async () => {
    await store.sendReset("whoever@shop.test", "en");
    expect(asked).toEqual(["supabase.reset", "firebase.reset"]);
  });

  it("reports honestly that nothing can be sent when neither is configured", async () => {
    supabaseOn = false;
    firebaseOn = false;
    expect(store.canSendReset()).toBe(false);
    await store.sendReset("whoever@shop.test", "en");
    expect(asked).toEqual([]);
  });
});
