import { Link } from "wouter";
import { Banknote, Building2, Calculator, PackageCheck, Timer, Truck, Undo2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "../../i18n.js";
import { usePageTitle } from "../../hooks.js";
import { formatMoney } from "../../../shared/format.js";
import type { Key } from "../../../shared/i18n.js";
import { FROM_FILS } from "../../samples/rates.js";
import { PreviewHead } from "./PreviewHead.js";

const SERVICES: readonly { icon: LucideIcon; title: Key; body: Key; fromFils?: number }[] = [
  { icon: Truck, title: "services.nextDay.title", body: "services.nextDay.body", fromFils: FROM_FILS.nextDay },
  { icon: Timer, title: "services.sameDay.title", body: "services.sameDay.body", fromFils: FROM_FILS.sameDay },
  { icon: Banknote, title: "services.cod.title", body: "services.cod.body", fromFils: FROM_FILS.cod },
  { icon: Undo2, title: "services.returns.title", body: "services.returns.body", fromFils: FROM_FILS.returns },
  { icon: Building2, title: "services.business.title", body: "services.business.body" },
];

/** What ShipLee will offer, with sample prices from the same rule /rates uses. */
export function Services() {
  const { t, lang } = useLanguage();
  usePageTitle(t("title.services"));
  return (
    <div className="container">
      <PreviewHead title={t("services.title")} lead={t("services.lead")} />
      <ul className="service-cards">
        {SERVICES.map(({ icon: Icon, title, body, fromFils }) => (
          <li key={title} className="card service-card">
            <span className="service-icon"><Icon size={22} aria-hidden="true" /></span>
            <h2 className="card-title">{t(title)}</h2>
            <p className="muted">{t(body)}</p>
            {fromFils ? <p className="service-from">{t("services.from", { price: formatMoney(fromFils, lang) })}</p> : null}
          </li>
        ))}
      </ul>
      <div className="button-row section">
        <Link href="/rates" className="button button-primary">
          <Calculator size={18} aria-hidden="true" />
          {t("services.getPrice")}
        </Link>
        <Link href="/book" className="button button-secondary">
          <PackageCheck size={18} aria-hidden="true" />
          {t("nav.book")}
        </Link>
      </div>
    </div>
  );
}
