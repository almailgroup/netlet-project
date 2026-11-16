import { Link } from "wouter";
import { Briefcase, Car, Headset, Warehouse } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "../../i18n.js";
import { usePageTitle } from "../../hooks.js";
import type { Key } from "../../../shared/i18n.js";
import { PreviewHead } from "./PreviewHead.js";

const ROLES: readonly { id: string; icon: LucideIcon; title: Key; meta: Key; body: Key }[] = [
  { id: "driver", icon: Car, title: "careers.driver.title", meta: "careers.driver.meta", body: "careers.driver.body" },
  { id: "hub", icon: Warehouse, title: "careers.hub.title", meta: "careers.hub.meta", body: "careers.hub.body" },
  { id: "support", icon: Headset, title: "careers.support.title", meta: "careers.support.meta", body: "careers.support.body" },
];

/** Sample openings. Applying is not open, and the page says so rather than offering a button that goes nowhere. */
export function Careers() {
  const { t } = useLanguage();
  usePageTitle(t("title.careers"));
  return (
    <div className="container">
      <PreviewHead title={t("careers.title")} lead={t("careers.lead")} />
      <ul className="role-list">
        {ROLES.map(({ id, icon: Icon, title, meta, body }) => (
          <li key={id} className="card role">
            <span className="service-icon"><Icon size={22} aria-hidden="true" /></span>
            <div className="role-body">
              <h2 className="card-title">{t(title)}</h2>
              <p className="role-meta"><Briefcase size={15} aria-hidden="true" />{t(meta)}</p>
              <p className="muted">{t(body)}</p>
              <p className="role-apply">
                {t("careers.soon")}
                {id === "driver" ? <> <Link href="/couriers">{t("careers.drive")}</Link></> : null}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
