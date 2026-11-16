import { Link } from "wouter";
import { Eye, EyeOff } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { useNoIndex, usePageTitle } from "../hooks.js";
import { usePreview } from "../preview.js";
import { PAGES } from "../nav.js";

/**
 * Where preview is turned on and off for this device. Customers are never sent
 * here; it is the owner's way to look at what is designed but not connected.
 */
export function Preview() {
  const { t } = useLanguage();
  const preview = usePreview();
  usePageTitle(t("title.preview"));
  useNoIndex();
  const pages = PAGES.filter(page => page.preview);
  return (
    <div className="container narrow">
      <div className="page-head">
        <h1 className="page-title">{t("preview.title")}</h1>
        <p className="page-lead">{t("preview.lead")}</p>
      </div>
      <div className="card">
        <p className="notice notice-preview" role="status">
          {preview.on ? <Eye size={18} aria-hidden="true" /> : <EyeOff size={18} aria-hidden="true" />}
          <span>{preview.demo ? t("preview.alwaysOn") : preview.on ? t("preview.isOn") : t("preview.isOff")}</span>
        </p>
        {preview.demo ? null : (
          <div className="form-actions">
            <button type="button" className={`button ${preview.on ? "button-secondary" : "button-primary"}`} onClick={() => preview.setOn(!preview.on)}>
              {preview.on ? t("preview.turnOff") : t("preview.turnOn")}
            </button>
          </div>
        )}
        {preview.on ? (
          <section className="section" aria-labelledby="preview-pages">
            <h2 id="preview-pages" className="card-title">{t("preview.pagesTitle")}</h2>
            <ul className="menu-links">
              {pages.map(page => {
                const Icon = page.icon;
                return (
                  <li key={page.href}>
                    <Link href={page.href} className="menu-link">
                      <Icon size={20} aria-hidden="true" />
                      {t(page.label)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
