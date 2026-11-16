/**
 * New or refurbished — which shop a product goes on, on the owner's word
 * ("add that option for the admin and the vendor to add products that are
 * refurbished … make sure that the option is there for adding a product").
 * Two radios, each saying what it means for a shopper, so nobody files a
 * used phone among the new ones without reading where it will be shown.
 * The new-product form holds the choice until Create; the editor saves it as
 * it changes (`inventory.products.setCondition`), one decision on the trail.
 */
import { PackageCheck, Recycle } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import type { ProductCondition } from "@shared/commerce/condition";

export function ConditionChoice({ value, onChange, disabled = false, name = "product-condition", hideLegend = false }: {
  value: ProductCondition;
  onChange: (value: ProductCondition) => void;
  disabled?: boolean;
  name?: string;
  /** Where a card's own title already names it on screen; a screen reader still hears it. */
  hideLegend?: boolean;
}) {
  const { t } = useTranslation();
  const options = [
    { value: "new" as const, label: t("refurbished.conditionNew"), hint: t("refurbished.conditionNewHint"), Icon: PackageCheck },
    { value: "refurbished" as const, label: t("refurbished.conditionRefurbished"), hint: t("refurbished.conditionRefurbishedHint"), Icon: Recycle },
  ];
  return (
    <fieldset className="grid gap-2.5 sm:grid-cols-2" disabled={disabled}>
      <legend className={hideLegend ? "sr-only" : "mb-1.5 text-[13px] font-semibold text-[#0a285a]"}>{t("refurbished.conditionLabel")}</legend>
      {options.map(option => {
        const chosen = value === option.value;
        return (
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#f2683a] ${
              chosen ? "border-[#0a285a] bg-[#eef2f8] hover:bg-[#0a285a]/[.06]" : "border-[#e1e7ef] bg-white hover:bg-[#f0f2f5]"
            }`}
          >
            <input type="radio" name={name} value={option.value} checked={chosen} onChange={() => onChange(option.value)} className="mt-1 accent-[#0a285a]" />
            <option.Icon className="mt-0.5 size-4 shrink-0 text-[#0a285a]" aria-hidden />
            <span className="min-w-0">
              <span className="block text-[14px] font-bold text-[#0a285a]">{option.label}</span>
              <span className="mt-0.5 block text-[12px] leading-5 ink-muted">{option.hint}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
