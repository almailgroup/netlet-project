import { Link } from "wouter";
import { Flag, Mail, MessageCircle, Search, ShieldAlert } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { useConfig, usePageTitle } from "../hooks.js";
import { ContactWays, anyContact } from "../components/ContactWays.js";

/**
 * How to reach ShipLee's team: the ways the deployment names, what to do about
 * a parcel (its own page writes the message), the invitation to shops, and
 * where to check a message somebody is unsure of. With no way named it says
 * who to ask instead, as the help page does.
 */
export function Contact() {
  const { t } = useLanguage();
  const config = useConfig();
  usePageTitle(t("title.contact"));
  const contact = config?.contact;
  const any = anyContact(contact);
  return (
    <div className="container">
      <div className="page-head narrow-head">
        <h1 className="page-title">{t("contactPage.title")}</h1>
        <p className="page-lead">{any ? t("contactPage.lead") : config ? t("contact.none") : null}</p>
      </div>

      {any && contact ? (
        <section aria-labelledby="ways-title">
          <h2 id="ways-title" className="section-title">{t("contactPage.waysTitle")}</h2>
          <ContactWays contact={contact} />
        </section>
      ) : null}

      <div className="contact-more">
        <section className="card" aria-labelledby="parcel-title">
          <h2 id="parcel-title" className="card-title">{t("contactPage.parcelTitle")}</h2>
          <p className="muted">{t("contactPage.parcelBody")}</p>
          <div className="button-row">
            <Link href="/track" className="button button-secondary button-small">
              <Search size={16} aria-hidden="true" />
              {t("contactPage.parcelTrack")}
            </Link>
            {any ? (
              <Link href="/report" className="button button-secondary button-small">
                <Flag size={16} aria-hidden="true" />
                {t("contactPage.parcelReport")}
              </Link>
            ) : null}
          </div>
        </section>

        {contact && (contact.whatsapp || contact.email) ? (
          <section className="card" aria-labelledby="shop-title">
            <h2 id="shop-title" className="card-title">{t("biz.title")}</h2>
            <p className="muted">{t("biz.lead")}</p>
            <div className="button-row">
              {contact.whatsapp ? (
                <a className="button button-secondary button-small" href={`https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(t("biz.message"))}`} target="_blank" rel="noopener noreferrer">
                  <MessageCircle size={16} aria-hidden="true" />
                  {t("biz.whatsapp")}
                </a>
              ) : null}
              {contact.email ? (
                <a className="button button-secondary button-small" href={`mailto:${contact.email}?subject=${encodeURIComponent(t("biz.subject"))}`}>
                  <Mail size={16} aria-hidden="true" />
                  {t("biz.email")}
                </a>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="card" aria-labelledby="scam-title">
          <h2 id="scam-title" className="card-title">{t("contactPage.scamTitle")}</h2>
          <p className="muted">{t("contactPage.scamBody")}</p>
          <div className="button-row">
            <Link href="/scams" className="button button-secondary button-small">
              <ShieldAlert size={16} aria-hidden="true" />
              {t("contactPage.scamLink")}
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
