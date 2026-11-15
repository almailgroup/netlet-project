import { Mail, MessageCircle, Phone } from "lucide-react";
import { useLanguage } from "../i18n.js";
import type { Config } from "../api.js";

/**
 * The ways to reach ShipLee's team, each drawn only once the deployment names
 * it. About a parcel, the WhatsApp message and the email's subject already
 * carry its number, so nobody has to copy it across. With no way set, it says
 * who to ask instead.
 */
export function ContactActions({ contact, number, compact = false }: { contact: Config["contact"]; number?: string; compact?: boolean }) {
  const { t } = useLanguage();
  const any = contact.phone || contact.whatsapp || contact.email;
  if (!any) return <p className="contact-none">{t("ai.senderLead")}</p>;
  const whatsappText = number ? `?text=${encodeURIComponent(t("contact.whatsappMessage", { number }))}` : "";
  const subject = number ? `?subject=${encodeURIComponent(t("contact.emailSubject", { number }))}` : "";
  return (
    <div className={`contact-actions${compact ? " compact" : ""}`}>
      {contact.whatsapp ? (
        <a className="button button-primary button-small" href={`https://wa.me/${contact.whatsapp}${whatsappText}`} target="_blank" rel="noopener noreferrer">
          <MessageCircle size={16} aria-hidden="true" />
          {t("contact.whatsappAction")}
        </a>
      ) : null}
      {contact.phone ? (
        <a className="button button-secondary button-small" href={`tel:${contact.phone}`}>
          <Phone size={16} aria-hidden="true" />
          {t("contact.callAction")}
        </a>
      ) : null}
      {contact.email ? (
        <a className="button button-secondary button-small" href={`mailto:${contact.email}${subject}`}>
          <Mail size={16} aria-hidden="true" />
          {t("contact.emailAction")}
        </a>
      ) : null}
    </div>
  );
}
