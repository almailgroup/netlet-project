/**
 * What Supabase hands back when a link in one of its own emails is opened.
 *
 * Every link in those emails goes through Supabase first: it checks the link,
 * then sends the browser on to NetLet's sign-in page (the `redirect_to` the
 * server asks for) with the outcome in the address — a token for the account
 * in the fragment when the link worked (`#access_token=…&type=recovery`), or
 * an error when it had expired or been used (`#error_code=otp_expired`, and on
 * some versions the same in the query). Nothing read it, so the link signed
 * into Supabase and the shopper was left on a page that said nothing: a reset
 * changed no password, and a sign-up link — the default "Confirm your mail"
 * template — confirmed an address and then showed a home page, or, with the
 * project's Site URL still `http://localhost:3000`, a blank one.
 *
 * Read once as the app starts (`catchEmailReturn`), before the router does,
 * and the address is put back to a plain `/signin` at once: the token is a
 * key to the account for an hour and must not stay in the address bar, the
 * history, a bookmark or a screenshot. The sign-in form then reads it
 * (`peekEmailReturn`) and says what to do next.
 */
import { BASE_PATH } from "./basePath";

export type EmailReturn =
  /** A sign-up link, or any other kind Supabase confirms: the address is confirmed in Supabase. */
  | { kind: "confirmed" }
  /** A reset link: the token sets the new password, and nothing else. */
  | { kind: "reset"; token: string; email: string | null }
  /** A link that had expired or was already used. */
  | { kind: "expired" };

/** The address in a token's payload, for saying whose password is being set. Display only — the server checks the token. */
export function emailFromToken(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "="));
    const email = (JSON.parse(json) as { email?: unknown }).email;
    return typeof email === "string" && email.includes("@") ? email : null;
  } catch {
    return null;
  }
}

/** Pure: what the address says Supabase did, or null when it is not Supabase's return at all. */
export function readEmailReturn(hash: string, search: string): EmailReturn | null {
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const query = new URLSearchParams(search.replace(/^\?/, ""));
  /* An error needs its code or its description beside it: a bare `error` in a
     query is too ordinary a word to take for Supabase's. */
  const failed = [fragment, query].some(params => params.has("error_code") || (params.has("error") && params.has("error_description")));
  if (failed) return { kind: "expired" };

  const token = fragment.get("access_token");
  const type = fragment.get("type");
  if (!token || !type) return null;
  if (type === "recovery") return { kind: "reset", token, email: emailFromToken(token) };
  return { kind: "confirmed" };
}

let pending: EmailReturn | null = null;

/** As the app starts: keeps what Supabase handed back and puts the address back to plain `/signin`. */
export function catchEmailReturn(): void {
  if (typeof window === "undefined") return;
  const found = readEmailReturn(window.location.hash, window.location.search);
  if (!found) return;
  pending = found;
  window.history.replaceState(null, "", `${BASE_PATH}/signin`);
}

/** What the sign-in form arrived with. Read, not taken, because a strict-mode render runs its initialiser twice. */
export function peekEmailReturn(): EmailReturn | null {
  return pending;
}

/** Once the form has it, so a later visit to the form starts plain. */
export function clearEmailReturn(): void {
  pending = null;
}
