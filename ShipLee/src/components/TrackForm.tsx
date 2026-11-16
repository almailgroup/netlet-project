import { useId, useState } from "react";
import type { FormEvent } from "react";
import { useLocation } from "wouter";
import { CircleAlert, Search } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { parseTrackingNumber } from "../../shared/tracking.js";

/**
 * The tracking box. The number is checked here first — its check digit
 * catches a mistyped digit — so a typo is said under the box rather than
 * answered with "not found". The error comes with Track and goes as the
 * number is corrected.
 */
export function TrackForm({ initial = "", autoFocus = false, labelHidden = false, inputId }: { initial?: string; autoFocus?: boolean; labelHidden?: boolean; inputId?: string }) {
  const { t } = useLanguage();
  const [, navigate] = useLocation();
  const [value, setValue] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const generated = useId();
  const id = inputId ?? generated;
  const parsed = parseTrackingNumber(value);
  const problem = attempted && !parsed.ok ? (parsed.reason === "empty" ? "track.empty" : parsed.reason === "shape" ? "track.shape" : "track.check") : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (parsed.ok) navigate(`/track/${parsed.number}`);
    else document.getElementById(inputId ?? `${id}-input`)?.focus();
  };

  return (
    <form className="track-form" onSubmit={submit} noValidate role="search">
      <div className="field">
        <label htmlFor={inputId ?? `${id}-input`} className={labelHidden ? "sr-only" : "field-label"}>{t("track.label")}</label>
        <div className="row">
          <input
            id={inputId ?? `${id}-input`}
            data-autofocus={autoFocus ? "" : undefined}
            className="input ltr-input"
            value={value}
            onChange={event => setValue(event.target.value)}
            placeholder={t("track.placeholder")}
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus={autoFocus}
            maxLength={24}
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${id}-hint${problem ? ` ${id}-error` : ""}`}
          />
          <button type="submit" className="button button-primary">
            <Search size={18} aria-hidden="true" />
            {t("track.button")}
          </button>
        </div>
        {problem ? (
          <p id={`${id}-error`} className="field-error">
            <CircleAlert size={15} aria-hidden="true" />
            {t(problem)}
          </p>
        ) : null}
        <p id={`${id}-hint`} className="field-hint">{t("track.hint")}</p>
      </div>
    </form>
  );
}
