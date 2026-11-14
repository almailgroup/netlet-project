import { Link } from "wouter";
import { useLanguage } from "../i18n.js";
import { usePageTitle } from "../hooks.js";

export function NotFound() {
  const { t } = useLanguage();
  usePageTitle(t("title.notFound"));
  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">{t("notFound.title")}</h1>
        <p className="page-lead">{t("notFound.body")}</p>
        <p className="more-link"><Link href="/" className="button button-primary">{t("notFound.home")}</Link></p>
      </div>
    </div>
  );
}
