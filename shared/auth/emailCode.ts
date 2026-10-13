/**
 * The code that proves somebody owns the address they are registering with.
 *
 * Six digits, sent to the address, typed back before the account exists. Pure
 * and shared for the password floor's reason: the box on the form and the
 * procedure behind it read a code the same way, so the page cannot accept what
 * the API refuses.
 *
 * **What is typed is folded before it is read.** An Arabic keyboard types
 * Arabic-Indic digits, a phone pastes "123 456" or "123-456" from the email, and
 * a mail client can carry an invisible mark beside the number. All of that is the
 * same six digits, and refusing any of it would refuse a person who did exactly
 * what the email said.
 */

/** How many digits the code has. Supabase's email codes are six. */
export const CODE_LENGTH = 6;

/**
 * How long before "Send a new code" is offered again.
 *
 * Supabase sends at most one email to an address a minute, so offering it
 * sooner is a button that fails, and a second email arriving while the first
 * is still on its way is how somebody ends up typing the older code.
 */
export const RESEND_WAIT_SECONDS = 60;

const ARABIC_INDIC = /[٠-٩]/g;
const EXTENDED_ARABIC_INDIC = /[۰-۹]/g;

/** Digits only, in ASCII, at most `CODE_LENGTH` of them. */
export function normaliseCode(raw: string): string {
  return raw
    .replace(ARABIC_INDIC, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(EXTENDED_ARABIC_INDIC, digit => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, "")
    .slice(0, CODE_LENGTH);
}

/** Whether a folded code has the shape of one — the length, and nothing but digits. */
export function isCodeShaped(code: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code);
}
