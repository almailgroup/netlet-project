/**
 * How good a password is, and — more usefully — what is still wrong with it.
 *
 * A bare colour bar tells somebody they have failed without telling them how
 * to stop failing, so this returns the unmet requirements by name and lets the
 * meter render them. The score exists to drive the bar; the list is the part
 * that actually helps.
 *
 * Pure and in `shared/` for the usual reason: the server enforces the floor
 * and the client draws the meter, and neither should be able to disagree with
 * the other about what a valid password is.
 */

/** The floor, matched by the zod schema on `auth.register`. */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * The requirements, in the order the meter lists them.
 *
 * Length is the only one that is *required* — the rest raise the score but
 * cannot block a sign-up. Composition rules that refuse a long passphrase in
 * favour of "P@ss1" make passwords worse, and NIST stopped recommending them
 * for that reason; they are shown here as advice, not as gates.
 */
export type PasswordRule = "length" | "case" | "number" | "symbol" | "notCommon";

export type PasswordBand = "weak" | "fair" | "good" | "strong";

export type PasswordVerdict = {
  /** 0–4, the number of filled segments on the bar. */
  score: number;
  band: PasswordBand;
  /** Rules this password does not yet satisfy, in display order. */
  unmet: PasswordRule[];
  /** False only when a rule that actually blocks submission is unmet. */
  acceptable: boolean;
};

/*
 * The handful of shapes that defeat any amount of length.
 *
 * Deliberately short: a real breach list belongs on the server behind an API,
 * and shipping one to the browser would be megabytes. This catches the
 * keyboard-mashing that a strength meter exists to discourage, and says so
 * rather than pretending to be a breach check.
 */
const COMMON = [
  "password", "passw0rd", "qwerty", "letmein", "welcome", "iloveyou",
  "admin", "administrator", "netlet", "kuwait", "123456", "12345678",
  "abc123", "monkey", "dragon", "football", "baseball", "sunshine",
];

function isCommon(password: string): boolean {
  const lower = password.toLowerCase();
  // A long sequence of digits, or a run of one character, is the same failure.
  if (/^(\d)\1+$/.test(password) || /^(.)\1+$/.test(password)) return true;
  if (/^(0123456789|1234567890|9876543210)/.test(password)) return true;
  return COMMON.some(word => lower.includes(word));
}

export function checkPassword(password: string): PasswordVerdict {
  const unmet: PasswordRule[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) unmet.push("length");
  if (!(/[a-z]/.test(password) && /[A-Z]/.test(password))) unmet.push("case");
  if (!/\d/.test(password)) unmet.push("number");
  if (!/[^A-Za-z0-9]/.test(password)) unmet.push("symbol");
  if (password.length > 0 && isCommon(password)) unmet.push("notCommon");

  // An empty box is not a weak password; it is an unanswered question.
  if (password.length === 0) {
    return { score: 0, band: "weak", unmet, acceptable: false };
  }

  /*
   * Length carries the most weight, because it is what actually resists a
   * guess. A 20-character passphrase of plain lowercase words beats a
   * 10-character soup of symbols, and a meter that says otherwise teaches
   * people the wrong lesson.
   */
  let score = 0;
  if (password.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (password.length >= 14) score += 1;
  if (password.length >= 20) score += 1;
  if (!unmet.includes("case")) score += 1;
  if (!unmet.includes("number")) score += 0.5;
  if (!unmet.includes("symbol")) score += 0.5;

  // A common shape collapses the score whatever else it has going for it.
  if (unmet.includes("notCommon")) score = Math.min(score, 1);
  if (unmet.includes("length")) score = Math.min(score, 1);

  score = Math.max(0, Math.min(4, Math.round(score)));
  const band: PasswordBand = score <= 1 ? "weak" : score === 2 ? "fair" : score === 3 ? "good" : "strong";

  return {
    score,
    band,
    unmet,
    // Only length blocks. The rest are advice, and refusing a long passphrase
    // for want of a symbol would make the password worse, not better.
    acceptable: !unmet.includes("length") && !unmet.includes("notCommon"),
  };
}
