import { useState } from "react";
import { Link } from "wouter";
import { Minus, PackageCheck, Plus } from "lucide-react";
import { useLanguage } from "../../i18n.js";
import { usePageTitle } from "../../hooks.js";
import { ChoiceGroup } from "../../components/RequestDialogs.js";
import { GOVERNORATES, governorateName } from "../../../shared/kuwait.js";
import type { Governorate } from "../../../shared/kuwait.js";
import { formatMoney } from "../../../shared/format.js";
import { SIZES, SPEEDS, sameDayOffered, sampleRate } from "../../samples/rates.js";
import type { Size, Speed } from "../../samples/rates.js";
import { PreviewHead } from "./PreviewHead.js";

/**
 * A rate calculator with sample prices: every choice changes the price at
 * once, line by line, so the design can be judged with figures in it. The
 * total is said to a screen reader as it changes.
 */
export function Rates() {
  const { t, lang } = useLanguage();
  usePageTitle(t("title.rates"));
  const [from, setFrom] = useState<Governorate>("hawalli");
  const [to, setTo] = useState<Governorate>("capital");
  const [size, setSize] = useState<Size>("small");
  const [speed, setSpeed] = useState<Speed>("nextDay");
  const [pieces, setPieces] = useState(1);
  const [cod, setCod] = useState(false);
  const sameDay = sameDayOffered(from, to);
  const quote = sampleRate({ from, to, size, speed: sameDay ? speed : "nextDay", pieces, cod });

  return (
    <div className="container">
      <PreviewHead title={t("rates.title")} lead={t("rates.lead")} />
      <div className="rates-layout">
        <form className="card rates-form" onSubmit={event => event.preventDefault()}>
          <div className="form-grid two">
            <div className="field">
              <label className="field-label" htmlFor="rates-from">{t("rates.from")}</label>
              <select id="rates-from" className="input" value={from} onChange={event => setFrom(event.target.value as Governorate)}>
                {GOVERNORATES.map(g => <option key={g.slug} value={g.slug}>{governorateName(g.slug, lang)}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="rates-to">{t("rates.to")}</label>
              <select id="rates-to" className="input" value={to} onChange={event => setTo(event.target.value as Governorate)}>
                {GOVERNORATES.map(g => <option key={g.slug} value={g.slug}>{governorateName(g.slug, lang)}</option>)}
              </select>
            </div>
          </div>

          <fieldset className="choice-set">
            <legend className="field-label">{t("rates.size")}</legend>
            <div className="choices grid">
              {SIZES.map(option => (
                <label key={option} className="choice">
                  <input type="radio" name="size" value={option} checked={size === option} onChange={() => setSize(option)} />
                  <span className="choice-text">
                    <strong>{t(`rates.size.${option}`)}</strong>
                    <span>{t(`rates.size.${option}Hint`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="choice-set" aria-describedby={sameDay ? undefined : "rates-same-day"}>
            <legend className="field-label">{t("rates.speed")}</legend>
            <div className="choices grid">
              {SPEEDS.map(option => (
                <label key={option} className="choice">
                  <input type="radio" name="speed" value={option} checked={(sameDay ? speed : "nextDay") === option} disabled={option === "sameDay" && !sameDay} onChange={() => setSpeed(option)} />
                  <span className="choice-text"><strong>{t(`rates.speed.${option}`)}</strong></span>
                </label>
              ))}
            </div>
            {sameDay ? null : <p id="rates-same-day" className="field-hint">{t("rates.sameDayOnly")}</p>}
          </fieldset>

          <div className="field">
            <span className="field-label" id="rates-pieces-label">{t("rates.pieces")}</span>
            <div className="stepper" role="group" aria-labelledby="rates-pieces-label">
              <button type="button" className="button button-secondary button-icon" onClick={() => setPieces(count => Math.max(1, count - 1))} disabled={pieces <= 1} aria-label={`${t("rates.pieces")} −1`}>
                <Minus size={18} aria-hidden="true" />
              </button>
              <output className="stepper-value" aria-live="polite">{pieces}</output>
              <button type="button" className="button button-secondary button-icon" onClick={() => setPieces(count => Math.min(99, count + 1))} disabled={pieces >= 99} aria-label={`${t("rates.pieces")} +1`}>
                <Plus size={18} aria-hidden="true" />
              </button>
            </div>
          </div>

          <label className="choice">
            <input type="checkbox" checked={cod} onChange={event => setCod(event.target.checked)} />
            <span className="choice-text"><strong>{t("rates.cod")}</strong></span>
          </label>
        </form>

        <aside className="card rates-result" aria-labelledby="rates-result-title">
          <h2 id="rates-result-title" className="card-title">{t("rates.resultTitle")}</h2>
          <dl className="rates-lines">
            {quote.lines.map(line => (
              <div key={line.label}>
                <dt>{t(line.label)}</dt>
                <dd>{formatMoney(line.fils, lang)}</dd>
              </div>
            ))}
          </dl>
          <p className="rates-total" aria-live="polite">
            <span>{t("rates.total")}</span>
            <strong>{formatMoney(quote.totalFils, lang)}</strong>
          </p>
          <p className="field-hint">{t("rates.note")}</p>
          <Link href="/book" className="button button-primary button-block">
            <PackageCheck size={18} aria-hidden="true" />
            {t("rates.book")}
          </Link>
        </aside>
      </div>
    </div>
  );
}
