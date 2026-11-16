import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useLocation } from "wouter";
import { ArrowRight } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { useConfig, usePageTitle } from "../hooks.js";
import { Field, focusFirstProblem } from "../components/ui/Field.js";
import { MessageRequest, canRequest } from "../components/RequestDialogs.js";
import { parseTrackingNumber } from "../../shared/tracking.js";
import type { Key } from "../../shared/i18n.js";

const REASON: Record<"empty" | "shape" | "check", Key> = { empty: "track.empty", shape: "track.shape", check: "track.check" };

/**
 * Reporting a problem without a tracking page open: the number first, checked
 * by its check digit, then the same form the tracking page's Report a problem
 * draws, which ends in a message the customer sends on WhatsApp or by email.
 * `?number=` arrives already filled. With no way to reach the team, it says
 * who to ask instead.
 */
export function Report() {
  const { t } = useLanguage();
  const config = useConfig();
  const [, navigate] = useLocation();
  usePageTitle(t("title.report"));
  const form = useRef<HTMLFormElement>(null);
  const [typed, setTyped] = useState(() => new URLSearchParams(window.location.search).get("number") ?? "");
  const [problem, setProblem] = useState<Key | undefined>();
  const [number, setNumber] = useState<string | null>(null);

  const go = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseTrackingNumber(typed);
    if (!parsed.ok) {
      setProblem(REASON[parsed.reason]);
      requestAnimationFrame(() => focusFirstProblem(form.current));
      return;
    }
    setProblem(undefined);
    setNumber(parsed.number);
    /* The form that follows takes the keyboard: its first box. */
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".report-form input")?.focus());
  };

  return (
    <div className="container">
      <div className="page-head narrow-head">
        <h1 className="page-title">{t("report.title")}</h1>
        <p className="page-lead">{config && !canRequest(config.contact) ? t("report.none") : t("report.lead")}</p>
      </div>

      {config && canRequest(config.contact) ? (
        <div className="card report-card">
          {number ? (
            <>
              <div className="report-about">
                <h2 className="card-title">{t("report.about", { number })}</h2>
                <button type="button" className="button button-quiet button-small" onClick={() => setNumber(null)}>{t("report.change")}</button>
              </div>
              <div className="report-form">
                <MessageRequest kind="problem" number={number} contact={config.contact} onDone={() => navigate(`/track/${number}`)} />
              </div>
            </>
          ) : (
            <form ref={form} onSubmit={go} noValidate>
              <h2 className="card-title">{t("report.numberTitle")}</h2>
              <Field id="report-number" label={t("track.label")} hint={t("track.hint")} problem={problem}>
                {(describedBy, invalid) => (
                  <input
                    id="report-number"
                    className="input ltr-input"
                    value={typed}
                    onChange={event => setTyped(event.target.value)}
                    placeholder={t("track.placeholder")}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={40}
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                  />
                )}
              </Field>
              <div className="button-row">
                <button type="submit" className="button button-primary">
                  {t("report.continue")}
                  <ArrowRight size={18} aria-hidden="true" className="flip" />
                </button>
              </div>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
