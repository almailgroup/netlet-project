/**
 * A store's own details, and the rules for them.
 *
 * Pure, like the rest of `Shared/inventory`, so the admin form and the server
 * agree about what a valid store looks like without the form having to guess.
 *
 * Everything here is *optional* on a vendor row. An admin opening a store
 * should not be blocked because the licence number is on a document nobody has
 * scanned yet — so completeness is something the page reports, not something
 * the database refuses. What is validated is only what would be actively
 * wrong: a payout IBAN whose check digits do not add up is worse than a blank
 * one, because it looks done.
 */

/** The six governorates, matching the delivery zones in `Shared/customer.ts`. */
export const GOVERNORATES = [
  "capital",
  "hawalli",
  "farwaniya",
  "ahmadi",
  "jahra",
  "mubarak-al-kabeer",
] as const;
export type Governorate = (typeof GOVERNORATES)[number];

export function isGovernorate(value: string): value is Governorate {
  return (GOVERNORATES as readonly string[]).includes(value);
}

/**
 * A store name turned into a URL-safe slug.
 *
 * Unlike `categorySlug`, an unusable name yields an empty string rather than a
 * fallback: "all" is a sensible default department, but a vendor silently
 * named after a fallback is a store nobody can find. The caller decides what
 * to do with empty — the form asks, the server refuses.
 */
export function storeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * An IBAN as it is checked, stored and sent to the bank: no spaces or hyphens,
 * upper case, and in a Kuwaiti one the bank code read as the letters it must
 * be.
 *
 * A Kuwaiti IBAN is KW, two check digits, a four-letter bank code (NBOK, CBKU,
 * KFHO…) and twenty-two characters of account, so a 0 or a 1 among those four
 * can only be an O or an I typed on the wrong row. "KW75NB0K…" for the
 * National Bank was refused as bad check digits, which sent whoever typed it
 * to stare at the digits; read as NBOK it passes, and mod-97 is still what
 * says whether it is right. Nowhere else: in the rest of an IBAN a digit is a
 * digit, and a guess there would be a guess about where money goes.
 */
export function normaliseIban(raw: string): string {
  const iban = raw.replace(/[\s-]/g, "").toUpperCase();
  if (!iban.startsWith("KW") || iban.length < 8) return iban;
  const bank = iban.slice(4, 8).replace(/0/g, "O").replace(/1/g, "I");
  return iban.slice(0, 4) + bank + iban.slice(8);
}

/**
 * The IBAN as it will be saved, when that is not what was typed beyond its
 * spaces and case — so the form can say it ("Saved as KW75NBOK…") rather than
 * change somebody's typing under them.
 */
export function ibanReadAs(raw: string): string | null {
  const plain = raw.replace(/[\s-]/g, "").toUpperCase();
  const read = normaliseIban(raw);
  return read !== plain ? read : null;
}

/**
 * IBAN check digits, by the mod-97 rule in ISO 13616.
 *
 * Worth doing rather than matching a length: a transposed pair of digits is
 * the common typing mistake, it passes any length or prefix check, and it is
 * exactly what mod-97 exists to catch. Getting this wrong means a payout
 * leaves for an account that does not exist.
 */
export function isValidIban(raw: string): boolean {
  const iban = normaliseIban(raw);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) return false;

  // Move the first four characters to the end, then read letters as numbers.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    const value = character >= "A" && character <= "Z"
      ? character.charCodeAt(0) - 55 // A = 10 … Z = 35
      : Number(character);
    // Fold digit by digit: the whole number is far beyond a safe integer.
    remainder = (remainder * (value > 9 ? 100 : 10) + value) % 97;
  }
  return remainder === 1;
}

/** Kuwait numbers are eight digits, optionally with the +965 country code. */
export function isValidKuwaitPhone(raw: string): boolean {
  const digits = raw.replace(/[\s()-]/g, "");
  return /^(\+?965)?[0-9]{8}$/.test(digits);
}

export type StoreProfile = {
  contactEmail?: string | null;
  contactPhone?: string | null;
  governorate?: string | null;
  addressLine?: string | null;
  licenceNumber?: string | null;
  payoutIban?: string | null;
};

/**
 * Which details are still missing, so the portal can say so without refusing
 * the save. Order is the order the form shows them in.
 */
export function missingStoreDetails(profile: StoreProfile): (keyof StoreProfile)[] {
  const blank = (value: string | null | undefined) => !value || value.trim() === "";
  return (["contactEmail", "contactPhone", "governorate", "addressLine", "licenceNumber", "payoutIban"] as const)
    .filter(field => blank(profile[field]));
}
