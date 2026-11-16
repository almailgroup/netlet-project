import { Check } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { MILESTONES } from "../../shared/status.js";
import type { Key } from "../../shared/i18n.js";

/** The five stages the progress line draws: booked, then the four steps every parcel takes. */
const STAGES: readonly { id: string; label: Key }[] = [
  { id: "created", label: "stage.created" },
  ...MILESTONES.map(status => ({ id: status, label: `status.${status}` as Key })),
];

/**
 * The stages a parcel goes through, filled to the furthest reached. Each says
 * to a screen reader whether it is done, where the parcel is now, or still to
 * come — the picture is not the only way it is told. `reached` counts the
 * four milestones (`progressOf`); booked is always behind a parcel that has a
 * page at all. A parcel that needs attention draws the stage it stopped at in
 * the attention ink.
 */
export function Progress({ reached, attention = false }: { reached: number; attention?: boolean }) {
  const { t } = useLanguage();
  const stage = reached + 1;
  return (
    <ol className={`progress${attention ? " tone-attention" : ""}`} data-steps={STAGES.length} data-reached={stage} aria-label={t("result.progress")}>
      {STAGES.map(({ id, label }, index) => {
        const step = index + 1;
        const state = step < stage || (step === stage && id === "delivered") ? "done" : step === stage ? "now" : "next";
        const name = t(label);
        const said = state === "done" ? t("result.stepDone", { step: name }) : state === "now" ? t("result.stepNow", { step: name }) : t("result.stepNext", { step: name });
        return (
          <li key={id} className={state} aria-current={state === "now" ? "step" : undefined}>
            <span className="dot" aria-hidden="true">{state === "done" ? <Check size={14} strokeWidth={3} /> : null}</span>
            <span className="label" aria-hidden="true">{name}</span>
            <span className="sr-only">{said}</span>
          </li>
        );
      })}
    </ol>
  );
}
