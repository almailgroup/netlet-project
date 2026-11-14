import { Check } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { MILESTONES } from "../../shared/status.js";

/**
 * The four steps every parcel takes, filled to the furthest reached. Each
 * step says to a screen reader whether it is done, where the parcel is now,
 * or still to come — the picture is not the only way it is told.
 */
export function Progress({ reached }: { reached: number }) {
  const { t } = useLanguage();
  return (
    <ol className="progress" data-reached={reached} aria-label={t("result.progress")}>
      {MILESTONES.map((status, index) => {
        const step = index + 1;
        const state = step < reached || (step === reached && status === "delivered") ? "done" : step === reached ? "now" : "next";
        const name = t(`status.${status}`);
        const said = state === "done" ? t("result.stepDone", { step: name }) : state === "now" ? t("result.stepNow", { step: name }) : t("result.stepNext", { step: name });
        return (
          <li key={status} className={state} aria-current={state === "now" ? "step" : undefined}>
            <span className="dot" aria-hidden="true">{state === "done" ? <Check size={14} strokeWidth={3} /> : null}</span>
            <span className="label" aria-hidden="true">{name}</span>
            <span className="sr-only">{said}</span>
          </li>
        );
      })}
    </ol>
  );
}
