import { useState } from "react";
import { Link } from "wouter";
import { Home as HomeIcon, Briefcase, LogOut } from "lucide-react";
import { useLanguage } from "../../i18n.js";
import { useConfig, usePageTitle } from "../../hooks.js";
import { StatusPill } from "../../components/Status.js";
import { Destination } from "../../components/Destination.js";
import type { Status } from "../../../shared/status.js";
import { PreviewHead } from "./PreviewHead.js";

/** The sample parcels: the demo's own numbers where there are some, so each opens on a demo deployment. */
const SAMPLE_STATUSES: readonly Status[] = ["out_for_delivery", "delivered", "attempted", "picked_up"];
const FALLBACK_NUMBERS = ["SL4820619379", "SL7315028469", "SL2658194705", "SL9173402588"];

/**
 * An account's front page, with sample data: the parcels sent to them, their
 * saved addresses and how they want to hear about a parcel. Nothing here is
 * stored; the switches move and forget.
 */
export function Account() {
  const { t, lang } = useLanguage();
  const config = useConfig();
  usePageTitle(t("title.account"));
  const [whatsapp, setWhatsapp] = useState(true);
  const [email, setEmail] = useState(false);
  const numbers = config?.samples.length ? config.samples : FALLBACK_NUMBERS;
  return (
    <div className="container">
      <PreviewHead title={t("account.title")} lead={t("account.lead")} />
      <div className="account-layout">
        <section className="card" aria-labelledby="parcels-title">
          <h2 id="parcels-title" className="card-title">{t("account.parcels")}</h2>
          <ul className="parcel-list account-parcels">
            {numbers.slice(0, SAMPLE_STATUSES.length).map((number, index) => (
              <li key={number} className="parcel-row">
                <span className="parcel-number">{number}</span>
                <StatusPill status={SAMPLE_STATUSES[index]!} />
                <Link href={`/track/${number}`} className="button button-secondary button-small" aria-label={`${t("account.open")} ${number}`}>{t("account.open")}</Link>
              </li>
            ))}
          </ul>
        </section>

        <div className="account-side">
          <section className="card" aria-labelledby="addresses-title">
            <h2 id="addresses-title" className="card-title">{t("account.addresses")}</h2>
            <ul className="address-list">
              <li>
                <HomeIcon size={18} aria-hidden="true" />
                <span><strong>{t("account.home")}</strong><span className="muted"><Destination area={lang === "ar" ? "السالمية" : "Salmiya"} governorate="hawalli" /></span></span>
              </li>
              <li>
                <Briefcase size={18} aria-hidden="true" />
                <span><strong>{t("account.work")}</strong><span className="muted"><Destination area={lang === "ar" ? "شرق" : "Sharq"} governorate="capital" /></span></span>
              </li>
            </ul>
          </section>

          <section className="card" aria-labelledby="updates-title">
            <h2 id="updates-title" className="card-title">{t("account.notifications")}</h2>
            <div className="switch-list">
              <label className="switch-row">
                <span>{t("account.byWhatsApp")}</span>
                <input type="checkbox" role="switch" className="switch" checked={whatsapp} onChange={event => setWhatsapp(event.target.checked)} />
              </label>
              <label className="switch-row">
                <span>{t("account.byEmail")}</span>
                <input type="checkbox" role="switch" className="switch" checked={email} onChange={event => setEmail(event.target.checked)} />
              </label>
            </div>
          </section>

          <Link href="/signin" className="button button-secondary">
            <LogOut size={18} aria-hidden="true" className="flip" />
            {t("account.signOut")}
          </Link>
        </div>
      </div>
    </div>
  );
}
