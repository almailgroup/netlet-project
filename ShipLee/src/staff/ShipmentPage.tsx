import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearch } from "wouter";
import { ArrowLeft, CircleCheckBig, ExternalLink, Printer } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { useDesk } from "./Staff.js";
import { Field, focusFirstProblem } from "../components/ui/Field.js";
import { ShipmentFields } from "./ShipmentFields.js";
import { StatusPill } from "../components/Status.js";
import { Timeline } from "../components/Timeline.js";
import type { Problems, ShipmentDraft, StaffShipment, UpdateDraft } from "../../shared/shipment.js";
import { draftOf, shipmentProblems, updateProblems } from "../../shared/shipment.js";
import type { Status } from "../../shared/status.js";
import { STATUSES } from "../../shared/status.js";
import { formatDateTime, formatMoney, formatDay } from "../../shared/format.js";
import { fromKuwaitClock, toKuwaitClock } from "../../shared/kuwait.js";
import { Destination } from "../components/Destination.js";

/** What usually happens next, so the update form starts on it. */
const NEXT: Record<Status, Status> = {
  created: "picked_up",
  picked_up: "in_transit",
  in_transit: "out_for_delivery",
  out_for_delivery: "delivered",
  attempted: "out_for_delivery",
  on_hold: "in_transit",
  delivered: "delivered",
  returned: "returned",
  cancelled: "cancelled",
};

export function ShipmentPage({ id }: { id: string }) {
  const { t, n, lang } = useLanguage();
  const { call } = useDesk();
  const created = new URLSearchParams(useSearch()).get("created") === "1";
  const [shipment, setShipment] = useState<StaffShipment | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<string | null>(created ? "created" : null);

  const load = useCallback(async () => {
    const answer = await call<StaffShipment>("GET", `/api/staff/shipments/${encodeURIComponent(id)}`);
    if (answer.ok) setShipment(answer.body);
    else if (answer.status === 404) setMissing(true);
  }, [call, id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <>
        <Link href="/staff" className="back-link"><ArrowLeft size={16} aria-hidden="true" className="flip" />{t("staff.back")}</Link>
        <p className="notice notice-stopped">{t("error.gone")}</p>
      </>
    );
  }
  if (!shipment) return <div className="card" aria-busy="true"><div className="skeleton" data-size="bar" /></div>;

  const notGiven = t("details.notGiven");
  return (
    <>
      <Link href="/staff" className="back-link"><ArrowLeft size={16} aria-hidden="true" className="flip" />{t("staff.back")}</Link>
      <div className="staff-bar">
        <div>
          <h1><bdi dir="ltr">{shipment.trackingNumber}</bdi></h1>
          <p className="list-count">{t("staff.createdAt", { when: formatDateTime(shipment.createdAt, lang) })}</p>
        </div>
        <div className="staff-actions">
          <StatusPill status={shipment.status} />
          <Link href={`/staff/shipments/${shipment.id}/label`} className="button button-secondary button-small">
            <Printer size={16} aria-hidden="true" />{n("labels", shipment.pieces)}
          </Link>
          <a href={`/track/${shipment.trackingNumber}`} target="_blank" rel="noopener" className="button button-secondary button-small">
            <ExternalLink size={16} aria-hidden="true" />{t("staff.openPublic")}
          </a>
        </div>
      </div>
      {saved ? (
        <p className="notice saved-note" role="status">
          <CircleCheckBig size={18} aria-hidden="true" />
          {saved === "created" ? t("staff.created", { number: shipment.trackingNumber }) : t(saved === "update" ? "update.saved" : "form.saved")}
        </p>
      ) : null}
      <div className="shipment-layout">
        <div>
          <UpdateForm shipment={shipment} onSaved={next => { setShipment(next); setSaved("update"); }} />
          <div className="card">
            <Timeline events={shipment.events} />
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>{t("details.title")}</h2>
            {!editing ? <button type="button" className="button button-secondary button-small" onClick={() => { setEditing(true); setSaved(null); }}>{t("form.edit")}</button> : null}
          </div>
          {editing ? (
            <EditDetails shipment={shipment} onDone={next => { if (next) { setShipment(next); setSaved("details"); } setEditing(false); }} />
          ) : (
            <dl className="detail-list">
              <div><dt>{t("form.sender")}</dt><dd dir="auto">{shipment.senderName}</dd></div>
              <div><dt>{t("result.to")}</dt><dd>{shipment.area || shipment.governorate ? <Destination area={shipment.area} governorate={shipment.governorate} /> : notGiven}</dd></div>
              <div><dt>{t("form.address")}</dt><dd dir="auto">{shipment.address ?? notGiven}</dd></div>
              <div><dt>{t("form.recipient")}</dt><dd dir="auto">{shipment.recipientName ?? notGiven}</dd></div>
              <div><dt>{t("form.phone")}</dt><dd>{shipment.recipientPhone ? <a href={`tel:+965${shipment.recipientPhone}`}><bdi dir="ltr">{shipment.recipientPhone}</bdi></a> : notGiven}</dd></div>
              <div><dt>{t("form.pieces")}</dt><dd>{shipment.pieces}</dd></div>
              <div><dt>{t("form.cod")}</dt><dd>{shipment.codFils ? <bdi>{formatMoney(shipment.codFils, lang)}</bdi> : notGiven}</dd></div>
              <div><dt>{t("form.expected")}</dt><dd>{shipment.expectedOn ? formatDay(shipment.expectedOn, lang) : notGiven}</dd></div>
            </dl>
          )}
        </div>
      </div>
    </>
  );
}

function UpdateForm({ shipment, onSaved }: { shipment: StaffShipment; onSaved: (shipment: StaffShipment) => void }) {
  const { t } = useLanguage();
  const { call } = useDesk();
  const fresh = (): UpdateDraft => ({ status: NEXT[shipment.status], location: "", note: "", happenedAt: toKuwaitClock(new Date()), expectedOn: shipment.expectedOn ?? "" });
  const [draft, setDraft] = useState<UpdateDraft>(fresh);
  /* The time box starts on now to the minute. Left alone it means "now", sent as nothing so the
     server's own clock is used: sent as it reads, 15:40 is earlier than a shipment made at 15:40:37,
     and the update would not move it. */
  const [timeTouched, setTimeTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [serverProblems, setServerProblems] = useState<Problems<keyof UpdateDraft>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  const instant = draft.happenedAt ? fromKuwaitClock(draft.happenedAt) : null;
  const sent = { status: draft.status, location: draft.location, note: draft.note, happenedAt: timeTouched && draft.happenedAt ? (instant ? instant.toISOString() : "invalid") : "", expectedOn: draft.expectedOn || null };
  const problems = attempted ? { ...updateProblems(sent, new Date()).problems, ...serverProblems } : {};
  const set = (key: keyof UpdateDraft) => (event: { target: { value: string } }) => {
    if (key === "happenedAt") setTimeTouched(true);
    setDraft({ ...draft, [key]: event.target.value });
    setServerProblems({});
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    setFailed(false);
    if (updateProblems(sent, new Date()).update === null) {
      requestAnimationFrame(() => focusFirstProblem(form.current));
      return;
    }
    setBusy(true);
    const answer = await call<StaffShipment>("POST", `/api/staff/shipments/${shipment.id}/events`, sent);
    setBusy(false);
    if (answer.ok) {
      onSaved(answer.body);
      setAttempted(false);
      setTimeTouched(false);
      setDraft({ status: NEXT[answer.body.status], location: "", note: "", happenedAt: toKuwaitClock(new Date()), expectedOn: answer.body.expectedOn ?? "" });
      return;
    }
    if (answer.problems) {
      setServerProblems(answer.problems);
      requestAnimationFrame(() => focusFirstProblem(form.current));
    } else setFailed(true);
  };

  return (
    <form ref={form} className="card" onSubmit={submit} noValidate aria-labelledby="update-title">
      <div className="card-head"><h2 id="update-title">{t("update.title")}</h2></div>
      <div className="form-grid two">
        <Field id="update-status" label={t("update.status")} problem={problems.status}>
          {(describedBy, invalid) => (
            <select id="update-status" className="input" value={draft.status} onChange={set("status")} aria-describedby={describedBy} aria-invalid={invalid || undefined}>
              {STATUSES.map(status => <option key={status} value={status}>{t(`status.${status}`)}</option>)}
            </select>
          )}
        </Field>
        <Field id="update-location" label={t("update.location")} hint={t("update.locationHint")} optional problem={problems.location}>
          {(describedBy, invalid) => <input id="update-location" className="input" value={draft.location} onChange={set("location")} maxLength={80} aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
        </Field>
        <Field id="update-note" label={t("update.note")} hint={t("update.noteHint")} optional problem={problems.note} wide>
          {(describedBy, invalid) => <textarea id="update-note" className="input" value={draft.note} onChange={set("note")} maxLength={280} rows={2} aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
        </Field>
        <Field id="update-when" label={t("update.when")} problem={problems.happenedAt}>
          {(describedBy, invalid) => <input id="update-when" className="input" type="datetime-local" value={draft.happenedAt} onChange={set("happenedAt")} aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
        </Field>
        <Field id="update-expected" label={t("form.expected")} optional problem={problems.expectedOn}>
          {(describedBy, invalid) => <input id="update-expected" className="input" type="date" value={draft.expectedOn} onChange={set("expectedOn")} aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
        </Field>
      </div>
      {failed ? <p className="notice notice-stopped form-note" role="alert">{t("error.generic")}</p> : null}
      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? t("update.saving") : t("update.save")}</button>
      </div>
    </form>
  );
}

function EditDetails({ shipment, onDone }: { shipment: StaffShipment; onDone: (shipment: StaffShipment | null) => void }) {
  const { t } = useLanguage();
  const { call } = useDesk();
  const [draft, setDraft] = useState<ShipmentDraft>(() => draftOf(shipment));
  const [attempted, setAttempted] = useState(false);
  const [serverProblems, setServerProblems] = useState<Problems<keyof ShipmentDraft>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const problems = attempted ? { ...shipmentProblems(draft).problems, ...serverProblems } : {};

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    setFailed(false);
    if (shipmentProblems(draft).details === null) {
      requestAnimationFrame(() => focusFirstProblem(form.current));
      return;
    }
    setBusy(true);
    const answer = await call<StaffShipment>("PATCH", `/api/staff/shipments/${shipment.id}`, draft);
    setBusy(false);
    if (answer.ok) return onDone(answer.body);
    if (answer.problems) {
      setServerProblems(answer.problems);
      requestAnimationFrame(() => focusFirstProblem(form.current));
    } else setFailed(true);
  };

  return (
    <form ref={form} onSubmit={submit} noValidate className="edit-form">
      <ShipmentFields draft={draft} onChange={next => { setDraft(next); setServerProblems({}); }} problems={problems} idPrefix="edit" />
      {failed ? <p className="notice notice-stopped form-note" role="alert">{t("error.generic")}</p> : null}
      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? t("form.saving") : t("form.save")}</button>
        <button type="button" className="button button-secondary" onClick={() => onDone(null)}>{t("form.cancel")}</button>
      </div>
    </form>
  );
}
