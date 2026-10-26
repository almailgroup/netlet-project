/**
 * Keeping a sale on NetLet.
 *
 * Anything a seller writes that a shopper reads — a public reply to a review,
 * a paid banner's headline, a listing in the review queue — is a way to take a
 * sale off the platform: "message me on WhatsApp, 9988 7766, cheaper without
 * the fees". The order then has no protection, no return window, no record —
 * and NetLet is the one the shopper blames. So text carrying a way to reach
 * somebody outside NetLet is refused, and the writer is told which of four
 * things it carried: a phone number, an email, a link, or a handle on another
 * platform. NetLet's own words (support, guides, the assistants) are held to
 * it too. It was written for a shopper–store chat, which went on the owner's
 * word; the rule outlived it.
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

/* Arabic-Indic (U+0660…) and Eastern Arabic-Indic (U+06F0…) digits. */
const foldDigits = (text: string) =>
  text.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0));

/*
 * Digits spelled as words. Replaced everywhere, which is harmless: "two" alone
 * becomes "2" and a lone digit is not a phone number. Only a *run* of them
 * becomes one, and a run is broken by any real word in between.
 */
/* Bounded by "not a letter" rather than `\b`, because a digit is a word
   character to `\b`: "nine9eight8" has no boundary inside it at all. */
const word = (spelled: string) => new RegExp(`(?<![a-z])${spelled}(?![a-z])`, "g");
const SPELLED: [RegExp, string][] = [
  [word("zero"), "0"], [word("one"), "1"], [word("two"), "2"], [word("three"), "3"], [word("four"), "4"],
  [word("five"), "5"], [word("six"), "6"], [word("seven"), "7"], [word("eight"), "8"], [word("nine"), "9"],
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
/*
 * Characters that draw nothing or only dress up the one before them: zero-width
 * spaces and joiners, the word joiner, bidi marks, the soft hyphen (all format
 * characters, `\p{Cf}`), variation selectors, and the combining keycap that
 * turns 9 into 9️⃣. Each one sat between two digits broke the run, so
 * "99\u200b88\u200b77\u200b66" and a row of keycap emoji both read as clean —
 * and those are the obvious ways round a filter, not the clever ones.
 */
const INVISIBLE = /[\p{Cf}\u034f\u115f\u1160\u3164\uffa0\ufe00-\ufe0f\u20e3]/gu;

/* A letter standing in for a digit inside a number: "99O8 77l6". Only between
   digits, so "Grade A" and "size L" are untouched. */
const LOOKALIKE = /(?<=\d[\s\-.]{0,2})[oil|](?=[\s\-.]{0,2}\d)/g;
const LOOKALIKE_DIGIT: Record<string, string> = { o: "0", i: "1", l: "1", "|": "1" };

export function normaliseForContact(text: string): string {
  const plain = foldDigits(text.normalize("NFKC").replace(INVISIBLE, "").toLowerCase());
  return spellOut(plain).replace(LOOKALIKE, letter => LOOKALIKE_DIGIT[letter] ?? letter);
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
/* One list for both the spaced-dot join and the link shape: they were two, and
   "noura . shop" fell between them — joined for .com, never for .shop. */
const TLDS = "com|net|org|io|me|co|kw|ly|gl|app|link|info|biz|store|shop|xyz|online|site";

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
      .replace(new RegExp(`(?<=[a-z0-9])\\s*\\.\\s*(?=(?:${TLDS})\\b)`, "g"), ".")
  );
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/;
const MAIL_PROVIDER = /(^|[^a-z])(gmail|hotmail|yahoo|outlook|icloud|protonmail)([^a-z]|$)/;
const LINK = new RegExp(`(?:https?:\\/\\/|www\\.)\\S+|(?:^|[^a-z0-9@._-])[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:${TLDS})(?![a-z0-9])`);
const AT_HANDLE = /(?:^|[^a-z0-9._%+-])@[a-z0-9_.]{3,}/;
const PLATFORMS_LATIN = /(^|[^a-z])(whats\s?app|watsapp|wtsp|insta|instagram|snapchat|telegram|tiktok|tik\s?tok|facebook|messenger|twitter|threads|signal|viber|imo)([^a-z]|$)/;
/* "IG" is also a product code, so it counts only when it introduces a handle:
   followed by a colon, or by a name carrying the dot, underscore or digit a
   handle has and a word does not. "The IG model" stays a sentence. */
const IG_HANDLE = /(^|[^a-z])ig\s*(?::|\s+(?=[a-z0-9._]*[._\d])[a-z0-9._]{3,})/;
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
  if (AT_HANDLE.test(view.replace(new RegExp(EMAIL.source, "g"), " ")) || PLATFORMS_LATIN.test(view) || PLATFORMS_ARABIC.test(view) || IG_HANDLE.test(view)) {
    found.add("handle");
  }

  return CONTACT_KINDS.filter(kind => found.has(kind));
}

/** Whether a message may be sent as written. */
export function isOnPlatform(text: string): boolean {
  return contactFindings(text).length === 0;
}
