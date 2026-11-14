/** Kuwait's six governorates, in the order the government lists them. */
export const GOVERNORATES = [
  { slug: "capital", en: "Capital", ar: "العاصمة" },
  { slug: "hawalli", en: "Hawalli", ar: "حولي" },
  { slug: "farwaniya", en: "Farwaniya", ar: "الفروانية" },
  { slug: "mubarak-al-kabeer", en: "Mubarak Al-Kabeer", ar: "مبارك الكبير" },
  { slug: "ahmadi", en: "Ahmadi", ar: "الأحمدي" },
  { slug: "jahra", en: "Jahra", ar: "الجهراء" },
] as const;
export type Governorate = (typeof GOVERNORATES)[number]["slug"];

export function isGovernorate(value: unknown): value is Governorate {
  return GOVERNORATES.some(g => g.slug === value);
}

export function governorateName(slug: Governorate, lang: "en" | "ar"): string {
  return GOVERNORATES.find(g => g.slug === slug)?.[lang] ?? slug;
}

/**
 * Kuwait is UTC+3 all year, with no summer time, so a Kuwaiti day and clock
 * are a fixed offset from UTC. Every date ShipLee shows and every time staff
 * type are Kuwaiti, whatever the computer showing or typing them is set to.
 */
export const KUWAIT_OFFSET_MS = 3 * 60 * 60 * 1000;
export const KUWAIT_ZONE = "Asia/Kuwait";

/** Today's date in Kuwait, as yyyy-mm-dd. */
export function kuwaitDay(at: Date = new Date()): string {
  return new Date(at.getTime() + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
}

/** A Kuwaiti wall-clock time ("2026-11-14T15:20") as the instant it names. */
export function fromKuwaitClock(local: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const utc = Date.UTC(y, mo - 1, d, h, mi) - KUWAIT_OFFSET_MS;
  const back = new Date(utc + KUWAIT_OFFSET_MS);
  /* Refuse what the calendar does not have (31 February), which Date.UTC would roll over. */
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return new Date(utc);
}

/** An instant as Kuwait's wall clock, the shape a datetime-local box takes. */
export function toKuwaitClock(at: Date): string {
  return new Date(at.getTime() + KUWAIT_OFFSET_MS).toISOString().slice(0, 16);
}

/** Whether yyyy-mm-dd is a real calendar day. */
export function isDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
