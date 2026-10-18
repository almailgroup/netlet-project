/**
 * Where `/signin?next=…` goes once somebody is signed in.
 *
 * Only a path on this site. `next` is in an address anybody can write and send,
 * so a sign-in page that went wherever it was told would be a NetLet-branded
 * door onto somebody else's phishing page — `//evil.example` is a path to a
 * browser's eye and another host to its address bar, and a tab or newline
 * inside it is dropped by the browser before it decides. Never back to the
 * sign-in pages themselves, which would be a loop.
 */
export const DEFAULT_RETURN_PATH = "/account";

export function returnPath(raw: string | null | undefined): string {
  const path = (raw ?? "").replace(/[\t\n\r]/g, "").trim();
  if (!/^\/(?![/\\])/.test(path)) return DEFAULT_RETURN_PATH;
  if (/^\/(signin|signup|login|register)(?:[/?#]|$)/i.test(path)) return DEFAULT_RETURN_PATH;
  return path;
}
