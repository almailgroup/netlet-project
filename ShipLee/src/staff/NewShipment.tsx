import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { useDesk } from "./Staff.js";
import { EMPTY_DRAFT, ShipmentFields } from "./ShipmentFields.js";
import { focusFirstProblem } from "./Field.js";
import type { Problems, ShipmentDraft, StaffShipment } from "../../shared/shipment.js";
import { shipmentProblems } from "../../shared/shipment.js";

export function NewShipment() {
  const { t } = useLanguage();
  const { call } = useDesk();
  const [, navigate] = useLocation();
  const [draft, setDraft] = useState<ShipmentDraft>(EMPTY_DRAFT);
  const [attempted, setAttempted] = useState(false);
  const [serverProblems, setServerProblems] = useState<Problems<keyof ShipmentDraft>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  /* The form's own rules, said once Create has been pressed; the server's are the same rules. */
  const problems = attempted ? { ...shipmentProblems(draft).problems, ...serverProblems } : {};

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    setServerProblems({});
    setFailed(false);
    if (shipmentProblems(draft).details === null) {
      requestAnimationFrame(() => focusFirstProblem(form.current));
      return;
    }
    setBusy(true);
    const answer = await call<StaffShipment>("POST", "/api/staff/shipments", draft);
    setBusy(false);
    if (answer.ok) return navigate(`/staff/shipments/${answer.body.id}?created=1`);
    if (answer.problems) {
      setServerProblems(answer.problems);
      requestAnimationFrame(() => focusFirstProblem(form.current));
    } else setFailed(true);
  };

  return (
    <>
      <Link href="/staff" className="back-link"><ArrowLeft size={16} aria-hidden="true" className="flip" />{t("staff.back")}</Link>
      <div className="page-head compact">
        <h1 className="page-title">{t("staff.newTitle")}</h1>
        <p className="page-lead">{t("staff.newLead")}</p>
      </div>
      <form ref={form} className="card form-card" onSubmit={submit} noValidate>
        <ShipmentFields draft={draft} onChange={next => { setDraft(next); setServerProblems({}); }} problems={problems} idPrefix="new" />
        {failed ? <p className="notice notice-stopped form-note" role="alert">{t("error.generic")}</p> : null}
        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>{busy ? t("form.creating") : t("form.create")}</button>
          <Link href="/staff" className="button button-secondary">{t("form.cancel")}</Link>
        </div>
      </form>
    </>
  );
}
