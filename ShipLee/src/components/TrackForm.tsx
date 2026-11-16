import { useId, useState } from "react";
import type { FormEvent } from "react";
import { useLocation } from "wouter";
import { CircleAlert, Search } from "lucide-react";
import { useLanguage } from "../i18n.js";
import type { Key, Params } from "../../shared/i18n.js";
import { MAX_PARCELS, parseTrackingList, parseTrackingNumber } from "../../shared/tracking.js";

type Problem = { key: Key; params?: Params };

/**
 * The tracking box. One number, or several separated by commas. Each is
 * checked here first — its check digit catches a mistyped digit — so a typo is
 * said under the box rather than answered with "not found". The problem comes
 * with Track and goes as the box is corrected.
 */
export function TrackForm({ initial = "", autoFocus = false, labelHidden = false, inputId }: { initial?: string; autoFocus?: boolean; labelHidden?: boolean; inputId?: string }) {
  const { t } = useLanguage();
  const [, navigate] = useLocation();
  const [value, setValue] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const generated = useId();
  const id = inputId ?? `${generated}-input`;
  const problem = attempted ? problemOf(value) : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (problemOf(value)) {
      document.getElementById(id)?.focus();
      return;
    }
    const { numbers } = parseTrackingList(value);
    navigate(`/track/${numbers.join(",")}`);
  };

  return (
    <form className="track-form" onSubmit={submit} noValidate role="search">
      <div className="field">
        <label htmlFor={id} className={labelHidden ? "sr-only" : "field-label"}>{t("track.label")}</label>
        <div className="row">
          <input
            id={id}
            className="input ltr-input"
            value={value}
            onChange={event => setValue(event.target.value)}
            placeholder={t("track.placeholder")}
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus={autoFocus}
            data-autofocus={autoFocus ? "" : undefined}
            maxLength={240}
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
            {t(problem.key, problem.params)}
          </p>
        ) : null}
        <p id={`${id}-hint`} className="field-hint">{t("track.hint")} {t("track.hintSeveral")}</p>
      </div>
    </form>
  );
}

/** What is wrong with the box, or nothing: one number is judged on its own, several by the first that is not one. */
function problemOf(value: string): Problem | null {
  const list = parseTrackingList(value);
  if (!list.numbers.length && list.problems.length <= 1) {
    const single = parseTrackingNumber(value);
    if (single.ok) return null;
    return { key: single.reason === "empty" ? "track.empty" : single.reason === "shape" ? "track.shape" : "track.check" };
  }
  if (list.problems.length) return { key: "track.listProblem", params: { text: list.problems[0]!.slice(0, 24) } };
  if (list.numbers.length > MAX_PARCELS) return { key: "track.tooMany", params: { max: MAX_PARCELS } };
  return null;
}
