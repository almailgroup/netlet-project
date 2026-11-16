import { Link } from "wouter";
import { Ban, Flag, ShieldCheck } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { useConfig, usePageTitle } from "../hooks.js";
import { anyContact } from "../components/ContactWays.js";
import type { Key } from "../../shared/i18n.js";

const DOES: readonly Key[] = ["scams.does.number", "scams.does.site", "scams.does.cash"];
const NEVER: readonly Key[] = ["scams.never.pay", "scams.never.card", "scams.never.app"];
const CHECK: readonly Key[] = ["scams.check.one", "scams.check.two", "scams.check.three"];

/**
 * How to tell a real ShipLee message from a fake one. Every statement is true
 * of this site as it is built: tracking numbers carry a check digit, the site
 * takes no payment and asks for no card, code, app or ID, and cash on
 * delivery is paid to the driver for the amount the tracking page shows.
 */
export function Scams() {
  const { t } = useLanguage();
  const config = useConfig();
  usePageTitle(t("title.scams"));
  const any = anyContact(config?.contact);
  return (
    <div className="container">
      <div className="page-head narrow-head">
        <h1 className="page-title">{t("scams.title")}</h1>
        <p className="page-lead">{t("scams.lead")}</p>
      </div>

      <div className="scam-columns">
        <section className="card scam-card" aria-labelledby="does-title">
          <h2 id="does-title" className="card-title"><span className="icon-tile"><ShieldCheck size={22} aria-hidden="true" /></span>{t("scams.doesTitle")}</h2>
          <ul className="plain-list">
            {DOES.map(key => <li key={key}>{t(key)}</li>)}
          </ul>
        </section>
        <section className="card scam-card scam-never" aria-labelledby="never-title">
          <h2 id="never-title" className="card-title"><span className="icon-tile"><Ban size={22} aria-hidden="true" /></span>{t("scams.neverTitle")}</h2>
          <ul className="plain-list">
            {NEVER.map(key => <li key={key}>{t(key)}</li>)}
          </ul>
        </section>
      </div>

      <section className="section" aria-labelledby="check-title">
        <h2 id="check-title" className="section-title">{t("scams.checkTitle")}</h2>
        {/* What to do, in the order to do it. */}
        <ol className="check-steps">
          {CHECK.map((key, index) => (
            <li key={key}>
              <span className="check-number" aria-hidden="true">{index + 1}</span>
              <span>{t(key)}</span>
            </li>
          ))}
        </ol>
        {any ? (
          <p className="more-link">
            <Link href="/report" className="button button-primary">
              <Flag size={18} aria-hidden="true" />
              {t("scams.tell")}
            </Link>
          </p>
        ) : null}
      </section>
    </div>
  );
}
