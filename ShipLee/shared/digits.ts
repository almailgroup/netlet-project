/**
 * Arabic-Indic (٠–٩) and Eastern Arabic-Indic (۰–۹) digits read as the digits
 * they are. Somebody typing on an Arabic keyboard is typing a number, and a
 * tracking number or a phone that only works in Latin digits fails them for
 * no reason.
 */
export function foldDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, ch => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}
