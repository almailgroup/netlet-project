import { useState } from "react";
import { CircleAlert, Info, X } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { usePreview } from "../preview.js";
import { readStored, writeStored } from "../storage.js";
import { SERVICE_ALERT } from "../content/serviceAlert.js";
import type { ServiceAlert } from "../content/serviceAlert.js";
import { kuwaitDay } from "../../shared/kuwait.js";

const dismissedKey = (id: string) => `shiplee:alert:${id}`;

/**
 * The service notice across the top of a customer's page: the owner's, from
 * `SERVICE_ALERT`, or in preview with none set, a sample so the design can be
 * seen. Dismissing it is remembered on this device for that notice alone.
 * A region named "Service notice", so a screen reader can find it and skip it.
 */
export function ServiceAlertBar() {
  const { t, lang } = useLanguage();
  const preview = usePreview();
  const alert: ServiceAlert | null = SERVICE_ALERT ?? (preview.on ? { id: "sample", tone: "info", text: { en: t("alert.sample"), ar: t("alert.sample") } } : null);
  /* Read for the notice drawn now, not the first render's: in preview the sample arrives with the settings. */
  const [dismissedNow, setDismissedNow] = useState<string | null>(null);
  if (!alert || dismissedNow === alert.id || readStored(dismissedKey(alert.id)) === "1") return null;
  if (alert.ends && alert.ends < kuwaitDay()) return null;
  const Icon = alert.tone === "attention" ? CircleAlert : Info;
  const dismiss = () => {
    writeStored(dismissedKey(alert.id), "1");
    setDismissedNow(alert.id);
    /* The button pressed is gone; the keyboard carries on from the header's first link. */
    document.querySelector<HTMLElement>(".site-header a")?.focus();
  };
  return (
    <div className={`service-alert tone-${alert.tone}`} role="region" aria-label={t("alert.label")}>
      <div className="container service-alert-row">
        <Icon size={18} aria-hidden="true" />
        <p>{alert.text[lang]}</p>
        <button type="button" className="button button-quiet button-icon button-small" onClick={dismiss} aria-label={t("alert.dismiss")}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
