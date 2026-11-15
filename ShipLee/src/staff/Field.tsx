import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { useLanguage } from "../i18n.js";
import type { Key } from "../../shared/i18n.js";

/**
 * One box with its label above it, a hint under the label, and its problem
 * under the box. The problem arrives with Save and leaves with the fix; it is
 * part of what a screen reader says on entering the box.
 */
export function Field({ id, label, hint, optional, problem, wide, filled, children }: {
  id: string;
  label: string;
  hint?: string;
  optional?: boolean;
  problem?: string;
  wide?: boolean;
  /** Filled by ShipLee AI from an order message, until somebody changes it. */
  filled?: boolean;
  children: (describedBy: string | undefined, invalid: boolean) => ReactNode;
}) {
  const { t } = useLanguage();
  const describedBy = [hint ? `${id}-hint` : null, problem ? `${id}-problem` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field${wide ? " full" : ""}${filled ? " filled" : ""}`}>
      <label htmlFor={id} className="field-label">
        {label}
        {optional ? <span className="optional"> ({t("form.optional")})</span> : null}
        {filled ? <span className="filled-tag">{t("intake.fromMessage")}</span> : null}
      </label>
      {hint ? <p id={`${id}-hint`} className="field-hint">{hint}</p> : null}
      {children(describedBy, Boolean(problem))}
      {problem ? (
        <p id={`${id}-problem`} className="field-error">
          <CircleAlert size={15} aria-hidden="true" />
          {t(problem as Key)}
        </p>
      ) : null}
    </div>
  );
}

/** Focuses the first box with a problem, in the order the form draws them. */
export function focusFirstProblem(form: HTMLFormElement | null) {
  form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}
