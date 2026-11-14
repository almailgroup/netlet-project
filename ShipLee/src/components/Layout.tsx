import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useLanguage } from "../i18n.js";
import { LogoMark } from "./Logo.js";

/**
 * The frame every page sits in: a skip link, the header, the one `<main>`
 * and the footer. The header carries little — the logo is the way back to
 * tracking, Help is the other place a customer goes, and the language names
 * the one you would get.
 */
export function Layout({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useLanguage();
  const [location] = useLocation();
  const other = lang === "en" ? "ar" : "en";
  const onHelp = location === "/help";
  return (
    <>
      <a className="skip-link" href="#main">{t("nav.skip")}</a>
      <header className="site-header">
        <div className="container">
          <Link href="/" className="logo" aria-label={t("nav.home")}>
            <LogoMark />
            <span>{t("site.name")}</span>
          </Link>
          <nav className="nav" aria-label={t("nav.main")}>
            <Link href="/" className="nav-link only-wide" aria-current={location === "/" ? "page" : undefined}>{t("nav.track")}</Link>
            <Link href="/help" className="nav-link" aria-current={onHelp ? "page" : undefined}>{t("nav.help")}</Link>
            {/* The word for the other language, in that language, so a screen reader says it in its own voice. */}
            <button type="button" className="nav-link" lang={other} onClick={() => setLang(other)} aria-label={t("lang.otherName")}>
              {t("lang.other")}
            </button>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1}>{children}</main>
      <footer className="site-footer">
        <div className="container">
          <p>{t("footer.rights", { year: new Date().getFullYear() })}</p>
          <nav aria-label={t("nav.footer")}>
            <Link href="/" className="nav-link">{t("nav.track")}</Link>
            <Link href="/help" className="nav-link">{t("nav.help")}</Link>
            <Link href="/staff" className="nav-link">{t("footer.staff")}</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
