import { Mail, MessageCircle, Phone } from "lucide-react";
import { useLanguage } from "../i18n.js";
import type { Config } from "../api.js";

/** Whether the deployment names any way to reach ShipLee's team. */
export function anyContact(contact: Config["contact"] | undefined): boolean {
  return Boolean(contact && (contact.phone || contact.whatsapp || contact.email));
}

/**
 * The ways to reach ShipLee's team as cards, each drawn only once the
 * deployment names it (SHIPLEE_PHONE, SHIPLEE_WHATSAPP, SHIPLEE_EMAIL). The
 * help page and the contact page draw this one list.
 */
export function ContactWays({ contact }: { contact: Config["contact"] }) {
  const { t } = useLanguage();
  return (
    <div className="contact-grid">
      {contact.phone ? (
        <a className="contact" href={`tel:${contact.phone}`}>
          <span className="step-icon"><Phone size={20} aria-hidden="true" /></span>
          <span><strong>{t("contact.phone")}</strong><bdi dir="ltr">{contact.phone}</bdi></span>
        </a>
      ) : null}
      {contact.whatsapp ? (
        <a className="contact" href={`https://wa.me/${contact.whatsapp}`} target="_blank" rel="noopener noreferrer">
          <span className="step-icon"><MessageCircle size={20} aria-hidden="true" /></span>
          <span><strong>{t("contact.whatsapp")}</strong><bdi dir="ltr">+{contact.whatsapp}</bdi></span>
        </a>
      ) : null}
      {contact.email ? (
        <a className="contact" href={`mailto:${contact.email}`}>
          <span className="step-icon"><Mail size={20} aria-hidden="true" /></span>
          <span><strong>{t("contact.email")}</strong><bdi dir="ltr">{contact.email}</bdi></span>
        </a>
      ) : null}
    </div>
  );
}
