/**
 * A store's own details, and the rules for them.
 *
 * Pure, like the rest of `shared/inventory`, so the admin form and the server
 * agree about what a valid store looks like without the form having to guess.
 *
 * Everything here is *optional* on a vendor row. An admin opening a store
 * should not be blocked because the licence number is on a document nobody has
 * scanned yet — so completeness is something the page reports, not something
 * the database refuses. What is validated is only what would be actively
 * wrong: a payout IBAN whose check digits do not add up is worse than a blank
 * one, because it looks done.
 */

/** The six governorates, matching the delivery zones in `shared/customer.ts`. */
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
 * IBAN check digits, by the mod-97 rule in ISO 13616.
 *
 * Worth doing rather than matching a length: a transposed pair of digits is
 * the common typing mistake, it passes any length or prefix check, and it is
 * exactly what mod-97 exists to catch. Getting this wrong means a payout
 * leaves for an account that does not exist.
 */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/[\s-]/g, "").toUpperCase();
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
