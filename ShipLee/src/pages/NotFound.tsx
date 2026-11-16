import { Link } from "wouter";
import { useLanguage } from "../i18n.js";
import { usePageTitle } from "../hooks.js";
import { TrackForm } from "../components/TrackForm.js";

/**
 * An address that names nothing. Most people who land here were looking for
 * a parcel, so the tracking box is right here rather than a press away.
 */
export function NotFound() {
  const { t } = useLanguage();
  usePageTitle(t("title.notFound"));
  return (
    <div className="container">
      <div className="page-head narrow-head">
        <h1 className="page-title">{t("notFound.title")}</h1>
        <p className="page-lead">{t("notFound.body")}</p>
      </div>
      <div className="card not-found-track">
        <p className="card-title">{t("notFound.trackLead")}</p>
        <TrackForm labelHidden />
      </div>
      <p className="more-link"><Link href="/help">{t("notFound.helpLink")}</Link></p>
    </div>
  );
}
