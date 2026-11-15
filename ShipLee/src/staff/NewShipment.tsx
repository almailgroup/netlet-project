import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, CircleCheckBig } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { useDesk } from "./Staff.js";
import { EMPTY_DRAFT, ShipmentFields } from "./ShipmentFields.js";
import { focusFirstProblem } from "./Field.js";
import { FromMessage } from "./FromMessage.js";
import { useConfig } from "../hooks.js";
import type { IntakeField, IntakeResult } from "../../shared/assistant.js";
import { INTAKE_FIELDS } from "../../shared/assistant.js";
import type { Key } from "../../shared/i18n.js";

import type { Problems, ShipmentDraft, StaffShipment } from "../../shared/shipment.js";
import { shipmentProblems } from "../../shared/shipment.js";

/** Each box's own label, for saying which ones a message did not fill. */
const FIELD_NAMES: Record<IntakeField, Key> = {
  senderName: "form.sender",
  recipientName: "form.recipient",
  recipientPhone: "form.phone",
  governorate: "form.governorate",
  area: "form.area",
  address: "form.address",
  pieces: "form.pieces",
  cod: "form.cod",
  expectedOn: "form.expected",
};

export function NewShipment() {
  const { t, n, lang } = useLanguage();
  const { call } = useDesk();
  const config = useConfig();
  const [, navigate] = useLocation();
  const [draft, setDraft] = useState<ShipmentDraft>(EMPTY_DRAFT);
  const [filled, setFilled] = useState<ReadonlySet<keyof ShipmentDraft>>(new Set());
  const [read, setRead] = useState<{ found: IntakeField[]; before: ShipmentDraft } | null>(null);
  const [undone, setUndone] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [serverProblems, setServerProblems] = useState<Problems<keyof ShipmentDraft>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  /* The form's own rules, said once Create has been pressed; the server's are the same rules. */
  const problems = attempted ? { ...shipmentProblems(draft).problems, ...serverProblems } : {};

  /* What ShipLee AI read from a message goes into the boxes, marked, and the form as it was is kept for Undo. */
  const fill = (result: IntakeResult) => {
    setRead({ found: result.found, before: draft });
    setUndone(false);
    setDraft({ ...draft, ...result.draft });
    setFilled(new Set(result.found));
    setServerProblems({});
    setAttempted(false);
  };
  const undo = () => {
    if (!read) return;
    setDraft(read.before);
    setFilled(new Set());
    setRead(null);
    setUndone(true);
  };
  /* A box somebody changes is theirs now, and loses its mark. */
  const change = (next: ShipmentDraft) => {
    const changed = (Object.keys(next) as (keyof ShipmentDraft)[]).filter(key => next[key] !== draft[key]);
    if (changed.some(key => filled.has(key))) setFilled(new Set([...filled].filter(key => !changed.includes(key))));
    setDraft(next);
    setServerProblems({});
  };

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
      {config?.ai ? <FromMessage onRead={result => fill(result)} /> : null}
      {read ? (
        <div className="notice intake-note" role="status">
          <CircleCheckBig size={18} aria-hidden="true" />
          <div>
            <p>{n("filled", read.found.length)} {t("intake.check")}</p>
            {read.found.length < INTAKE_FIELDS.length ? (
              <p className="missing">{t("intake.missing", { fields: new Intl.ListFormat(lang, { type: "conjunction" }).format(INTAKE_FIELDS.filter(field => !read.found.includes(field)).map(field => t(FIELD_NAMES[field]))) })}</p>
            ) : null}
          </div>
          <button type="button" className="button button-quiet button-small" onClick={undo}>{t("intake.undo")}</button>
        </div>
      ) : undone ? (
        <p className="notice intake-note" role="status">{t("intake.undone")}</p>
      ) : null}
      <form ref={form} className="card form-card" onSubmit={submit} noValidate>
        <ShipmentFields draft={draft} onChange={change} problems={problems} idPrefix="new" filled={filled} />
        {failed ? <p className="notice notice-stopped form-note" role="alert">{t("error.generic")}</p> : null}
        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>{busy ? t("form.creating") : t("form.create")}</button>
          <Link href="/staff" className="button button-secondary">{t("form.cancel")}</Link>
        </div>
      </form>
    </>
  );
}
