/**
 * Warranty and installation, as the shopper chooses them (3.1.2).
 *
 * Installation and an extended warranty are things a shopper decides about
 * *this* purchase, so they sit with the quantity and the buy button rather
 * than in a tab further down — by the time somebody has scrolled past the
 * button they have bought it without the fitting.
 *
 * An installation fee and any other extra are check boxes; **the warranty
 * plans are one choice**, radios under "Extended warranty" with "No extended
 * warranty" first — a line carries one plan at most, and the server keeps one
 * (`withOneWarranty`). Each says what it is and what it costs: "2-year
 * extended warranty, KWD 5.000 each".
 *
 * **Nothing is chosen by default**, ever: "No extended warranty" is the plan
 * until the shopper picks another. A pre-ticked warranty is how a shopper ends
 * up paying for something they did not ask for and did not notice.
 *
 * Absent rather than empty when the seller offers none, which is nearly every
 * product: a heading over nothing is the dead-control rule at section size.
 */
import { useId } from "react";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import type { ProductAddon } from "@shared/commerce/types";
import { Gift, ShieldCheck, Wrench } from "lucide-react";

const ROW = "flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2 hover:bg-[#0a285a]/[.06]";

export function AddonPicker({
  addons,
  chosen,
  onChange,
}: {
  addons: ProductAddon[];
  chosen: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const group = useId();
  if (addons.length === 0) return null;

  const plans = addons.filter(addon => addon.kind === "warranty");
  const planIds = new Set(plans.map(plan => plan.id));
  const plan = chosen.find(id => planIds.has(id)) ?? null;
  const toggle = (id: string) =>
    onChange(chosen.includes(id) ? chosen.filter(entry => entry !== id) : [...chosen, id]);
  const choosePlan = (id: string | null) =>
    onChange([...chosen.filter(entry => !planIds.has(entry)), ...(id ? [id] : [])]);

  /* Per unit, said rather than implied: two fridges need two fittings, and a
     shopper who finds that out at the total is arguing on the doorstep. */
  const words = (addon: ProductAddon) => (
    <span className="min-w-0 flex-1">
      {/* The seller's own words or the name made for them, `dir="auto"` so a
          name typed in the other language keeps its punctuation right. */}
      <span dir="auto" className="block text-sm font-bold text-[#0a285a]">{addon.label}</span>
      <span className="mt-0.5 block text-[12px] ink-muted">{t("product.addonPerUnit", { price: money(addon.price) })}</span>
    </span>
  );
  const box = (addon: ProductAddon) => (
    <li key={addon.id}>
      <label className={ROW}>
        <input type="checkbox" checked={chosen.includes(addon.id)} onChange={() => toggle(addon.id)} className="mt-0.5 size-4 shrink-0 accent-[#0a285a]" />
        {words(addon)}
        <span className="shrink-0 text-[#0a285a]" aria-hidden>
          {addon.kind === "installation" ? <Wrench className="size-4" /> : <Gift className="size-4" />}
        </span>
      </label>
    </li>
  );

  const installs = addons.filter(addon => addon.kind === "installation");
  const others = addons.filter(addon => addon.kind !== "installation" && addon.kind !== "warranty");

  return (
    <fieldset className="mt-6 rounded-[1.1rem] border border-[#d5dfeb] bg-white/70 p-4">
      <legend className="px-1 text-[12px] font-semibold ink-muted">{t("product.addons")}</legend>
      {installs.length ? <ul className="space-y-1">{installs.map(box)}</ul> : null}
      {plans.length ? (
        /* The divider is the wrapper's: on the fieldset it would meet the legend. */
        <div className={installs.length ? "mt-3 border-t border-[#e5ebf2] pt-3" : ""}>
        <fieldset>
          <legend className="flex items-center gap-2 px-2 text-sm font-bold text-[#0a285a]">
            <ShieldCheck className="size-4" aria-hidden />{t("product.warrantyPlans")}
          </legend>
          <ul className="mt-1 space-y-1">
            <li>
              <label className={ROW}>
                <input type="radio" name={group} checked={plan === null} onChange={() => choosePlan(null)} className="mt-0.5 size-4 shrink-0 accent-[#0a285a]" />
                <span className="min-w-0 flex-1 text-sm text-[#0a285a]">{t("product.noWarrantyPlan")}</span>
              </label>
            </li>
            {plans.map(addon => (
              <li key={addon.id}>
                <label className={ROW}>
                  <input type="radio" name={group} checked={plan === addon.id} onChange={() => choosePlan(addon.id)} className="mt-0.5 size-4 shrink-0 accent-[#0a285a]" />
                  {words(addon)}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        </div>
      ) : null}
      {others.length ? <ul className={`space-y-1 ${installs.length || plans.length ? "mt-3 border-t border-[#e5ebf2] pt-3" : ""}`}>{others.map(box)}</ul> : null}
    </fieldset>
  );
}
