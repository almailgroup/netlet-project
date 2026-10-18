/**
 * The optional extras a seller offers, as check boxes (3.1.2).
 *
 * Installation and an extended warranty are things a shopper decides about
 * *this* purchase, so they sit with the quantity and the buy button rather
 * than in a tab further down — by the time somebody has scrolled past the
 * button they have bought it without the fitting.
 *
 * **Nothing is ticked by default**, ever. A pre-ticked warranty is how a
 * shopper ends up paying for something they did not ask for and did not
 * notice, which is the one thing this feature could do that would be worse
 * than not having it.
 *
 * Absent rather than empty when the seller offers none, which is nearly every
 * product: a heading over nothing is the dead-control rule at section size.
 */
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import type { ProductAddon } from "@shared/commerce/types";
import type { MessageKey } from "@shared/i18n/dictionary";
import { ShieldCheck, Wrench } from "lucide-react";

const KIND_LABEL: Record<string, MessageKey> = {
  installation: "product.addonInstallation",
  warranty: "product.addonWarranty",
  other: "product.addonOther",
};

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
  if (addons.length === 0) return null;

  const toggle = (id: string) =>
    onChange(chosen.includes(id) ? chosen.filter(entry => entry !== id) : [...chosen, id]);

  return (
    <fieldset className="mt-6 rounded-[1.1rem] border border-[#d5dfeb] bg-white/70 p-4">
      <legend className="px-1 text-[12px] font-semibold ink-muted">
        {t("product.addons")}
      </legend>
      <ul className="space-y-1">
        {addons.map(addon => (
          <li key={addon.id}>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2 hover:bg-[#0a285a]/[.06]">
              <input
                type="checkbox"
                checked={chosen.includes(addon.id)}
                onChange={() => toggle(addon.id)}
                className="mt-0.5 size-4 shrink-0 accent-[#0a285a]"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  {/* The seller's own words, in whichever language they typed
                      them — `dir="auto"` so the punctuation lands right. */}
                  <span dir="auto" className="text-sm font-bold text-[#0a285a]">{addon.label}</span>
                  <span className="type-label ink-muted">{t(KIND_LABEL[addon.kind] ?? "product.addonOther")}</span>
                </span>
                {/* Per unit, said rather than implied: two fridges need two
                    fittings, and a shopper who finds that out at the total is
                    a shopper arguing on the doorstep. */}
                <span className="mt-0.5 block text-[12px] ink-muted">
                  {t("product.addonPerUnit", { price: money(addon.price) })}
                </span>
              </span>
              <span className="shrink-0 text-[#0a285a]" aria-hidden>
                {addon.kind === "warranty" ? <ShieldCheck className="size-4" /> : <Wrench className="size-4" />}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
