/**
 * Translation, bound to the shopper's locale.
 *
 * A component asks for a key and gets the right language back without knowing
 * which one is active. `<html lang/dir>` is set by CustomerProvider rather than
 * here: direction is a document property with exactly one writer, and this hook
 * is called from dozens of components.
 */
import { useCustomer } from "@/contexts/CustomerContext";
import { formatMoney } from "@/lib/format";
import { isMessageKey, translate, type MessageKey } from "@shared/i18n/dictionary";
import { useCallback } from "react";

export function useTranslation() {
  const { locale, direction, isArabic } = useCustomer();

  const t = useCallback(
    (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values),
    [locale],
  );

  /**
   * A server-side failure, in the shopper's language where we have one.
   *
   * The auth endpoints answer with a message key so the refusal can be read in
   * Arabic. Everything else — validation, configuration — comes back as
   * English prose and is shown as it arrived rather than replaced by a vaguer
   * sentence that hides what went wrong.
   */
  const tError = useCallback(
    (message: string) => (isMessageKey(message) ? translate(locale, message) : message),
    [locale],
  );

  return { locale, direction, isArabic, t, tError };
}

export type Translate = ReturnType<typeof useTranslation>["t"];

/**
 * `formatMoney` bound to the shopper's language.
 *
 * A price is copy as much as a sentence is: on the Arabic storefront the
 * currency should read د.ك, not the Latin letters KWD.
 */
export function useMoney() {
  const { locale } = useTranslation();
  return useCallback(
    (value: Parameters<typeof formatMoney>[0], currencyCode?: string) =>
      formatMoney(value, { currencyCode, locale }),
    [locale],
  );
}
