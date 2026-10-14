/**
 * NetLet's public contact details, as the footer and the help page draw them.
 *
 * Every one comes from the deployment's own settings (`SUPPORT_PHONE`,
 * `SUPPORT_EMAIL`, `SUPPORT_ADDRESS`, `SOCIAL_*`), and a malformed one is
 * *absent*, never a link to nobody: a footer that offers an address bouncing
 * every message, or an icon opening somebody else's account, is worse than
 * one that offers less. The phone, the email and the address NetLet publishes
 * are the defaults (`NETLET_CONTACT`, the owner's own), so they show on a
 * deployment that has set nothing; a setting replaces one, and a setting left
 * empty removes it.
 *
 * Pure and shared, so the server decides what is published and the page draws
 * exactly that.
 */

/** NetLet's own published contact details, as the owner gave them. */
export const NETLET_CONTACT = {
  phone: "+965 2512 3456",
  email: "support@netlet.com",
  address: "Kuwait City, Kuwait",
  addressAr: "مدينة الكويت، الكويت",
} as const;

/** A support address, lowercased, or null. Deliberately plain: one @, a dot after it, no spaces. */
export function contactEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  return /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(value) && value.length <= 254 ? value : null;
}

/**
 * A support number as people read one aloud: a Kuwaiti number as
 * `+965 5000 1234`, anything else as `+` and its digits. Takes what
 * `supportNumber` returns — digits only, the country code first.
 */
export function displayNumber(digits: string): string {
  const kuwait = /^965(\d{4})(\d{4})$/.exec(digits);
  return kuwait ? `+965 ${kuwait[1]} ${kuwait[2]}` : `+${digits}`;
}

export function mailLink(address: string): string {
  return `mailto:${address}`;
}

/** Where a shopper can call in, in each language; the Arabic falls back to the English. */
export type Visit = { address: string; addressAr: string | null };

export function visitDetails(address: string, addressAr: string): Visit | null {
  const english = address.trim().slice(0, 200);
  if (!english) return null;
  return { address: english, addressAr: addressAr.trim().slice(0, 200) || null };
}

/** The address on a map, opened in the shopper's own maps app or Google Maps. */
export function mapsLink(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/**
 * The places NetLet may have an account, in the order the footer draws them —
 * Instagram and Snapchat first, being where Kuwait's shoppers are.
 */
export const SOCIAL_PLATFORMS = ["instagram", "snapchat", "tiktok", "x", "youtube", "facebook"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** The hosts each platform's profiles live on; a link anywhere else is refused. */
const HOSTS: Record<SocialPlatform, string[]> = {
  instagram: ["instagram.com"],
  snapchat: ["snapchat.com"],
  tiktok: ["tiktok.com"],
  x: ["x.com", "twitter.com"],
  youtube: ["youtube.com"],
  facebook: ["facebook.com"],
};

/**
 * A profile link, or null. https only, and on that platform's own host (or a
 * subdomain of it, `www.` and the like) — so a variable pasted into the wrong
 * box, or a lookalike domain, draws no icon rather than a link nobody meant.
 */
export function socialLink(platform: SocialPlatform, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const allowed = HOSTS[platform].some(own => host === own || host.endsWith(`.${own}`));
  if (!allowed || url.pathname === "/" || url.pathname === "") return null;
  return url.toString();
}

export type SocialLink = { platform: SocialPlatform; url: string };

/** Every configured profile, in the footer's order, skipping the ones that are not. */
export function socialLinks(raw: Partial<Record<SocialPlatform, string>>): SocialLink[] {
  return SOCIAL_PLATFORMS.flatMap(platform => {
    const url = socialLink(platform, raw[platform] ?? "");
    return url ? [{ platform, url }] : [];
  });
}

/**
 * Who NetLet is, as an invoice names it — the company, its commercial
 * registration and its registered address, which a Kuwaiti shop shows its
 * customers. Null when no name is recorded: a registration number with no
 * company beside it says nothing.
 */
export type Company = { name: string; nameAr: string | null; licence: string | null; address: string | null };

/**
 * The company's name for the middle of a sentence: without its own closing
 * full stop, which the sentence after it supplies — "© 2026 Example Co.." and
 * "run by Example Co.." otherwise.
 */
export function nameInSentence(name: string): string {
  return name.trim().replace(/[.\s]+$/, "");
}

export function companyDetails(raw: { name: string; nameAr: string; licence: string; address: string }): Company | null {
  const name = raw.name.trim();
  if (!name) return null;
  const clean = (value: string) => value.trim() || null;
  return { name, nameAr: clean(raw.nameAr), licence: clean(raw.licence), address: clean(raw.address) };
}
