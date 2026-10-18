/**
 * Area, block, street, avenue, house, floor, apartment and PACI number — the
 * boxes an address is asked for in, drawn by the address book, the delivery
 * dialog and checkout alike so the three cannot ask different things
 * (`Shared/commerce/kuwaitAddress.ts` is the rule).
 *
 * The area list is the governorate's, in the page's language; with no
 * governorate chosen it is every area, and choosing one chooses its
 * governorate too, since that is what prices delivery. An area that is not on
 * the list is "Another area", typed. Block, floor and the PACI number take
 * Arabic-Indic digits as readily as Latin ones; they are folded on save.
 */
import { Select } from "@/components/ui/Select";
import { useTranslation } from "@/hooks/useTranslation";
import { AREAS, PART_MAX, REQUIRED_PARTS, governorateOfArea, type AddressParts, type PartKey } from "@shared/commerce/kuwaitAddress";
import type { MessageKey } from "@shared/i18n/dictionary";
import { useId, useState } from "react";

const OTHER = "__other__";

const LABEL: Record<Exclude<PartKey, "area">, MessageKey> = {
  block: "address.block",
  street: "address.street",
  avenue: "address.avenue",
  building: "address.building",
  floor: "address.floor",
  apartment: "address.apartment",
  paciNumber: "address.paci",
};

export function AddressPartsFields({
  parts,
  governorate,
  onChange,
  onGovernorate,
  fieldClass,
  labelClass,
  idPrefix,
}: {
  parts: AddressParts;
  governorate: string | null | undefined;
  onChange: (parts: AddressParts) => void;
  /** Called with an area's governorate when one is chosen and none was. */
  onGovernorate?: (governorate: string) => void;
  fieldClass: string;
  labelClass: string;
  idPrefix?: string;
}) {
  const { t, isArabic } = useTranslation();
  const generated = useId();
  const id = (key: string) => `${idPrefix ?? generated}-${key}`;
  const zone = governorate?.trim() || null;
  const listed = (zone ? AREAS[zone] ?? [] : Object.values(AREAS).flat())
    .slice()
    .sort((left, right) => (isArabic ? left.ar.localeCompare(right.ar, "ar") : left.en.localeCompare(right.en)));
  const area = parts.area?.trim() ?? "";
  const onList = Boolean(area) && listed.some(entry => entry.en === area);
  /* Typed rather than chosen: an area off the list, or "Another area" pressed. */
  const [typing, setTyping] = useState(Boolean(area) && !onList);
  const set = (key: PartKey, value: string) => onChange({ ...parts, [key]: value });
  const required = (key: PartKey) => REQUIRED_PARTS.includes(key);

  const box = (key: Exclude<PartKey, "area">, options: { digits?: boolean; wide?: boolean } = {}) => (
    <label htmlFor={id(key)} className={`${labelClass} ${options.wide ? "sm:col-span-2" : ""}`}>
      {t(LABEL[key])}
      <input
        id={id(key)}
        value={parts[key] ?? ""}
        maxLength={PART_MAX[key]}
        onChange={event => set(key, event.target.value)}
        inputMode={options.digits ? "numeric" : undefined}
        dir={options.digits ? "ltr" : "auto"}
        aria-required={required(key) || undefined}
        aria-describedby={key === "paciNumber" ? id("paci-hint") : undefined}
        className={`${fieldClass} mt-1 font-normal`}
      />
      {key === "paciNumber" ? <span id={id("paci-hint")} className="mt-1 block text-[12px] font-normal ink-muted">{t("address.paciHint")}</span> : null}
    </label>
  );

  return (
    <>
      <div className={`${labelClass} sm:col-span-2`}>
        <span aria-hidden>{t("address.area")}</span>
        <Select
          id={id("area")}
          aria-label={t("address.area")}
          value={typing ? OTHER : onList ? area : ""}
          onChange={event => {
            const value = event.target.value;
            if (value === OTHER) {
              setTyping(true);
              onChange({ ...parts, area: onList ? "" : area });
              return;
            }
            setTyping(false);
            onChange({ ...parts, area: value });
            const owner = governorateOfArea(value);
            if (owner && !zone) onGovernorate?.(owner);
          }}
          className={`${fieldClass} mt-1 font-normal`}
        >
          <option value="" disabled>{t("address.areaChoose")}</option>
          {listed.map(entry => <option key={entry.en} value={entry.en}>{isArabic ? entry.ar : entry.en}</option>)}
          <option value={OTHER}>{t("address.areaOther")}</option>
        </Select>
        {typing ? (
          <input
            aria-label={t("address.areaTyped")}
            placeholder={t("address.areaTyped")}
            value={area}
            maxLength={PART_MAX.area}
            dir="auto"
            onChange={event => set("area", event.target.value)}
            className={`${fieldClass} mt-2 font-normal`}
          />
        ) : null}
      </div>
      {box("block", { digits: true })}
      {box("street")}
      {box("avenue")}
      {box("building")}
      {box("floor", { digits: true })}
      {box("apartment")}
      {box("paciNumber", { digits: true, wide: true })}
    </>
  );
}
