/**
 * Keeping a conversation on NetLet (3.8).
 *
 * The requirement for the chat is mostly this file. A chat between a shopper
 * and a seller is, on day one, the easiest way to take a sale off the
 * platform: "message me on WhatsApp, 9988 7766, cheaper without the fees". The
 * order then has no protection, no return window, no record — and NetLet is
 * the one the shopper blames. So a message carrying a way to reach somebody
 * outside NetLet is refused, and the sender is told which of four things it
 * carried: a phone number, an email, a link, or a handle on another platform.
 *
 * Pure, and imported by both sides, for the reason the password floor is: the
 * composer can say what is wrong *as somebody types*, and the API refuses the
 * same thing for the same reason, so the page cannot send what the server
 * would bounce.
 *
 * ## The obfuscations are the requirement
 *
 * Nobody who means to get round a filter types `99887766`. They type it in
 * Arabic-Indic digits, or `99 88 77 66`, or `nine nine eight eight…`, or
 * `noura at gmail dot com`, or `n o u r a @ g m a i l`. Each of those is
 * normalised into a plain view before anything is looked for, and every one
 * has a test.
 *
 * ## And so are the false positives
 *
 * A filter that refuses "I need two by Thursday" or "it was KWD 12,500.000" is
 * a filter people learn to hate and then route around. The shapes that look
 * like a phone number and are not — an order reference, a date, a price with a
 * currency beside it — are let through by name, and every one has a test too.
 *
 * This is mitigation and not proof. Somebody determined can always describe a
 * number in a way no rule anticipates; what this does is make the casual
 * version fail loudly and the deliberate version obviously deliberate, which
 * is what a moderator then has to go on.
 */

export const CONTACT_KINDS = ["phone", "email", "link", "handle"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

/** Longest a message may be. A chat, not a letter. */
export const MAX_MESSAGE_LENGTH = 2000;

/* Arabic-Indic (U+0660…) and Eastern Arabic-Indic (U+06F0…) digits. */
const foldDigits = (text: string) =>
  text.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0));

/*
 * Digits spelled as words. Replaced everywhere, which is harmless: "two" alone
 * becomes "2" and a lone digit is not a phone number. Only a *run* of them
 * becomes one, and a run is broken by any real word in between.
 */
const SPELLED: [RegExp, string][] = [
  [/\bzero\b/g, "0"], [/\bone\b/g, "1"], [/\btwo\b/g, "2"], [/\bthree\b/g, "3"], [/\bfour\b/g, "4"],
  [/\bfive\b/g, "5"], [/\bsix\b/g, "6"], [/\bseven\b/g, "7"], [/\beight\b/g, "8"], [/\bnine\b/g, "9"],
];
/* Arabic words carry prefixes (و "and"), so they are matched as whole tokens
   with an optional و rather than with \b, which does not see Arabic letters. */
const SPELLED_AR: [string[], string][] = [
  [["صفر"], "0"], [["واحد", "وحدة"], "1"], [["اثنين", "اثنان", "إثنين", "ثنين", "اتنين"], "2"],
  [["ثلاثة", "ثلاث", "تلاتة", "تلات"], "3"], [["اربعة", "أربعة", "اربع", "أربع"], "4"], [["خمسة", "خمس"], "5"],
  [["ستة", "ست"], "6"], [["سبعة", "سبع"], "7"], [["ثمانية", "ثمان", "تمانية"], "8"], [["تسعة", "تسع"], "9"],
];

function spellOut(text: string): string {
  let out = text;
  for (const [shape, digit] of SPELLED) out = out.replace(shape, digit);
  for (const [words, digit] of SPELLED_AR) {
    for (const word of words) {
      out = out.replace(new RegExp(`(^|[^\\p{L}])و?${word}(?=[^\\p{L}]|$)`, "gu"), `$1${digit}`);
    }
  }
  return out;
}

/** The text as the rules read it: one script of digits, lower case, compatibility forms folded. */
export function normaliseForContact(text: string): string {
  return spellOut(foldDigits(text.normalize("NFKC").toLowerCase()));
}

/* Separators somebody puts between digits to break up a number. */
const SEP = "[\\s\\-.()\\[\\]/_*,|:+~]";
const DIGIT_RUN = new RegExp(`(?:\\+|00)?\\d(?:${SEP}{0,3}\\d){6,}`, "g");

const ORDER_REFERENCE = /\bnl-\d{8}-[a-z]{5}\b/g;
const CURRENCY = /(kwd|kd|د\.?\s?ك|دينار|dinar|fils|فلس)/;

function isDate(run: string): boolean {
  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(run);
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(run);
  const parts = ymd ? [ymd[1], ymd[2], ymd[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : null;
  if (!parts) return false;
  const [year, month, day] = parts.map(Number);
  /* "9988-77-66" has the shape and is not a date, which is the point. */
  return year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function isPrice(run: string, around: string): boolean {
  /* Only beside a currency: "12500.000" alone is as good a way to write a
     number as any, and letting every decimal through would be the hole. */
  return /^\d{1,3}(?:,\d{3})*(?:\.\d{1,3})?$|^\d+\.\d{3}$/.test(run.trim()) && CURRENCY.test(around);
}

function hasPhone(view: string): boolean {
  const text = view.replace(ORDER_REFERENCE, " ");
  for (const match of text.matchAll(DIGIT_RUN)) {
    const run = match[0];
    const digits = run.replace(/\D/g, "").length;
    const international = /^(\+|00)/.test(run);
    if (digits < 8 && !(international && digits >= 7)) continue;
    if (isDate(run.trim())) continue;
    const start = match.index ?? 0;
    const around = text.slice(Math.max(0, start - 12), start + run.length + 12);
    if (isPrice(run, around)) continue;
    return true;
  }
  return false;
}

/*
 * "n o u r a" → "noura": single characters separated by single spaces are
 * joined, in a view used only for addresses and links. Ordinary prose almost
 * never produces an email shape out of that, and an address typed letter by
 * letter always does.
 */
const joinSpelledLetters = (text: string) => text.replace(/(?<=(?:^|\s)\S) (?=\S(?:\s|$))/g, "");

function addressView(view: string): string {
  return (
    joinSpelledLetters(view)
      .replace(/\s*[([{<]\s*(?:at|@)\s*[)\]}>]\s*/g, "@")
      .replace(/\s*[([{<]\s*(?:dot|\.)\s*[)\]}>]\s*/g, ".")
      .replace(/\s+at\s+(?=[a-z0-9-]+\s*(?:\.|dot\b|[([{<]))/g, "@")
      .replace(/\s+dot\s+(?=[a-z]{2,})/g, ".")
      .replace(/\s+(?:آت|أت)\s+/g, "@")
      .replace(/\s+(?:نقطة|دوت)\s+/g, ".")
      .replace(/\s*@\s*/g, "@")
      .replace(/(?<=[a-z0-9])\s*\.\s*(?=(?:com|net|org|io|me|co|kw|ly|gl|app)\b)/g, ".")
  );
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/;
const MAIL_PROVIDER = /(^|[^a-z])(gmail|hotmail|yahoo|outlook|icloud|protonmail)([^a-z]|$)/;
const LINK = /(?:https?:\/\/|www\.)\S+|(?:^|[^a-z0-9@._-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|me|co|kw|ly|gl|app|link|info|biz|store|shop|xyz|online|site)(?![a-z0-9])/;
const AT_HANDLE = /(?:^|[^a-z0-9._%+-])@[a-z0-9_.]{3,}/;
const PLATFORMS_LATIN = /(^|[^a-z])(whats\s?app|watsapp|wtsp|insta|instagram|snapchat|telegram|tiktok|tik\s?tok|facebook|messenger|twitter|threads|signal|viber|imo)([^a-z]|$)/;
const PLATFORMS_ARABIC = /(واتس|وتساب|انستا|إنستا|انستقرام|انستغرام|سناب|تيليجرام|تلغرام|تليجرام|تيك\s?توك|فيسبوك|فيس\s?بوك|ماسنجر|تويتر|سيجنال)/;

/**
 * Which ways off the platform this message carries, in a fixed order, or an
 * empty list when it carries none.
 */
export function contactFindings(text: string): ContactKind[] {
  const view = normaliseForContact(text);
  const addresses = addressView(view);
  const found = new Set<ContactKind>();

  if (hasPhone(view)) found.add("phone");
  if (EMAIL.test(addresses) || MAIL_PROVIDER.test(view)) found.add("email");
  /* An address is not also a link because it has a dot in it. */
  if (LINK.test(addresses.replace(new RegExp(EMAIL.source, "g"), " "))) found.add("link");
  if (AT_HANDLE.test(view.replace(new RegExp(EMAIL.source, "g"), " ")) || PLATFORMS_LATIN.test(view) || PLATFORMS_ARABIC.test(view)) {
    found.add("handle");
  }

  return CONTACT_KINDS.filter(kind => found.has(kind));
}

/** Whether a message may be sent as written. */
export function isOnPlatform(text: string): boolean {
  return contactFindings(text).length === 0;
}
