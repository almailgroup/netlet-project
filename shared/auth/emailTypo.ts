/**
 * "Did you mean …@gmail.com?" under the email box.
 *
 * A mistyped domain is the one sign-up mistake that cannot be noticed later:
 * the account is made, the welcome and reset mail go to `gmial.com`, and the
 * shopper who forgets their password has no way back in. So the form offers
 * the likely domain while there is still somebody looking at it.
 *
 * **It offers and never corrects.** Plenty of real addresses sit one letter
 * from a famous domain — `mail.com` is a provider of its own — so the address
 * stays as typed until the shopper presses the suggestion. Pure and shared,
 * like the password floor, though only the form asks it: the server has no
 * business second-guessing an address it was sent.
 */
import { editDistance } from "../commerce/search.js";

/**
 * The providers people in Kuwait actually type, and the near neighbours that
 * are real domains of their own, so `mail.com` is not "corrected" to Gmail.
 */
const KNOWN_DOMAINS = [
  "gmail.com", "googlemail.com",
  "hotmail.com", "outlook.com", "live.com", "msn.com",
  "yahoo.com", "ymail.com", "rocketmail.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "mail.com", "email.com", "gmx.com", "zoho.com",
  "proton.me", "protonmail.com",
] as const;

/**
 * Endings typed with a finger off by one, and what they stand for. Never a
 * real country's: `.om` is Oman next door and `.cm` is Cameroon.
 */
const ENDINGS: Record<string, string> = {
  con: "com", cmo: "com", ocm: "com", vom: "com", xom: "com", comm: "com",
  nte: "net", nett: "net", ner: "net",
  orgg: "org", ogr: "org",
};

/** How far a typed domain may be from a known one and still be taken as a slip. */
function tolerance(domain: string): number {
  return domain.length <= 7 ? 1 : 2;
}

/**
 * The address the shopper probably meant, or null when what they typed is a
 * known domain, is not yet an address, or is nothing like one we know.
 */
export function suggestEmail(input: string): string | null {
  const email = input.trim();
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  /* Still being typed, or not shaped like a domain at all. */
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  if ((KNOWN_DOMAINS as readonly string[]).includes(domain)) return null;

  let best: string | null = null;
  let bestDistance = Infinity;
  for (const known of KNOWN_DOMAINS) {
    const distance = editDistance(domain, known);
    if (distance < bestDistance) {
      best = known;
      bestDistance = distance;
    }
  }
  if (best && bestDistance > 0 && bestDistance <= tolerance(domain)) return `${local}@${best}`;

  /* Any other domain with a slipped ending, such as a company's own `example.con`. */
  const dot = domain.lastIndexOf(".");
  const fixed = ENDINGS[domain.slice(dot + 1)];
  return fixed ? `${local}@${domain.slice(0, dot)}.${fixed}` : null;
}
