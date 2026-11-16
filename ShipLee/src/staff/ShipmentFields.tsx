import { useLanguage } from "../i18n.js";
import { Field } from "../components/ui/Field.js";
import type { Problems, ShipmentDraft } from "../../shared/shipment.js";
import { GOVERNORATES } from "../../shared/kuwait.js";

/**
 * A shipment's details as staff type them, drawn by the new-shipment form and
 * the edit form so the two cannot ask different things. What the tracking
 * page shows is said beside the box; what it never shows is marked staff only.
 */
export function ShipmentFields({ draft, onChange, problems, idPrefix, filled }: {
  draft: ShipmentDraft;
  onChange: (draft: ShipmentDraft) => void;
  problems: Problems<keyof ShipmentDraft>;
  idPrefix: string;
  /** The boxes ShipLee AI filled from an order message and nobody has changed since. */
  filled?: ReadonlySet<keyof ShipmentDraft>;
}) {
  const { t, lang } = useLanguage();
  const set = (key: keyof ShipmentDraft) => (event: { target: { value: string } }) => onChange({ ...draft, [key]: event.target.value });
  const id = (key: string) => `${idPrefix}-${key}`;
  const field = (key: keyof ShipmentDraft) => ({ id: id(key), problem: problems[key], filled: filled?.has(key) });
  return (
    <>
      <div className="form-section">
        <h2>{t("result.from")}</h2>
        <div className="form-grid two">
          <Field {...field("senderName")} label={t("form.sender")} hint={t("form.senderHint")} wide>
            {(describedBy, invalid) => <input id={id("senderName")} className="input" value={draft.senderName} onChange={set("senderName")} maxLength={80} aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
          </Field>
        </div>
      </div>
      <div className="form-section">
        <h2>{t("result.to")}</h2>
        <div className="form-grid two">
          <Field {...field("governorate")} label={t("form.governorate")}>
            {(describedBy, invalid) => (
              <select id={id("governorate")} className="input" value={draft.governorate} onChange={set("governorate")} aria-describedby={describedBy} aria-invalid={invalid || undefined}>
                <option value="">{t("form.choose")}</option>
                {GOVERNORATES.map(g => <option key={g.slug} value={g.slug}>{g[lang]}</option>)}
              </select>
            )}
          </Field>
          <Field {...field("area")} label={t("form.area")} hint={t("form.areaHint")} optional>
            {(describedBy, invalid) => <input id={id("area")} className="input" value={draft.area} onChange={set("area")} maxLength={60} aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
          </Field>
          <Field {...field("address")} label={t("form.address")} hint={t("form.addressHint")} optional wide>
            {(describedBy, invalid) => <textarea id={id("address")} className="input" value={draft.address} onChange={set("address")} maxLength={300} rows={3} aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
          </Field>
          <Field {...field("recipientName")} label={t("form.recipient")} hint={t("form.private")} optional>
            {(describedBy, invalid) => <input id={id("recipientName")} className="input" value={draft.recipientName} onChange={set("recipientName")} maxLength={80} autoComplete="off" aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
          </Field>
          <Field {...field("recipientPhone")} label={t("form.phone")} hint={t("form.private")} optional>
            {(describedBy, invalid) => <input id={id("recipientPhone")} className="input ltr-input" type="tel" inputMode="tel" value={draft.recipientPhone} onChange={set("recipientPhone")} maxLength={20} autoComplete="off" aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
          </Field>
        </div>
      </div>
      <div className="form-section">
        <h2>{t("form.parcel")}</h2>
        <div className="form-grid two">
          <Field {...field("pieces")} label={t("form.pieces")}>
            {(describedBy, invalid) => <input id={id("pieces")} className="input ltr-input" inputMode="numeric" value={draft.pieces} onChange={set("pieces")} maxLength={2} aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
          </Field>
          <Field {...field("cod")} label={t("form.cod")} hint={t("form.codHint")} optional>
            {(describedBy, invalid) => <input id={id("cod")} className="input ltr-input" inputMode="decimal" value={draft.cod} onChange={set("cod")} maxLength={12} placeholder="0.000" aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
          </Field>
          <Field {...field("expectedOn")} label={t("form.expected")} optional>
            {(describedBy, invalid) => <input id={id("expectedOn")} className="input" type="date" value={draft.expectedOn} onChange={set("expectedOn")} aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
          </Field>
        </div>
      </div>
    </>
  );
}

export const EMPTY_DRAFT: ShipmentDraft = { senderName: "", recipientName: "", recipientPhone: "", governorate: "", area: "", address: "", pieces: "1", cod: "", expectedOn: "" };
