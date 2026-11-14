import { ChevronDown, Mail, MessageCircle, Phone } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { useConfig, usePageTitle } from "../hooks.js";
import type { Key } from "../../shared/i18n.js";

const QUESTIONS: readonly [Key, Key][] = [
  ["faq.number.q", "faq.number.a"],
  ["faq.notFound.q", "faq.notFound.a"],
  ["faq.updates.q", "faq.updates.a"],
  ["faq.attempted.q", "faq.attempted.a"],
  ["faq.cod.q", "faq.cod.a"],
];

/**
 * The questions customers ask, and how to reach ShipLee. Each way to reach it
 * is drawn only once the deployment names it (SHIPLEE_PHONE, SHIPLEE_WHATSAPP,
 * SHIPLEE_EMAIL); with none, the page says who to ask instead, and the answer
 * about changing a delivery says the same.
 */
export function Help() {
  const { t } = useLanguage();
  const config = useConfig();
  usePageTitle(t("title.help"));
  const contact = config?.contact;
  const any = Boolean(contact && (contact.phone || contact.whatsapp || contact.email));
  return (
    <div className="container">
      <div className="page-head narrow-head">
        <h1 className="page-title">{t("help.title")}</h1>
        <p className="page-lead">{t("help.lead")}</p>
      </div>
      <div className="questions">
        <div className="faq">
          {[...QUESTIONS, ["faq.change.q", any ? "faq.change.aContact" : "faq.change.aSender"] as [Key, Key]].map(([question, answer]) => (
            <details key={question}>
              <summary>
                {t(question)}
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <p>{t(answer)}</p>
            </details>
          ))}
        </div>
      </div>

      <section className="section" aria-labelledby="contact-title">
        <h2 id="contact-title" className="section-title">{t("contact.title")}</h2>
        {config === null ? null : any ? (
          <>
            <p className="section-lead">{t("contact.lead")}</p>
            <div className="contact-grid">
              {contact!.phone ? (
                <a className="contact" href={`tel:${contact!.phone}`}>
                  <span className="step-icon"><Phone size={20} aria-hidden="true" /></span>
                  <span><strong>{t("contact.phone")}</strong><span>{contact!.phone}</span></span>
                </a>
              ) : null}
              {contact!.whatsapp ? (
                <a className="contact" href={`https://wa.me/${contact!.whatsapp}`} target="_blank" rel="noopener noreferrer">
                  <span className="step-icon"><MessageCircle size={20} aria-hidden="true" /></span>
                  <span><strong>{t("contact.whatsapp")}</strong><span>+{contact!.whatsapp}</span></span>
                </a>
              ) : null}
              {contact!.email ? (
                <a className="contact" href={`mailto:${contact!.email}`}>
                  <span className="step-icon"><Mail size={20} aria-hidden="true" /></span>
                  <span><strong>{t("contact.email")}</strong><span>{contact!.email}</span></span>
                </a>
              ) : null}
            </div>
          </>
        ) : (
          <p className="section-lead">{t("contact.none")}</p>
        )}
      </section>
    </div>
  );
}
