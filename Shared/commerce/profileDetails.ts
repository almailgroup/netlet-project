/**
 * What "Your profile" may hold beyond the sign-in email and the password —
 * the owner's reference (Noon's "Your profile"): a first and a last name, a
 * phone, a gender, a birthday and a nationality. Pure and shared, so the form
 * says what is wrong as somebody types and the server refuses the same thing.
 *
 * **Everything but the name is optional, and none of it is shown to a
 * store.** The phone is the one that does something: checkout starts with it
 * as the number the driver calls. The rest stays on the account. The privacy
 * policy says so (`content/legal.ts`).
 *
 * **The name is stored in its parts, and the display name is written from
 * them.** `users.name` stays what greets the shopper and what every other page
 * reads, set to "first last" whenever the parts are saved, so there is one
 * place to change a name and nothing that reads `name` has to learn the parts.
 * An account with no parts yet is offered `splitName` of its display name to
 * start from — a guess the shopper corrects, never something saved for them.
 */
import { normalisePhone } from "./wishlist.js";

export const GENDERS = ["male", "female"] as const;
export type Gender = (typeof GENDERS)[number];

/** Each part of a name, at most. */
export const NAME_PART_MAX = 60;

/** The oldest birthday the form takes. */
export const EARLIEST_BIRTHDAY = "1900-01-01";

/**
 * Every country a nationality can be: ISO 3166-1's assigned codes, less the
 * uninhabited territories and the reserved ones, and with Kosovo (`XK`),
 * which ISO leaves user-assigned and everybody uses. The names come from the
 * browser and the phone in the page's own language (`Intl.DisplayNames`,
 * `Locale.localizedString(forRegionCode:)`), so nothing here is a word to
 * translate.
 */
export const COUNTRY_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AR", "AS", "AT", "AU", "AW",
  "AX", "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM",
  "BN", "BO", "BQ", "BR", "BS", "BT", "BW", "BY", "BZ", "CA", "CC", "CD", "CF",
  "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX",
  "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE", "EG", "EH", "ER",
  "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GT", "GU", "GW", "GY",
  "HK", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IQ", "IR", "IS",
  "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR",
  "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV",
  "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO",
  "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA", "NC",
  "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE",
  "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA",
  "RE", "RO", "RS", "RU", "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI",
  "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ",
  "TC", "TD", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV",
  "TW", "TZ", "UA", "UG", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI", "VN",
  "VU", "WF", "WS", "XK", "YE", "YT", "ZA", "ZM", "ZW",
] as const;

/**
 * The chips drawn before "View all": Kuwait, then the nationalities most of
 * the people living here hold, so most shoppers choose in one press.
 */
export const COMMON_NATIONALITIES = ["KW", "IN", "EG", "BD", "PH", "PK", "SA", "SY"] as const;

const COUNTRIES: ReadonlySet<string> = new Set(COUNTRY_CODES);

export function isCountryCode(value: string): boolean {
  return COUNTRIES.has(value);
}

/** A display name as a first word and the rest — the starting guess, never saved by itself. */
export function splitName(name: string | null | undefined): { first: string; last: string } {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return { first: words[0] ?? "", last: words.slice(1).join(" ") };
}

/** The display name the parts make. */
export function composeName(first: string, last: string): string {
  return [first.trim(), last.trim()].filter(Boolean).join(" ");
}

/** Why a pair of names cannot be saved, as a message key, or null. */
export function nameProblem(first: string, last: string): string | null {
  if (!first.trim() || !last.trim()) return "profile.nameRequired";
  if (first.trim().length > NAME_PART_MAX || last.trim().length > NAME_PART_MAX) return "profile.nameTooLong";
  return null;
}

/** The phone as stored (`+965…`), or the reason it cannot be. */
export function profilePhone(raw: string): { phone: string } | { problem: string } {
  const phone = normalisePhone(raw);
  return phone ? { phone } : { problem: "wishlist.phoneInvalid" };
}

/**
 * Why a birthday cannot be saved, or null. `today` is the Kuwaiti day
 * (`kuwaitDay`), so somebody born today can say so and nobody tomorrow.
 */
export function birthdayProblem(value: string, today: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "profile.birthdayInvalid";
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return "profile.birthdayInvalid";
  }
  if (value < EARLIEST_BIRTHDAY || value > today) return "profile.birthdayInvalid";
  return null;
}

/** What the profile page reads and writes. */
export type ProfileDetails = {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  gender: Gender | null;
  birthday: string | null;
  nationality: string | null;
};

export const NO_DETAILS: ProfileDetails = {
  firstName: null,
  lastName: null,
  phone: null,
  gender: null,
  birthday: null,
  nationality: null,
};
