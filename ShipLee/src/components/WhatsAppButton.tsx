import { useLocation } from "wouter";
import { MessageCircle } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { useConfig } from "../hooks.js";
import { parseTrackingNumber } from "../../shared/tracking.js";

/**
 * A WhatsApp chat with ShipLee's team, floating at the page's end corner,
 * drawn only where the deployment names a WhatsApp number and never on the
 * staff desk. On one parcel's page the message starts with its number, so
 * nobody has to copy it across. A phone shows the mark alone; a wider screen
 * says "Chat with us" beside it. Its name is the same either way.
 */
export function WhatsAppButton() {
  const { t } = useLanguage();
  const config = useConfig();
  const [location] = useLocation();
  const whatsapp = config?.contact.whatsapp;
  if (!whatsapp || location.startsWith("/staff")) return null;
  const match = /^\/track\/([^/,]+)$/.exec(location);
  const parsed = match ? parseTrackingNumber(decodeURIComponent(match[1]!)) : null;
  const text = parsed?.ok ? t("contact.whatsappMessage", { number: parsed.number }) : t("fab.message");
  /* In a landmark of its own, so nothing on the page sits outside one. */
  return (
    <aside className="float-chat-wrap" aria-label={t("contact.whatsapp")}>
      <a className="float-chat" href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" aria-label={t("fab.label")}>
        <MessageCircle size={24} aria-hidden="true" />
        <span className="label" aria-hidden="true">{t("fab.short")}</span>
      </a>
    </aside>
  );
}
