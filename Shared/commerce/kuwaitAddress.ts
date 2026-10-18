/**
 * A Kuwaiti address as its parts: area, block, street, avenue, house, floor,
 * apartment and the PACI number.
 *
 * Drivers here find a door by area, block, street and house, in that order, and
 * one free-text line left every shopper to remember that and spell it their
 * own way. The parts are what the forms ask for and what the address book and
 * the order keep; `address_line` stays, **composed** from them
 * (`composeAddressLine`), so every page, every export and every order placed
 * before the parts existed reads one line exactly as it always did.
 *
 * Pure and shared: the form and the server ask the same questions, so Save is
 * never a press the API refuses.
 */
import type { MessageKey } from "../i18n/dictionary.js";

export type AddressParts = {
  /** The area's English name when it is on the list (a stable key), or what was typed. */
  area?: string | null;
  block?: string | null;
  street?: string | null;
  /** Jadda — many blocks have none. */
  avenue?: string | null;
  /** House or building number. */
  building?: string | null;
  floor?: string | null;
  apartment?: string | null;
  /** The building's PACI number: eight digits. */
  paciNumber?: string | null;
};

export const PART_KEYS = ["area", "block", "street", "avenue", "building", "floor", "apartment", "paciNumber"] as const;
export type PartKey = (typeof PART_KEYS)[number];

/** The longest each part may be, matching its column. */
export const PART_MAX: Record<PartKey, number> = {
  area: 60, block: 10, street: 120, avenue: 60, building: 60, floor: 10, apartment: 20, paciNumber: 12,
};

/** What a driver cannot find the door without. */
export const REQUIRED_PARTS: readonly PartKey[] = ["area", "block", "street", "building"];

type Area = { en: string; ar: string };

/**
 * The residential and commercial areas of each governorate, by the governorate
 * ids in `Shared/customer.ts`. Not exhaustive by design — a shopper whose area
 * is not here chooses "another area" and types it — and kept here rather than
 * in a table, as the departments are, because it changes about once a decade.
 */
export const AREAS: Record<string, readonly Area[]> = {
  capital: [
    { en: "Abdullah Al-Salem", ar: "ضاحية عبدالله السالم" },
    { en: "Adailiya", ar: "العديلية" },
    { en: "Bneid Al-Qar", ar: "بنيد القار" },
    { en: "Daiya", ar: "الدعية" },
    { en: "Dasma", ar: "الدسمة" },
    { en: "Dasman", ar: "دسمان" },
    { en: "Doha", ar: "الدوحة" },
    { en: "Faiha", ar: "الفيحاء" },
    { en: "Granada", ar: "غرناطة" },
    { en: "Jaber Al-Ahmad", ar: "جابر الأحمد" },
    { en: "Kaifan", ar: "كيفان" },
    { en: "Khaldiya", ar: "الخالدية" },
    { en: "Mansouriya", ar: "المنصورية" },
    { en: "Mirqab", ar: "المرقاب" },
    { en: "Nahdha", ar: "النهضة" },
    { en: "North West Sulaibikhat", ar: "شمال غرب الصليبيخات" },
    { en: "Nuzha", ar: "النزهة" },
    { en: "Qadsiya", ar: "القادسية" },
    { en: "Qairawan", ar: "القيروان" },
    { en: "Qibla", ar: "القبلة" },
    { en: "Qortuba", ar: "قرطبة" },
    { en: "Rawda", ar: "الروضة" },
    { en: "Salhiya", ar: "الصالحية" },
    { en: "Shamiya", ar: "الشامية" },
    { en: "Sharq", ar: "شرق" },
    { en: "Shuwaikh", ar: "الشويخ" },
    { en: "Sulaibikhat", ar: "الصليبيخات" },
    { en: "Surra", ar: "السرة" },
    { en: "Yarmouk", ar: "اليرموك" },
  ],
  hawalli: [
    { en: "Bayan", ar: "بيان" },
    { en: "Bidaa", ar: "البدع" },
    { en: "Hawalli", ar: "حولي" },
    { en: "Hittin", ar: "حطين" },
    { en: "Jabriya", ar: "الجابرية" },
    { en: "Maidan Hawalli", ar: "ميدان حولي" },
    { en: "Mishref", ar: "مشرف" },
    { en: "Mubarak Al-Abdullah", ar: "مبارك العبدالله" },
    { en: "Rumaithiya", ar: "الرميثية" },
    { en: "Salam", ar: "السلام" },
    { en: "Salmiya", ar: "السالمية" },
    { en: "Salwa", ar: "سلوى" },
    { en: "Shaab", ar: "الشعب" },
    { en: "Shuhada", ar: "الشهداء" },
    { en: "Siddiq", ar: "الصديق" },
    { en: "Zahra", ar: "الزهراء" },
  ],
  farwaniya: [
    { en: "Abdullah Al-Mubarak", ar: "عبدالله المبارك" },
    { en: "Abraq Khaitan", ar: "أبرق خيطان" },
    { en: "Andalous", ar: "الأندلس" },
    { en: "Ardiya", ar: "العارضية" },
    { en: "Ashbeliya", ar: "إشبيلية" },
    { en: "Dhajeej", ar: "الضجيج" },
    { en: "Farwaniya", ar: "الفروانية" },
    { en: "Firdous", ar: "الفردوس" },
    { en: "Jleeb Al-Shuyoukh", ar: "جليب الشيوخ" },
    { en: "Khaitan", ar: "خيطان" },
    { en: "Omariya", ar: "العمرية" },
    { en: "Rabiya", ar: "الرابية" },
    { en: "Rai", ar: "الري" },
    { en: "Rehab", ar: "الرحاب" },
    { en: "Riggae", ar: "الرقعي" },
    { en: "Sabah Al-Nasser", ar: "صباح الناصر" },
  ],
  ahmadi: [
    { en: "Abu Halifa", ar: "أبو حليفة" },
    { en: "Ahmadi", ar: "الأحمدي" },
    { en: "Ali Sabah Al-Salem", ar: "علي صباح السالم" },
    { en: "Dhaher", ar: "الظهر" },
    { en: "Egaila", ar: "العقيلة" },
    { en: "Fahad Al-Ahmad", ar: "فهد الأحمد" },
    { en: "Fahaheel", ar: "الفحيحيل" },
    { en: "Fintas", ar: "الفنطاس" },
    { en: "Hadiya", ar: "هدية" },
    { en: "Jaber Al-Ali", ar: "جابر العلي" },
    { en: "Khairan", ar: "الخيران" },
    { en: "Mahboula", ar: "المهبولة" },
    { en: "Mangaf", ar: "المنقف" },
    { en: "Riqqa", ar: "الرقة" },
    { en: "Sabah Al-Ahmad", ar: "صباح الأحمد" },
    { en: "Sabahiya", ar: "الصباحية" },
    { en: "Wafra", ar: "الوفرة" },
  ],
  jahra: [
    { en: "Abdali", ar: "العبدلي" },
    { en: "Amghara", ar: "أمغرة" },
    { en: "Jahra", ar: "الجهراء" },
    { en: "Kabd", ar: "كبد" },
    { en: "Mutlaa", ar: "المطلاع" },
    { en: "Naeem", ar: "النعيم" },
    { en: "Nasseem", ar: "النسيم" },
    { en: "Oyoun", ar: "العيون" },
    { en: "Qasr", ar: "القصر" },
    { en: "Saad Al-Abdullah", ar: "سعد العبدالله" },
    { en: "Sulaibiya", ar: "الصليبية" },
    { en: "Taima", ar: "تيماء" },
    { en: "Waha", ar: "الواحة" },
  ],
  "mubarak-al-kabeer": [
    { en: "Abu Al-Hasaniya", ar: "أبو الحصانية" },
    { en: "Abu Fatira", ar: "أبو فطيرة" },
    { en: "Adan", ar: "العدان" },
    { en: "Fnaitees", ar: "الفنيطيس" },
    { en: "Masayel", ar: "المسايل" },
    { en: "Messila", ar: "المسيلة" },
    { en: "Mubarak Al-Kabeer", ar: "مبارك الكبير" },
    { en: "Qurain", ar: "القرين" },
    { en: "Qusour", ar: "القصور" },
    { en: "Sabah Al-Salem", ar: "صباح السالم" },
    { en: "Wista", ar: "الوسطى" },
  ],
};

/** An area's name in the reader's language, or the typed name when it is not on the list. */
export function areaLabel(area: string | null | undefined, arabic: boolean): string {
  const name = area?.trim() ?? "";
  if (!name) return "";
  for (const list of Object.values(AREAS)) {
    const found = list.find(entry => entry.en === name);
    if (found) return arabic ? found.ar : found.en;
  }
  return name;
}

/** The governorate an area on the list belongs to, so choosing an area can choose it too. */
export function governorateOfArea(area: string | null | undefined): string | null {
  const name = area?.trim();
  if (!name) return null;
  return Object.entries(AREAS).find(([, list]) => list.some(entry => entry.en === name))?.[0] ?? null;
}

/** Arabic-Indic and Persian digits as Latin, so "٤" and "4" are one block. */
export function latinDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0));
}

/** The parts as stored: trimmed, digits folded, blanks dropped. Null when nothing was given. */
export function cleanParts(parts: AddressParts | null | undefined): AddressParts | null {
  if (!parts) return null;
  const clean: AddressParts = {};
  for (const key of PART_KEYS) {
    const raw = parts[key];
    if (typeof raw !== "string") continue;
    const value = latinDigits(raw).replace(/\s+/g, " ").trim();
    if (value) clean[key] = key === "paciNumber" ? value.replace(/\D/g, "") : value;
  }
  return Object.keys(clean).length ? clean : null;
}

export function hasParts(parts: AddressParts | null | undefined): boolean {
  return cleanParts(parts) !== null;
}

/** What is actively wrong — too long, or a PACI number that is not eight digits. */
export function partsProblems(parts: AddressParts | null | undefined): MessageKey[] {
  const clean = cleanParts(parts);
  if (!clean) return [];
  const problems: MessageKey[] = [];
  for (const key of PART_KEYS) {
    if ((clean[key]?.length ?? 0) > PART_MAX[key]) {
      problems.push("address.partTooLong");
      break;
    }
  }
  if (clean.paciNumber && !/^\d{8}$/.test(clean.paciNumber)) problems.push("address.badPaci");
  return problems;
}

/** What a driver needs and the shopper has not given yet, as the parts it names. */
export function missingParts(parts: AddressParts | null | undefined): PartKey[] {
  const clean = cleanParts(parts) ?? {};
  return REQUIRED_PARTS.filter(key => !clean[key]);
}

const PART_LABEL_EN: Record<Exclude<PartKey, "area" | "paciNumber">, string> = {
  block: "Block", street: "Street", avenue: "Avenue", building: "House", floor: "Floor", apartment: "Apartment",
};
const PART_LABEL_AR: Record<Exclude<PartKey, "area" | "paciNumber">, string> = {
  block: "قطعة", street: "شارع", avenue: "جادة", building: "منزل", floor: "الدور", apartment: "شقة",
};

/**
 * The parts as one line, in the order a driver reads them: "Salmiya, Block 4,
 * Street 12, Avenue 3, House 15, Floor 2, Apartment 5, PACI 12345678".
 *
 * Stored in English as `address_line`, which is what every existing page,
 * export and dispatch sheet reads; `arabic` is for drawing it on an Arabic
 * page from the parts themselves.
 */
export function composeAddressLine(parts: AddressParts | null | undefined, arabic = false): string {
  const clean = cleanParts(parts);
  if (!clean) return "";
  const labels = arabic ? PART_LABEL_AR : PART_LABEL_EN;
  const pieces: string[] = [];
  if (clean.area) pieces.push(areaLabel(clean.area, arabic));
  for (const key of ["block", "street", "avenue", "building", "floor", "apartment"] as const) {
    if (clean[key]) pieces.push(`${labels[key]} ${clean[key]}`);
  }
  if (clean.paciNumber) pieces.push(`PACI ${clean.paciNumber}`);
  return pieces.join(arabic ? "، " : ", ");
}
