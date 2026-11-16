import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Eye, Languages, Menu, Search } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { LogoMark } from "./Logo.js";
import { Dialog } from "./ui/Dialog.js";
import { TrackForm } from "./TrackForm.js";
import { RecentlyTracked } from "./RecentlyTracked.js";
import { PreviewTag, usePreview } from "../preview.js";
import { ServiceAlertBar } from "./ServiceAlertBar.js";
import { WhatsAppButton } from "./WhatsAppButton.js";
import { GROUPS, HOME_TRACK_ID, isCurrent, pagesFor } from "../nav.js";

/**
 * The frame every page sits in: the preview bar when preview is on, a skip
 * link, the header, the one `<main>` and the footer.
 *
 * Tracking is one press away on every page: the header's Track button opens
 * the tracking box over the page (on the home page it goes to the home page's
 * own box). From a laptop up the header also names the main pages; below
 * that they are in the menu, a drawer from the page's end edge that carries
 * the tracking box too. The language button names the language you would get.
 */
export function Layout({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useLanguage();
  const preview = usePreview();
  const [location] = useLocation();
  const [trackOpen, setTrackOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const other = lang === "en" ? "ar" : "en";
  const pages = pagesFor(preview.on);
  const staff = location.startsWith("/staff");

  /* Moving to another page puts away whatever was open over this one. */
  useEffect(() => {
    setTrackOpen(false);
    setMenuOpen(false);
  }, [location]);

  const openTrack = () => {
    const home = document.getElementById(HOME_TRACK_ID);
    if (location === "/" && home) {
      home.scrollIntoView({ block: "center", behavior: "smooth" });
      home.focus({ preventScroll: true });
      return;
    }
    setTrackOpen(true);
  };
  const closeTrack = useCallback(() => setTrackOpen(false), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <>
      <a className="skip-link" href="#main">{t("nav.skip")}</a>
      {preview.on ? <PreviewBar /> : null}
      {staff ? null : <ServiceAlertBar />}
      <header className="site-header">
        <div className="container header-row">
          <Link href="/" className="logo" aria-label={t("nav.home")}>
            <LogoMark />
            <span>{t("site.name")}</span>
          </Link>
          <nav className="nav header-nav" aria-label={t("nav.main")}>
            {pages.filter(page => page.header).map(page => (
              <Link key={page.href} href={page.href} className="nav-link" aria-current={isCurrent(page.href, location) ? "page" : undefined}>
                {t(page.label)}
              </Link>
            ))}
          </nav>
          <div className="header-tools">
            {/* The word for the other language, in that language, so a screen reader says it in its own voice. */}
            <button type="button" className="nav-link header-lang" lang={other} onClick={() => setLang(other)} aria-label={t("lang.otherName")}>
              {t("lang.other")}
            </button>
            {staff ? null : (
              <button type="button" className="button button-primary button-small header-track" onClick={openTrack} aria-label={t("nav.trackParcel")}>
                <Search size={18} aria-hidden="true" />
                <span className="label" aria-hidden="true">{t("nav.trackParcel")}</span>
              </button>
            )}
            <button type="button" className="button button-quiet button-icon menu-button" onClick={() => setMenuOpen(true)} aria-label={t("nav.menu")} aria-haspopup="dialog" aria-expanded={menuOpen}>
              <Menu size={22} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <Dialog open={trackOpen} onClose={closeTrack} title={t("nav.trackParcel")} lead={t("track.dialogLead")}>
        <TrackForm autoFocus labelHidden />
        <RecentlyTracked onOpen={closeTrack} />
      </Dialog>

      <Dialog open={menuOpen} onClose={closeMenu} title={t("nav.menu")} variant="drawer" closeLabel={t("nav.closeMenu")}>
        {staff ? null : (
          <div className="menu-track">
            <TrackForm labelHidden />
          </div>
        )}
        <MenuLinks location={location} preview={preview.on} />
        <div className="menu-links">
          <button type="button" className="menu-link nav-link" lang={other} onClick={() => setLang(other)} aria-label={t("lang.otherName")}>
            <Languages size={20} aria-hidden="true" />
            {t("lang.other")}
          </button>
          <Link href="/staff" className="menu-link">{t("footer.staff")}</Link>
        </div>
      </Dialog>

      <main id="main" tabIndex={-1}>{children}</main>
      <Footer preview={preview.on} />
      <WhatsAppButton />
    </>
  );
}

function MenuLinks({ location, preview }: { location: string; preview: boolean }) {
  const { t } = useLanguage();
  const pages = pagesFor(preview);
  return (
    <>
      {GROUPS.map(group => {
        const inGroup = pages.filter(page => page.group === group.id);
        if (!inGroup.length) return null;
        return (
          <nav key={group.id} className="menu-links" aria-label={t(group.label)}>
            <h3>{t(group.label)}</h3>
            {inGroup.map(page => {
              const Icon = page.icon;
              return (
                <Link key={page.href} href={page.href} className="menu-link" aria-current={isCurrent(page.href, location) ? "page" : undefined}>
                  <Icon size={20} aria-hidden="true" />
                  {t(page.label)}
                  {page.preview ? <PreviewTag /> : null}
                </Link>
              );
            })}
          </nav>
        );
      })}
    </>
  );
}

function Footer({ preview }: { preview: boolean }) {
  const { t, lang, setLang } = useLanguage();
  const other = lang === "en" ? "ar" : "en";
  const pages = pagesFor(preview);
  const groups = GROUPS.filter(group => pages.some(page => page.group === group.id));
  return (
    <footer className="site-footer">
      <div className={`container footer-grid cols-${groups.length + 1}`}>
        <div className="footer-brand">
          <Link href="/" className="logo" aria-label={t("nav.home")}>
            <LogoMark />
            <span>{t("site.name")}</span>
          </Link>
          <p>{t("footer.about")}</p>
        </div>
        {groups.map(group => (
          <nav key={group.id} className="footer-col" aria-label={t(group.label)}>
            <h2>{t(group.label)}</h2>
            <ul>
              {pages.filter(page => page.group === group.id).map(page => (
                <li key={page.href}>
                  <Link href={page.href}>
                    {t(page.label)}
                    {page.preview ? <PreviewTag compact /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="container">
        <div className="footer-base">
          <p>{t("footer.rights", { year: new Date().getFullYear() })}</p>
          <nav aria-label={t("nav.footer")}>
            <button type="button" className="nav-link" lang={other} onClick={() => setLang(other)} aria-label={t("lang.otherName")}>
              {t("lang.other")}
            </button>
            <Link href="/staff" className="nav-link">{t("footer.staff")}</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}

/** Says preview is on, on every page, with the way out where there is one. */
function PreviewBar() {
  const { t } = useLanguage();
  const preview = usePreview();
  return (
    <div className="preview-bar" role="region" aria-label={t("preview.barName")}>
      <div className="container">
        <p>
          <Eye size={16} aria-hidden="true" />
          <span>{preview.demo ? t("preview.barDemo") : t("preview.bar")}</span>
        </p>
        {preview.demo ? null : (
          <Link href="/preview" className="button button-quiet button-small">{t("preview.manage")}</Link>
        )}
      </div>
    </div>
  );
}
