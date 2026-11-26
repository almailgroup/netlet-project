import { isTransportFailure } from "@/lib/transportFailure";
import { isMessageKey, translate, type LocaleCode } from "@shared/i18n/dictionary";

/**
 * A server-side failure in the shopper's language — `tError`'s rule, for code
 * that has a locale and no hook (`CustomerContext`, which `useTranslation`
 * reads). A key is translated; what the browser or the parser said is
 * `error.network`; an empty message is `error.serverProblem`; any other
 * sentence the server wrote is shown as it came.
 */
export function errorSentence(locale: LocaleCode, message: string): string {
  if (isMessageKey(message)) return translate(locale, message);
  if (isTransportFailure(message)) return translate(locale, "error.network");
  return message.trim() ? message : translate(locale, "error.serverProblem");
}
