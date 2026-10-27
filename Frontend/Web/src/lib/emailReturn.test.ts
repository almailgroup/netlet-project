import { describe, expect, it } from "vitest";
import { emailFromToken, readEmailReturn } from "./emailReturn";

/** A token shaped like Supabase's: three dot-separated parts, the payload base64url JSON. */
function token(payload: object): string {
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `eyJhbGciOiJIUzI1NiJ9.${body}.signature`;
}

describe("what Supabase hands back from a link in its email", () => {
  it("reads a reset link's token and whose it is", () => {
    const access = token({ sub: "u1", email: "noura@example.com" });
    expect(readEmailReturn(`#access_token=${access}&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery`, ""))
      .toEqual({ kind: "reset", token: access, email: "noura@example.com" });
  });

  it("reads a sign-up link as a confirmed address, and keeps nothing of its token", () => {
    expect(readEmailReturn(`#access_token=${token({ email: "a@b.test" })}&type=signup`, "")).toEqual({ kind: "confirmed" });
    expect(readEmailReturn(`#access_token=${token({})}&type=magiclink`, "")).toEqual({ kind: "confirmed" });
  });

  it("reads an expired or used link, in the fragment or the query", () => {
    expect(readEmailReturn("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", ""))
      .toEqual({ kind: "expired" });
    expect(readEmailReturn("", "?error=access_denied&error_code=otp_expired")).toEqual({ kind: "expired" });
  });

  it("leaves every other address alone", () => {
    expect(readEmailReturn("", "")).toBeNull();
    expect(readEmailReturn("#main", "")).toBeNull();
    expect(readEmailReturn("", "?error=1")).toBeNull();
    expect(readEmailReturn("#access_token=x", "")).toBeNull();
    expect(readEmailReturn("", "?next=%2Faccount&q=error")).toBeNull();
  });

  it("names nobody from a token it cannot read", () => {
    expect(emailFromToken("not-a-token")).toBeNull();
    expect(emailFromToken("a.%%%.c")).toBeNull();
    expect(emailFromToken(token({ email: 42 }))).toBeNull();
  });
});
