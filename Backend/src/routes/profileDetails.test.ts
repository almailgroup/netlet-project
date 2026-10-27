/**
 * "Your profile"'s details — the name's parts, phone, gender, birthday and
 * nationality — against a real Postgres, and the minutes before the owner has
 * run the bootstrap, when the table is not there yet.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { users } from "../../database/schema.js";
import type { TrpcContext } from "../core/context.js";
import type { ZodError } from "zod";
import type { User } from "../../database/schema.js";

let db: ReturnType<typeof drizzle>;
let client: PGlite;
let appRouter: any;

function contextFor(user: User | null): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const reload = async (id: number) => (await db.select().from(users).where(eq(users.id, id)))[0];

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../database");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  /*
   * `getDb` is module-local inside db.ts, so overriding the export does not
   * redirect db.ts's own callers. The two reads the sign-in path makes are
   * therefore given here, against this same database — both are plain lookups,
   * not logic worth duplicating.
   */
  vi.doMock("../services/db", async importOriginal => {
    const actual = await importOriginal<typeof import("../services/db")>();
    return {
      ...actual,
      getDb: async () => db,
      touchLastSignedIn: async () => {},
    };
  });
  vi.stubEnv("JWT_SECRET", "a-test-secret-for-signing-sessions-0123456789");
  // `assertConfigured` refuses to sign anybody in without this. The value is
  // never dialled: `getDb` above is what the layer actually reaches for.
  vi.stubEnv("DATABASE_URL", "postgres://unused@localhost:5432/unused");
  ({ appRouter } = await import("./index.js"));
}, 60_000);


async function freshUser(email: string, name: string | null = "Noura Al-Sabah") {
  const [row] = await db.insert(users).values({ email, name }).returning();
  return row as User;
}

const as = (user: User) => appRouter.createCaller(contextFor(user));

describe("the profile's details", () => {
  it("answers nothing saved for somebody who has saved nothing", async () => {
    const user = await freshUser("blank@example.test");
    expect(await as(user).customer.details.get()).toEqual({
      firstName: null, lastName: null, phone: null, gender: null, birthday: null, nationality: null,
    });
  });

  it("keeps the name's parts and writes the display name from them", async () => {
    const user = await freshUser("parts@example.test");
    const answer = await as(user).auth.updateNameParts({ firstName: " Abdul Rahman ", lastName: "Al-Ali" });
    expect(answer.name).toBe("Abdul Rahman Al-Ali");
    expect((await reload(user.id)).name).toBe("Abdul Rahman Al-Ali");
    expect(await as(user).customer.details.get()).toMatchObject({ firstName: "Abdul Rahman", lastName: "Al-Ali" });
  });

  it("refuses a name without both parts, with the form's own key", async () => {
    const user = await freshUser("half@example.test");
    const refusal = await as(user).auth.updateNameParts({ firstName: "Noura", lastName: " " }).catch((error: unknown) => error);
    expect(refusal).toMatchObject({ code: "BAD_REQUEST" });
    // The error formatter answers the wire with the schema's key (`inputRefusal`).
    expect((refusal as { cause: ZodError }).cause.issues.map(issue => issue.message)).toContain("profile.nameRequired");
  });

  it("saves each field alone, never clearing the others", async () => {
    const user = await freshUser("fields@example.test");
    await as(user).customer.details.save({ phone: "٥٠١٢ ٣٤٥٦" });
    await as(user).customer.details.save({ gender: "female" });
    await as(user).customer.details.save({ birthday: "1990-05-17" });
    const all = await as(user).customer.details.save({ nationality: "KW" });
    expect(all).toMatchObject({ phone: "+96550123456", gender: "female", birthday: "1990-05-17", nationality: "KW" });

    const cleared = await as(user).customer.details.save({ gender: null, phone: "" });
    expect(cleared).toMatchObject({ phone: null, gender: null, birthday: "1990-05-17", nationality: "KW" });
  });

  it("refuses what the form refuses, by the form's own keys", async () => {
    const user = await freshUser("refused@example.test");
    await expect(as(user).customer.details.save({ phone: "123" })).rejects.toMatchObject({ message: "wishlist.phoneInvalid" });
    await expect(as(user).customer.details.save({ birthday: "2999-01-01" })).rejects.toMatchObject({ message: "profile.birthdayInvalid" });
    await expect(as(user).customer.details.save({ nationality: "EU" })).rejects.toMatchObject({ message: "profile.nationalityInvalid" });
  });

  it("is each shopper's own", async () => {
    const one = await freshUser("one@example.test");
    const two = await freshUser("two@example.test");
    await as(one).customer.details.save({ nationality: "EG" });
    expect((await as(two).customer.details.get()).nationality).toBeNull();
  });

  it("refuses a signed-out caller", async () => {
    await expect(appRouter.createCaller(contextFor(null)).customer.details.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  /* Last, since it drops the table: the live site between a deploy and the
     owner running the bootstrap. */
  it("keeps the page and the display name working before the table exists", async () => {
    const user = await freshUser("early@example.test");
    await client.exec("drop table customer_profiles");
    expect(await as(user).customer.details.get()).toMatchObject({ phone: null, nationality: null });
    expect((await as(user).auth.updateNameParts({ firstName: "Early", lastName: "Bird" })).name).toBe("Early Bird");
    await expect(as(user).customer.details.save({ gender: "male" })).rejects.toMatchObject({ message: "error.serverProblem" });
  });
});
