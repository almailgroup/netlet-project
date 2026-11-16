import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, Check, CircleCheckBig } from "lucide-react";
import { useLanguage } from "../../i18n.js";
import { usePageTitle } from "../../hooks.js";
import { Field, focusFirstProblem } from "../../components/ui/Field.js";
import { PreviewTag } from "../../preview.js";
import { Destination } from "../../components/Destination.js";
import { GOVERNORATES, governorateName, isGovernorate } from "../../../shared/kuwait.js";
import { LIMITS, filsOf, kuwaitPhone } from "../../../shared/shipment.js";
import { foldDigits } from "../../../shared/digits.js";
import { formatMoney } from "../../../shared/format.js";
import type { Key } from "../../../shared/i18n.js";
import { SIZES } from "../../samples/rates.js";
import type { Size } from "../../samples/rates.js";
import { PreviewHead } from "./PreviewHead.js";

const STEPS = ["sender", "recipient", "parcel", "review"] as const;
type Step = (typeof STEPS)[number];

type Party = { name: string; phone: string; governorate: string; area: string; address: string };
type Parcel = { size: Size; pieces: string; cod: string };
type Problems = Partial<Record<string, Key>>;

const emptyParty: Party = { name: "", phone: "", governorate: "", area: "", address: "" };

/** A party is held to the shipment form's own rules: the phone, the governorate and the sizes it allows. */
function partyProblems(party: Party): Problems {
  const problems: Problems = {};
  if (!party.name.trim()) problems.name = "book.nameNeeded";
  else if (party.name.trim().length > LIMITS.name) problems.name = "form.tooLong";
  if (!kuwaitPhone(party.phone)) problems.phone = "form.phoneShape";
  if (!isGovernorate(party.governorate)) problems.governorate = "form.governorateNeeded";
  if (!party.area.trim()) problems.area = "book.areaNeeded";
  else if (party.area.trim().length > LIMITS.area) problems.area = "form.tooLong";
  if (!party.address.trim()) problems.address = "book.addressNeeded";
  else if (party.address.trim().length > LIMITS.address) problems.address = "form.tooLong";
  return problems;
}

function parcelProblems(parcel: Parcel): Problems {
  const problems: Problems = {};
  const pieces = foldDigits(parcel.pieces.trim() || "1");
  if (!/^\d{1,2}$/.test(pieces) || Number(pieces) < 1) problems.pieces = "form.piecesShape";
  if (parcel.cod.trim() && filsOf(parcel.cod) === null) problems.cod = "form.amountShape";
  return problems;
}

/**
 * Booking a delivery, as it will be: four steps, each held to its rules under
 * its boxes before the next, a check page with a way back to each, and an end
 * that says plainly nothing was sent. A preview page; the form keeps nothing.
 *
 * Where it connects later: the check page's Book button sends the details to
 * an API that creates the shipment (the staff desk's create, opened to
 * customers) and answers with the tracking number.
 */
export function Book() {
  const { t } = useLanguage();
  usePageTitle(t("title.book"));
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<Step>("sender");
  const [sender, setSender] = useState<Party>(emptyParty);
  const [recipient, setRecipient] = useState<Party>(emptyParty);
  const [parcel, setParcel] = useState<Parcel>({ size: "small", pieces: "1", cod: "" });
  const [problems, setProblems] = useState<Problems>({});
  const [done, setDone] = useState(false);
  const [moved, setMoved] = useState(false);
  const index = STEPS.indexOf(step);

  /* Moving between steps puts the keyboard on the new step's name. */
  useEffect(() => {
    if (moved) heading.current?.focus();
  }, [step, done, moved]);

  const go = (next: Step) => {
    setProblems({});
    setMoved(true);
    setStep(next);
  };

  const next = (event: FormEvent) => {
    event.preventDefault();
    const found = step === "sender" ? partyProblems(sender) : step === "recipient" ? partyProblems(recipient) : step === "parcel" ? parcelProblems(parcel) : {};
    if (Object.keys(found).length) {
      setProblems(found);
      requestAnimationFrame(() => focusFirstProblem(form.current));
      return;
    }
    if (step === "review") {
      setMoved(true);
      setDone(true);
      return;
    }
    go(STEPS[index + 1]!);
  };

  if (done) {
    return (
      <div className="container">
        <PreviewHead title={t("book.title")} lead={t("book.lead")} />
        <div className="card request-sent book-done" role="status">
          <span className="icon-tile preview-tile"><CircleCheckBig size={26} aria-hidden="true" /></span>
          <h2 className="card-title" ref={heading} tabIndex={-1}>{t("book.doneTitle")}</h2>
          <p className="muted">{t("book.doneBody")}</p>
          <div className="button-row">
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                setSender(emptyParty);
                setRecipient(emptyParty);
                setParcel({ size: "small", pieces: "1", cod: "" });
                setDone(false);
                go("sender");
              }}
            >
              {t("book.again")}
            </button>
            <Link href="/" className="button button-secondary">{t("nav.trackParcel")}</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <PreviewHead title={t("book.title")} lead={t("book.lead")} />
      <nav aria-label={t("book.stepsName")}>
        <ol className="book-steps">
          {STEPS.map((name, at) => (
            <li key={name} className={at < index ? "done" : at === index ? "current" : undefined} aria-current={at === index ? "step" : undefined}>
              <span className="book-step-mark" aria-hidden="true">{at < index ? <Check size={16} /> : at + 1}</span>
              <span>{t(`book.step.${name}`)}</span>
            </li>
          ))}
        </ol>
      </nav>

      <form ref={form} className="card book-form" onSubmit={next} noValidate>
        <p className="field-hint">{t("book.stepOf", { step: index + 1, steps: STEPS.length })}</p>
        <h2 className="card-title" ref={heading} tabIndex={-1}>{t(`book.step.${step}`)}</h2>

        {step === "sender" || step === "recipient" ? (
          <PartyFields
            id={step}
            party={step === "sender" ? sender : recipient}
            problems={problems}
            onChange={step === "sender" ? setSender : setRecipient}
            labels={
              step === "sender"
                ? { name: "book.senderName", phone: "book.senderPhone", area: "book.pickupArea", address: "book.pickupAddress" }
                : { name: "book.recipientName", phone: "book.recipientPhone", area: "book.dropArea", address: "book.dropAddress" }
            }
          />
        ) : null}

        {step === "parcel" ? (
          <div className="form-grid two">
            <fieldset className="choice-set full">
              <legend className="field-label">{t("book.size")}</legend>
              <div className="choices grid">
                {SIZES.map(option => (
                  <label key={option} className="choice">
                    <input type="radio" name="book-size" value={option} checked={parcel.size === option} onChange={() => setParcel(current => ({ ...current, size: option }))} />
                    <span className="choice-text">
                      <strong>{t(`rates.size.${option}`)}</strong>
                      <span>{t(`rates.size.${option}Hint`)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field id="book-pieces" label={t("form.pieces")} problem={problems.pieces}>
              {(describedBy, invalid) => (
                <input id="book-pieces" className="input ltr-input" inputMode="numeric" value={parcel.pieces} maxLength={2} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => setParcel(current => ({ ...current, pieces: event.target.value }))} />
              )}
            </Field>
            <Field id="book-cod" label={t("form.cod")} hint={t("form.codHint")} optional problem={problems.cod}>
              {(describedBy, invalid) => (
                <input id="book-cod" className="input ltr-input" inputMode="decimal" value={parcel.cod} maxLength={12} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => setParcel(current => ({ ...current, cod: event.target.value }))} />
              )}
            </Field>
          </div>
        ) : null}

        {step === "review" ? <Review sender={sender} recipient={recipient} parcel={parcel} onChange={go} /> : null}

        <div className="form-actions book-actions">
          {index > 0 ? (
            <button type="button" className="button button-secondary" onClick={() => go(STEPS[index - 1]!)}>
              <ArrowLeft size={18} aria-hidden="true" className="flip" />
              {t("book.back")}
            </button>
          ) : null}
          <button type="submit" className="button button-primary">
            {step === "review" ? t("book.submit") : t("book.next")}
            {step === "review" ? null : <ArrowRight size={18} aria-hidden="true" className="flip" />}
          </button>
          {step === "review" ? <PreviewTag /> : null}
        </div>
      </form>
    </div>
  );
}

function PartyFields({ id, party, problems, labels, onChange }: {
  id: string;
  party: Party;
  problems: Problems;
  labels: { name: Key; phone: Key; area: Key; address: Key };
  onChange: (update: (party: Party) => Party) => void;
}) {
  const { t, lang } = useLanguage();
  const set = (key: keyof Party) => (value: string) => onChange(current => ({ ...current, [key]: value }));
  return (
    <div className="form-grid two">
      <Field id={`${id}-name`} label={t(labels.name)} problem={problems.name}>
        {(describedBy, invalid) => <input id={`${id}-name`} className="input" dir="auto" autoComplete="name" maxLength={LIMITS.name} value={party.name} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => set("name")(event.target.value)} />}
      </Field>
      <Field id={`${id}-phone`} label={t(labels.phone)} problem={problems.phone}>
        {(describedBy, invalid) => <input id={`${id}-phone`} className="input ltr-input" type="tel" inputMode="tel" autoComplete="tel-national" value={party.phone} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => set("phone")(event.target.value)} />}
      </Field>
      <Field id={`${id}-governorate`} label={t("form.governorate")} problem={problems.governorate}>
        {(describedBy, invalid) => (
          <select id={`${id}-governorate`} className="input" value={party.governorate} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => set("governorate")(event.target.value)}>
            <option value="" disabled>{t("form.choose")}</option>
            {GOVERNORATES.map(g => <option key={g.slug} value={g.slug}>{governorateName(g.slug, lang)}</option>)}
          </select>
        )}
      </Field>
      <Field id={`${id}-area`} label={t(labels.area)} problem={problems.area}>
        {(describedBy, invalid) => <input id={`${id}-area`} className="input" dir="auto" autoComplete="address-level3" maxLength={LIMITS.area} value={party.area} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => set("area")(event.target.value)} />}
      </Field>
      <Field id={`${id}-address`} label={t(labels.address)} hint={t("req.addressHint")} problem={problems.address} wide>
        {(describedBy, invalid) => <input id={`${id}-address`} className="input" dir="auto" autoComplete="street-address" maxLength={LIMITS.address} value={party.address} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => set("address")(event.target.value)} />}
      </Field>
    </div>
  );
}

/** The check page: each part as it was typed, with a way back to change it. */
function Review({ sender, recipient, parcel, onChange }: { sender: Party; recipient: Party; parcel: Parcel; onChange: (step: Step) => void }) {
  const { t, lang } = useLanguage();
  const where = (party: Party) => <Destination area={party.area.trim()} governorate={isGovernorate(party.governorate) ? party.governorate : null} />;
  const cod = filsOf(parcel.cod);
  const section = (step: Step, rows: [string, ReactNode][]) => (
    <section className="book-review-part" aria-labelledby={`review-${step}`}>
      <div className="book-review-head">
        <h3 id={`review-${step}`}>{t(`book.step.${step}`)}</h3>
        <button type="button" className="button button-quiet button-small" onClick={() => onChange(step)} aria-label={`${t("book.change")}: ${t(`book.step.${step}`)}`}>{t("book.change")}</button>
      </div>
      <dl className="detail-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
  return (
    <div className="book-review">
      {section("sender", [
        [t("book.senderName"), <bdi key="n">{sender.name.trim()}</bdi>],
        [t("book.senderPhone"), <bdi key="p" dir="ltr">{kuwaitPhone(sender.phone)}</bdi>],
        [t("book.pickupArea"), where(sender)],
        [t("book.pickupAddress"), <bdi key="d">{sender.address.trim()}</bdi>],
      ])}
      {section("recipient", [
        [t("book.recipientName"), <bdi key="n">{recipient.name.trim()}</bdi>],
        [t("book.recipientPhone"), <bdi key="p" dir="ltr">{kuwaitPhone(recipient.phone)}</bdi>],
        [t("book.dropArea"), where(recipient)],
        [t("book.dropAddress"), <bdi key="d">{recipient.address.trim()}</bdi>],
      ])}
      {section("parcel", [
        [t("book.size"), t(`rates.size.${parcel.size}`)],
        [t("form.pieces"), foldDigits(parcel.pieces.trim() || "1")],
        [t("form.cod"), cod ? formatMoney(cod, lang) : "—"],
      ])}
    </div>
  );
}
