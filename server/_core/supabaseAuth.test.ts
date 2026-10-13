/**
 * The HTTP Supabase Auth actually speaks, with `fetch` stubbed.
 *
 * Every one of these is a detail that fails *silently* if it is wrong. A
 * registration that omits `email_confirm` creates the user, shows it on the
 * dashboard's Authentication page, and then refuses every sign-in with "Email
 * not confirmed" — so the happy path looks finished and nobody can get in. A
 * wrong-password response read as an error turns a mistyped password into a 500.
 * And sending the service-role key to a public endpoint would put the key that
 * owns the whole project in every sign-in request.
 *
 * Stubbed rather than pointed at a real project, because the assertions here are
 * about the request NetLet sends. A live project can tell us it answered; only
 * this can tell us we asked the right thing with the right key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const URL_BASE = "https://proj.supabase.co";
const ANON = "anon-key-public";
const SERVICE = "service-role-key-secret";

let auth: typeof import("./supabaseAuth.js");
let calls: { url: string; init: RequestInit }[];

/** One canned response, and a record of what was asked to get it. */
function stubFetch(responses: { status: number; body?: unknown }[]) {
  const queue = [...responses];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = queue.shift() ?? { status: 200, body: {} };
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body ?? {},
      text: async () => JSON.stringify(next.body ?? {}),
    } as unknown as Response;
  }));
}

const headerOf = (index: number, name: string) =>
  ((calls[index].init.headers ?? {}) as Record<string, string>)[name];
const bodyOf = (index: number) => JSON.parse(String(calls[index].init.body));

beforeEach(async () => {
  calls = [];
  vi.resetModules();
  process.env.SUPABASE_URL = URL_BASE;
  process.env.SUPABASE_ANON_KEY = ANON;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;
  auth = await import("./supabaseAuth.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("being configured", () => {
  it("needs all three values", async () => {
    expect(auth.isSupabaseAuthConfigured()).toBe(true);
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.resetModules();
    const again = await import("./supabaseAuth.js");
    expect(again.isSupabaseAuthConfigured()).toBe(false);
  });

  it("joins paths cleanly over a url with a trailing slash", async () => {
    process.env.SUPABASE_URL = `${URL_BASE}/`;
    vi.resetModules();
    const again = await import("./supabaseAuth.js");
    stubFetch([{ status: 200, body: { id: "u1", email: "a@b.test" } }]);
    await again.createSupabaseUser({ email: "a@b.test", password: "x" });
    expect(calls[0].url).toBe(`${URL_BASE}/auth/v1/admin/users`);
  });
});

describe("creating a user", () => {
  it("confirms the email, or nobody could ever sign in", async () => {
    stubFetch([{ status: 200, body: { id: "u1", email: "a@b.test", user_metadata: { name: "Noura" } } }]);
    const user = await auth.createSupabaseUser({ email: "a@b.test", password: "pw", name: "Noura" });

    expect(user).toEqual({ uid: "u1", email: "a@b.test", name: "Noura" });
    expect(calls[0].url).toBe(`${URL_BASE}/auth/v1/admin/users`);
    expect(bodyOf(0).email_confirm).toBe(true);
    expect(bodyOf(0).user_metadata).toEqual({ name: "Noura" });
  });

  it("goes to the admin endpoint with the service-role key, never the anon one", async () => {
    stubFetch([{ status: 200, body: { id: "u1" } }]);
    await auth.createSupabaseUser({ email: "a@b.test", password: "pw" });
    expect(headerOf(0, "apikey")).toBe(SERVICE);
    expect(headerOf(0, "authorization")).toBe(`Bearer ${SERVICE}`);
  });

  it("reads a taken address as taken, at each status Supabase uses for it", async () => {
    for (const response of [
      { status: 422, body: {} },
      { status: 409, body: {} },
      { status: 400, body: { msg: "A user with this email address has already been registered" } },
    ]) {
      calls = [];
      stubFetch([response]);
      await expect(auth.createSupabaseUser({ email: "a@b.test", password: "pw" }))
        .rejects.toBeInstanceOf(auth.SupabaseEmailTaken);
    }
  });

  it("does not read a plain bad request as a taken address", async () => {
    stubFetch([{ status: 400, body: { msg: "Password should be at least 6 characters" } }]);
    const failure = auth.createSupabaseUser({ email: "a@b.test", password: "x" });
    await expect(failure).rejects.toThrow(/HTTP 400/);
    await expect(failure).rejects.not.toBeInstanceOf(auth.SupabaseEmailTaken);
  });

  it("refuses a success with no id rather than storing an empty uid", async () => {
    stubFetch([{ status: 200, body: {} }]);
    await expect(auth.createSupabaseUser({ email: "a@b.test", password: "pw" })).rejects.toThrow(/no id/);
  });
});

describe("verifying a password", () => {
  it("uses the password grant with the anon key, and never the service key", async () => {
    stubFetch([{ status: 200, body: { user: { id: "u1", email: "a@b.test" } } }]);
    const user = await auth.verifySupabasePassword("a@b.test", "pw");

    expect(user).toEqual({ uid: "u1", email: "a@b.test", name: null });
    expect(calls[0].url).toBe(`${URL_BASE}/auth/v1/token?grant_type=password`);
    expect(headerOf(0, "apikey")).toBe(ANON);
    expect(headerOf(0, "apikey")).not.toBe(SERVICE);
    expect(headerOf(0, "authorization")).not.toContain(SERVICE);
  });

  /*
   * Wrong password, unknown address, banned user, unconfirmed email: one answer.
   * Telling them apart is a way to ask Supabase which addresses are registered.
   */
  it("answers null for every rejection, the same way", async () => {
    for (const status of [400, 401]) {
      calls = [];
      stubFetch([{ status, body: { error: "invalid_grant" } }]);
      await expect(auth.verifySupabasePassword("a@b.test", "wrong")).resolves.toBeNull();
    }
  });

  it("throws on a fault, because that is not a wrong password", async () => {
    stubFetch([{ status: 503, body: {} }]);
    await expect(auth.verifySupabasePassword("a@b.test", "pw")).rejects.toThrow(/HTTP 503/);
  });

  it("answers null when Supabase is not configured at all", async () => {
    delete process.env.SUPABASE_URL;
    vi.resetModules();
    const again = await import("./supabaseAuth.js");
    stubFetch([]);
    await expect(again.verifySupabasePassword("a@b.test", "pw")).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("reads a name out of user_metadata, and ignores one that is not a name", async () => {
    stubFetch([{ status: 200, body: { user: { id: "u1", email: "a@b.test", user_metadata: { name: 42 } } } }]);
    await expect(auth.verifySupabasePassword("a@b.test", "pw")).resolves.toEqual({ uid: "u1", email: "a@b.test", name: null });
  });
});

describe("the reset email", () => {
  it("asks the recover endpoint with the anon key", async () => {
    stubFetch([{ status: 200, body: {} }]);
    await auth.sendSupabasePasswordReset("a@b.test", "en");
    expect(calls[0].url).toBe(`${URL_BASE}/auth/v1/recover`);
    expect(headerOf(0, "apikey")).toBe(ANON);
    expect(bodyOf(0)).toEqual({ email: "a@b.test" });
  });

  /* An address with no account must look exactly like one that has it. */
  it("is silent for an unknown address", async () => {
    for (const status of [400, 422]) {
      calls = [];
      stubFetch([{ status, body: {} }]);
      await expect(auth.sendSupabasePasswordReset("nobody@b.test", "ar")).resolves.toBeUndefined();
    }
  });

  it("throws on a fault, which the caller logs rather than reports", async () => {
    stubFetch([{ status: 500, body: {} }]);
    await expect(auth.sendSupabasePasswordReset("a@b.test", "en")).rejects.toThrow(/HTTP 500/);
  });
});

describe("updating a user", () => {
  it("sends only the fields given", async () => {
    stubFetch([{ status: 200, body: {} }]);
    await auth.updateSupabaseUser("u1", { password: "new-one" });
    expect(calls[0].url).toBe(`${URL_BASE}/auth/v1/admin/users/u1`);
    expect(calls[0].init.method).toBe("PUT");
    expect(bodyOf(0)).toEqual({ password: "new-one" });
  });

  /* Clearing a name and leaving it alone are different instructions. */
  it("tells a cleared name from an unmentioned one", async () => {
    stubFetch([{ status: 200, body: {} }, { status: 200, body: {} }]);
    await auth.updateSupabaseUser("u1", { name: null });
    expect(bodyOf(0)).toEqual({ user_metadata: { name: null } });
    await auth.updateSupabaseUser("u1", { email: "c@d.test" });
    expect(bodyOf(1)).toEqual({ email: "c@d.test" });
  });

  it("does not spend a round trip on an empty patch", async () => {
    stubFetch([]);
    await auth.updateSupabaseUser("u1", {});
    expect(calls).toHaveLength(0);
  });

  it("reads a taken address as taken", async () => {
    stubFetch([{ status: 422, body: {} }]);
    await expect(auth.updateSupabaseUser("u1", { email: "taken@b.test" }))
      .rejects.toBeInstanceOf(auth.SupabaseEmailTaken);
  });

  it("escapes the uid into the path", async () => {
    stubFetch([{ status: 200, body: {} }]);
    await auth.updateSupabaseUser("a/../b", { password: "x" });
    expect(calls[0].url).toBe(`${URL_BASE}/auth/v1/admin/users/a%2F..%2Fb`);
  });
});

describe("deleting a user", () => {
  it("treats a missing user as done", async () => {
    stubFetch([{ status: 404, body: {} }]);
    await expect(auth.deleteSupabaseUser("gone")).resolves.toBeUndefined();
  });

  it("throws on anything else, so a rollback cannot fail in silence", async () => {
    stubFetch([{ status: 500, body: {} }]);
    await expect(auth.deleteSupabaseUser("u1")).rejects.toThrow(/HTTP 500/);
  });
});

/*
 * Registering with a code. The shopper's door is the public sign-up endpoint
 * with the anon key — never the admin one, which would make the account
 * confirmed and skip the code entirely.
 */
describe("signing up with a code", () => {
  it("goes to the public sign-up endpoint with the anon key and the name as metadata", async () => {
    stubFetch([{ status: 200, body: { id: "u1", email: "a@b.test", identities: [{ id: "i1" }], confirmation_sent_at: "now" } }]);
    await expect(auth.signUpSupabaseUser({ email: "a@b.test", password: "Harbour-Falcon-2026", name: "Noura" }))
      .resolves.toEqual({ kind: "codeSent" });
    expect(calls[0].url).toBe(`${URL_BASE}/auth/v1/signup`);
    expect(headerOf(0, "apikey")).toBe(ANON);
    expect(headerOf(0, "authorization")).toBe(`Bearer ${ANON}`);
    expect(bodyOf(0)).toEqual({ email: "a@b.test", password: "Harbour-Falcon-2026", data: { name: "Noura" } });
  });

  /* GoTrue's disguise for an address it already holds, confirmed: a user with
     no identities and no mail sent. Waiting on it would wait for nothing. */
  it("reads a user with no identities as a taken address", async () => {
    stubFetch([{ status: 200, body: { id: "fake", email: "a@b.test", identities: [] } }]);
    await expect(auth.signUpSupabaseUser({ email: "a@b.test", password: "x" })).rejects.toBeInstanceOf(auth.SupabaseEmailTaken);
  });

  it("reads Supabase's mail ceiling as a code not sent, not a fault", async () => {
    stubFetch([{ status: 429, body: { error_code: "over_email_send_rate_limit" } }]);
    await expect(auth.signUpSupabaseUser({ email: "a@b.test", password: "x" })).rejects.toBeInstanceOf(auth.SupabaseMailLimited);
  });

  it("says when the project confirmed the address itself and sent nothing", async () => {
    stubFetch([{ status: 200, body: { access_token: "t", user: { id: "u2", email: "a@b.test" } } }]);
    await expect(auth.signUpSupabaseUser({ email: "a@b.test", password: "x" }))
      .resolves.toEqual({ kind: "confirmed", user: { uid: "u2", email: "a@b.test", name: null } });
  });

  it("checks the code as an email code, with the anon key", async () => {
    stubFetch([{ status: 200, body: { access_token: "t", user: { id: "u3", email: "a@b.test" } } }]);
    await expect(auth.verifySupabaseSignupCode("a@b.test", "482913")).resolves.toMatchObject({ uid: "u3" });
    expect(calls[0].url).toBe(`${URL_BASE}/auth/v1/verify`);
    expect(headerOf(0, "apikey")).toBe(ANON);
    expect(bodyOf(0)).toEqual({ type: "email", email: "a@b.test", token: "482913" });
  });

  it("answers null for a wrong or expired code, at each status GoTrue uses", async () => {
    for (const status of [400, 403, 410, 422]) {
      stubFetch([{ status, body: { msg: "Token has expired or is invalid" } }]);
      await expect(auth.verifySupabaseSignupCode("a@b.test", "000000")).resolves.toBeNull();
    }
  });

  it("resends the sign-up mail, silently for an address with nothing waiting", async () => {
    stubFetch([{ status: 200, body: {} }, { status: 422, body: { msg: "nothing to resend" } }]);
    await auth.resendSupabaseSignupCode("a@b.test");
    await expect(auth.resendSupabaseSignupCode("nobody@b.test")).resolves.toBeUndefined();
    expect(calls[0].url).toBe(`${URL_BASE}/auth/v1/resend`);
    expect(bodyOf(0)).toEqual({ type: "signup", email: "a@b.test" });
  });

  /* The right password on an account whose code never came back. */
  it("tells an unconfirmed account apart from a wrong password at sign-in", async () => {
    stubFetch([{ status: 400, body: { error_code: "email_not_confirmed", msg: "Email not confirmed" } }]);
    await expect(auth.signInSupabase("a@b.test", "right")).resolves.toBe("unconfirmed");
    stubFetch([{ status: 400, body: { error_code: "invalid_credentials", msg: "Invalid login credentials" } }]);
    await expect(auth.signInSupabase("a@b.test", "wrong")).resolves.toBeNull();
    stubFetch([{ status: 400, body: { error_code: "email_not_confirmed" } }]);
    await expect(auth.verifySupabasePassword("a@b.test", "right")).resolves.toBeNull();
  });
});
