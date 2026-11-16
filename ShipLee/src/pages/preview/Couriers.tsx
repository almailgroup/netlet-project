import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { CalendarCheck, CircleCheckBig, MapPinned, Smartphone } from "lucide-react";
import { useLanguage } from "../../i18n.js";
import { usePageTitle } from "../../hooks.js";
import { Field, focusFirstProblem } from "../../components/ui/Field.js";
import { ChoiceGroup } from "../../components/RequestDialogs.js";
import { PreviewTag } from "../../preview.js";
import { GOVERNORATES, governorateName, isGovernorate } from "../../../shared/kuwait.js";
import { LIMITS, kuwaitPhone } from "../../../shared/shipment.js";
import type { Key } from "../../../shared/i18n.js";
import { PreviewHead } from "./PreviewHead.js";

const VEHICLES = ["car", "van", "bike"] as const;
type Problems = Partial<Record<"name" | "phone" | "governorate" | "vehicle" | "licence", Key>>;

/**
 * Signing up to deliver for ShipLee, as it will look: what it offers (sample
 * terms), then a short form held to its rules, ending in a line that says
 * nothing was sent.
 *
 * Where it connects later: the form's answers sent to ShipLee's team (an API,
 * or the WhatsApp message the tracking page's requests already use).
 */
export function Couriers() {
  const { t, lang } = useLanguage();
  usePageTitle(t("title.couriers"));
  const form = useRef<HTMLFormElement>(null);
  const done = useRef<HTMLHeadingElement>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [licence, setLicence] = useState(false);
  const [problems, setProblems] = useState<Problems>({});
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (sent) done.current?.focus();
  }, [sent]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found: Problems = {};
    if (!name.trim()) found.name = "book.nameNeeded";
    else if (name.trim().length > LIMITS.name) found.name = "form.tooLong";
    if (!kuwaitPhone(phone)) found.phone = "form.phoneShape";
    if (!isGovernorate(governorate)) found.governorate = "form.governorateNeeded";
    if (!vehicle) found.vehicle = "couriers.vehicleNeeded";
    if (!licence) found.licence = "couriers.licenceNeeded";
    setProblems(found);
    if (Object.keys(found).length) {
      requestAnimationFrame(() => focusFirstProblem(form.current));
      return;
    }
    setSent(true);
  };

  return (
    <div className="container">
      <PreviewHead title={t("couriers.title")} lead={t("couriers.lead")} />
      <div className="couriers-layout">
        <ul className="perks">
          <li><span className="service-icon"><MapPinned size={22} aria-hidden="true" /></span>{t("couriers.perk.area")}</li>
          <li><span className="service-icon"><CalendarCheck size={22} aria-hidden="true" /></span>{t("couriers.perk.pay")}</li>
          <li><span className="service-icon"><Smartphone size={22} aria-hidden="true" /></span>{t("couriers.perk.app")}</li>
        </ul>

        {sent ? (
          <div className="card request-sent" role="status">
            <span className="icon-tile preview-tile"><CircleCheckBig size={26} aria-hidden="true" /></span>
            <h2 className="card-title" ref={done} tabIndex={-1}>{t("couriers.doneTitle")}</h2>
            <p className="muted">{t("couriers.doneBody")}</p>
          </div>
        ) : (
          <form ref={form} className="card form-grid" onSubmit={submit} noValidate>
            <h2 className="card-title">{t("couriers.formTitle")}</h2>
            <Field id="courier-name" label={t("auth.name")} problem={problems.name}>
              {(describedBy, invalid) => <input id="courier-name" className="input" dir="auto" autoComplete="name" maxLength={LIMITS.name} value={name} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => setName(event.target.value)} />}
            </Field>
            <Field id="courier-phone" label={t("auth.phone")} problem={problems.phone}>
              {(describedBy, invalid) => <input id="courier-phone" className="input ltr-input" type="tel" inputMode="tel" autoComplete="tel-national" value={phone} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => setPhone(event.target.value)} />}
            </Field>
            <Field id="courier-governorate" label={t("form.governorate")} problem={problems.governorate}>
              {(describedBy, invalid) => (
                <select id="courier-governorate" className="input" value={governorate} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => setGovernorate(event.target.value)}>
                  <option value="" disabled>{t("form.choose")}</option>
                  {GOVERNORATES.map(g => <option key={g.slug} value={g.slug}>{governorateName(g.slug, lang)}</option>)}
                </select>
              )}
            </Field>
            <ChoiceGroup
              legend={t("couriers.vehicle")}
              name="vehicle"
              value={vehicle}
              problem={problems.vehicle}
              options={VEHICLES.map(option => ({ value: option, label: t(`couriers.vehicle.${option}`) }))}
              onChange={setVehicle}
            />
            <div className="field">
              <label className="choice">
                <input type="checkbox" checked={licence} onChange={event => setLicence(event.target.checked)} aria-invalid={problems.licence ? true : undefined} aria-describedby={problems.licence ? "courier-licence-problem" : undefined} />
                <span className="choice-text"><strong>{t("couriers.licence")}</strong></span>
              </label>
              {problems.licence ? <p id="courier-licence-problem" className="field-error">{t(problems.licence)}</p> : null}
            </div>
            <div className="button-row">
              <button type="submit" className="button button-primary">{t("couriers.submit")}</button>
              <PreviewTag />
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
