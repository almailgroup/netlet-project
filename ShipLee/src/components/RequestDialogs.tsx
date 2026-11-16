import { useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { CircleCheckBig, ExternalLink, Mail, MessageCircle } from "lucide-react";
import { useLanguage } from "../i18n.js";
import type { Config } from "../api.js";
import { Dialog } from "./ui/Dialog.js";
import { Field, focusFirstProblem } from "./ui/Field.js";
import { PreviewTag } from "../preview.js";
import type { Key } from "../../shared/i18n.js";
import { GOVERNORATES, governorateName, kuwaitDay } from "../../shared/kuwait.js";
import { formatDay } from "../../shared/format.js";
import { LIMITS, kuwaitPhone } from "../../shared/shipment.js";
import type { Problems, Request } from "../../shared/requests.js";
import { MAX_DETAILS, MIN_DETAILS, PROBLEMS, TIME_SLOTS, readAddress, readProblem, readReschedule, requestLinks, rescheduleDays } from "../../shared/requests.js";

export type RequestKind = "reschedule" | "address" | "problem" | "notify";
type Contact = Config["contact"];
type Channel = "whatsapp" | "email";

/** Whether a request can reach ShipLee's team from this deployment at all. */
export function canRequest(contact: Contact | undefined): boolean {
  return Boolean(contact?.whatsapp || contact?.email);
}

/**
 * The dialog for one request about one parcel. Reschedule, change address and
 * report a problem end in a message the customer sends ShipLee's team on
 * WhatsApp or by email, already written, the tracking number in it — nothing
 * goes anywhere until they press send there. Notifications are a preview:
 * there is nothing to send them yet, and the dialog says so.
 */
export function RequestDialog({ kind, number, contact, onClose }: { kind: RequestKind | null; number: string; contact: Contact; onClose: () => void }) {
  const { t } = useLanguage();
  const titles: Record<RequestKind, [Key, Key]> = {
    reschedule: ["req.rescheduleTitle", "req.rescheduleLead"],
    address: ["req.addressTitle", "req.addressLead"],
    problem: ["req.problemTitle", "req.problemLead"],
    notify: ["notify.title", "notify.lead"],
  };
  const [title, lead] = kind ? titles[kind] : titles.reschedule;
  return (
    <Dialog open={kind !== null} onClose={onClose} title={t(title)} lead={t(lead)}>
      {kind === "notify" ? <NotifyForm onDone={onClose} /> : kind ? <MessageRequest kind={kind} number={number} contact={contact} onDone={onClose} /> : null}
    </Dialog>
  );
}

/** A request that becomes a message: the form, then where to finish sending it. */
function MessageRequest({ kind, number, contact, onDone }: { kind: Exclude<RequestKind, "notify">; number: string; contact: Contact; onDone: () => void }) {
  const { t, lang } = useLanguage();
  const form = useRef<HTMLFormElement>(null);
  const [problems, setProblems] = useState<Problems>({});
  const [sent, setSent] = useState<{ channel: Channel; href: string } | null>(null);
  const [reschedule, setReschedule] = useState({ day: "", slot: "", note: "" });
  const [address, setAddress] = useState({ governorate: "", area: "", address: "", note: "" });
  const [problem, setProblem] = useState({ problem: "", details: "" });
  const primary: Channel = contact.whatsapp ? "whatsapp" : "email";

  const read = (): { ok: true; request: Request } | { ok: false; problems: Problems } =>
    kind === "reschedule" ? readReschedule(reschedule, kuwaitDay()) : kind === "address" ? readAddress(address) : readProblem(problem);

  const send = (channel: Channel) => {
    const result = read();
    if (!result.ok) {
      setProblems(result.problems);
      /* The boxes have their problems drawn on the next frame; focus the first then. */
      requestAnimationFrame(() => focusFirstProblem(form.current));
      return;
    }
    setProblems({});
    const links = requestLinks(contact, lang, number, result.request);
    const href = channel === "whatsapp" ? links.whatsapp : links.email;
    if (!href) return;
    if (channel === "whatsapp") window.open(href, "_blank", "noopener,noreferrer");
    else window.location.href = href;
    setSent({ channel, href });
  };

  if (sent) {
    return (
      <div className="request-sent" role="status">
        <span className="icon-tile"><CircleCheckBig size={26} aria-hidden="true" /></span>
        <h3 className="card-title">{t("req.sentTitle")}</h3>
        <p className="muted">{t("req.sentBody")}</p>
        <div className="button-row">
          <button type="button" className="button button-primary" onClick={onDone}>{t("req.done")}</button>
          <a className="button button-secondary" href={sent.href} target={sent.channel === "whatsapp" ? "_blank" : undefined} rel="noopener noreferrer">
            <ExternalLink size={16} aria-hidden="true" className="flip" />
            {t("req.openAgain")}
          </a>
        </div>
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(primary);
  };

  return (
    <form ref={form} className="request-form" onSubmit={submit} noValidate>
      {kind === "reschedule" ? (
        <>
          <ChoiceGroup
            legend={t("req.day")}
            name="day"
            problem={problems.day}
            value={reschedule.day}
            options={rescheduleDays(kuwaitDay()).map(day => ({ value: day, label: formatDay(day, lang) }))}
            onChange={day => setReschedule(current => ({ ...current, day }))}
          />
          <ChoiceGroup
            legend={t("req.slot")}
            name="slot"
            problem={problems.slot}
            value={reschedule.slot}
            options={TIME_SLOTS.map(slot => ({ value: slot, label: t(`req.slot.${slot}`) }))}
            onChange={slot => setReschedule(current => ({ ...current, slot }))}
          />
          <Note value={reschedule.note} problem={problems.note} onChange={note => setReschedule(current => ({ ...current, note }))} />
        </>
      ) : null}

      {kind === "address" ? (
        <div className="form-grid two">
          <Field id="req-governorate" label={t("form.governorate")} problem={problems.governorate}>
            {(describedBy, invalid) => (
              <select id="req-governorate" className="input" value={address.governorate} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => setAddress(current => ({ ...current, governorate: event.target.value }))}>
                <option value="" disabled>{t("form.choose")}</option>
                {GOVERNORATES.map(g => <option key={g.slug} value={g.slug}>{governorateName(g.slug, lang)}</option>)}
              </select>
            )}
          </Field>
          <Field id="req-area" label={t("req.area")} problem={problems.area}>
            {(describedBy, invalid) => (
              <input id="req-area" className="input" dir="auto" autoComplete="address-level3" maxLength={LIMITS.area} value={address.area} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => setAddress(current => ({ ...current, area: event.target.value }))} />
            )}
          </Field>
          <Field id="req-address" label={t("req.address")} hint={t("req.addressHint")} problem={problems.address} wide>
            {(describedBy, invalid) => (
              <input id="req-address" className="input" dir="auto" autoComplete="street-address" maxLength={LIMITS.address} value={address.address} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => setAddress(current => ({ ...current, address: event.target.value }))} />
            )}
          </Field>
          <div className="full">
            <Note value={address.note} problem={problems.note} onChange={note => setAddress(current => ({ ...current, note }))} />
          </div>
        </div>
      ) : null}

      {kind === "problem" ? (
        <>
          <ChoiceGroup
            legend={t("req.problemLegend")}
            name="problem"
            problem={problems.problem}
            value={problem.problem}
            columns
            options={PROBLEMS.map(item => ({ value: item, label: t(`req.problem.${item}`) }))}
            onChange={value => setProblem(current => ({ ...current, problem: value }))}
          />
          <Field id="req-details" label={t("req.details")} hint={t("req.detailsHint")} problem={problems.details} problemParams={{ min: MIN_DETAILS }}>
            {(describedBy, invalid) => (
              <textarea id="req-details" className="input" dir="auto" maxLength={MAX_DETAILS} value={problem.details} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => setProblem(current => ({ ...current, details: event.target.value }))} />
            )}
          </Field>
        </>
      ) : null}

      <p className="field-hint request-note">{t(primary === "whatsapp" ? "act.viaWhatsApp" : "act.viaEmail")} {t("req.opens")}</p>
      <div className="button-row request-actions">
        <button type="submit" className="button button-primary">
          {primary === "whatsapp" ? <MessageCircle size={18} aria-hidden="true" /> : <Mail size={18} aria-hidden="true" />}
          {t(primary === "whatsapp" ? "req.sendWhatsApp" : "req.sendEmail")}
        </button>
        {primary === "whatsapp" && contact.email ? (
          <button type="button" className="button button-secondary" onClick={() => send("email")}>
            <Mail size={18} aria-hidden="true" />
            {t("req.sendEmail")}
          </button>
        ) : null}
      </div>
    </form>
  );
}

/** A set of choices drawn as rows, one of which must be picked, its problem under the set. */
function ChoiceGroup({ legend, name, options, value, problem, columns, onChange }: {
  legend: string;
  name: string;
  options: { value: string; label: string }[];
  value: string;
  problem?: Key;
  columns?: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useLanguage();
  const problemId = `req-${name}-problem`;
  return (
    <fieldset className="choice-set" aria-describedby={problem ? problemId : undefined}>
      <legend className="field-label">{legend}</legend>
      <div className={`choices${columns ? "" : " grid"}`}>
        {options.map((option, index) => (
          <label key={option.value} className="choice">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              aria-invalid={problem && index === 0 ? true : undefined}
            />
            <span className="choice-text"><strong>{option.label}</strong></span>
          </label>
        ))}
      </div>
      {problem ? <p id={problemId} className="field-error">{t(problem)}</p> : null}
    </fieldset>
  );
}

function Note({ value, problem, onChange }: { value: string; problem?: Key; onChange: (value: string) => void }) {
  const { t } = useLanguage();
  return (
    <Field id="req-note" label={t("req.note")} optional problem={problem}>
      {(describedBy, invalid) => (
        <textarea id="req-note" className="input request-note-box" dir="auto" maxLength={LIMITS.note} value={value} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => onChange(event.target.value)} />
      )}
    </Field>
  );
}

/**
 * Notifications, as they will be once there is something to send them: a
 * preview, which says so, keeps nothing and sends nothing.
 */
function NotifyForm({ onDone }: { onDone: () => void }) {
  const { t } = useLanguage();
  const form = useRef<HTMLFormElement>(null);
  const [channel, setChannel] = useState("whatsapp");
  const [which, setWhich] = useState("all");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [problem, setProblem] = useState<Key | null>(null);
  const [done, setDone] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const wrong: Key | null = channel === "email" ? (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : "notify.emailNeeded") : kuwaitPhone(phone) ? null : "notify.phoneNeeded";
    setProblem(wrong);
    if (wrong) {
      requestAnimationFrame(() => focusFirstProblem(form.current));
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <div className="request-sent" role="status">
        <span className="icon-tile preview-tile"><CircleCheckBig size={26} aria-hidden="true" /></span>
        <PreviewTag />
        <p className="muted">{t("notify.previewDone")}</p>
        <div className="button-row">
          <button type="button" className="button button-primary" onClick={onDone}>{t("req.done")}</button>
        </div>
      </div>
    );
  }

  return (
    <form ref={form} className="request-form" onSubmit={submit} noValidate>
      <p><PreviewTag /></p>
      <ChoiceGroup
        legend={t("notify.channel")}
        name="channel"
        value={channel}
        options={[
          { value: "whatsapp", label: t("contact.whatsapp") },
          { value: "sms", label: t("notify.sms") },
          { value: "email", label: t("contact.email") },
        ]}
        onChange={value => {
          setChannel(value);
          setProblem(null);
        }}
      />
      {channel === "email" ? (
        <Field id="notify-email" label={t("notify.emailLabel")} problem={problem ?? undefined}>
          {(describedBy, invalid) => (
            <input id="notify-email" className="input ltr-input" type="email" autoComplete="email" value={email} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => setEmail(event.target.value)} />
          )}
        </Field>
      ) : (
        <Field id="notify-phone" label={t("notify.phone")} hint={t("notify.phoneHint")} problem={problem ?? undefined}>
          {(describedBy, invalid) => (
            <input id="notify-phone" className="input ltr-input" type="tel" inputMode="tel" autoComplete="tel-national" value={phone} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => setPhone(event.target.value)} />
          )}
        </Field>
      )}
      <ChoiceGroup
        legend={t("notify.which")}
        name="which"
        value={which}
        options={[
          { value: "all", label: t("notify.all") },
          { value: "key", label: t("notify.key") },
        ]}
        onChange={setWhich}
      />
      <div className="button-row request-actions">
        <button type="submit" className="button button-primary">{t("notify.submit")}</button>
      </div>
    </form>
  );
}

/** One action on the tracking page: an icon, what it does and a line under it. */
export function ActionButton({ icon, label, lead, onClick, preview }: { icon: ReactNode; label: string; lead: string; onClick: () => void; preview?: boolean }) {
  return (
    <button type="button" className="action" onClick={onClick}>
      <span className="icon-tile small" aria-hidden="true">{icon}</span>
      <span className="action-text">
        <strong>{label}{preview ? <> <PreviewTag /></> : null}</strong>
        <span>{lead}</span>
      </span>
    </button>
  );
}
