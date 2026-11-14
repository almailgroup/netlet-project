/**
 * The page's language. It starts as the one chosen last on this device, else
 * the browser's, and `<html lang dir>` is set before the first paint — set in
 * an ordinary effect, the Arabic page is drawn left to right for a frame and
 * then jumps.
 */
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Key, Lang, Params, PluralKey } from "../shared/i18n.js";
import { plural, translate } from "../shared/i18n.js";
import { readStored, writeStored } from "./storage.js";

type Language = {
  lang: Lang;
  t: (key: Key, params?: Params) => string;
  n: (key: PluralKey, count: number) => string;
  setLang: (lang: Lang) => void;
};

const LanguageContext = createContext<Language | null>(null);
const STORED = "shiplee:lang";

function firstLang(): Lang {
  const stored = readStored(STORED);
  if (stored === "en" || stored === "ar") return stored;
  const asked = new URLSearchParams(window.location.search).get("lang");
  if (asked === "en" || asked === "ar") return asked;
  return navigator.language?.toLowerCase().startsWith("ar") ? "ar" : "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(firstLang);
  useLayoutEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  const setLang = useCallback((next: Lang) => {
    writeStored(STORED, next);
    setLangState(next);
  }, []);
  const value = useMemo<Language>(
    () => ({ lang, setLang, t: (key, params) => translate(lang, key, params), n: (key, count) => plural(lang, key, count) }),
    [lang, setLang],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): Language {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage outside LanguageProvider");
  return value;
}
