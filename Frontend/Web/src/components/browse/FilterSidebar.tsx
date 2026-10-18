/**
 * The filter sidebar.
 *
 * Every group here is derived from the products actually on the page — see
 * `facetsFor` — so the controls describe this catalog rather than an assumed
 * one. A group with nothing to offer is not rendered at all: an empty "Brand"
 * heading is worse than no heading.
 *
 * The same component is the desktop rail and the contents of the mobile sheet.
 * One list of filters, one set of behaviours, rendered in two frames.
 */
import { FilterCheckbox, FilterGroup, CollapsibleList } from "./FilterGroup";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { categorySlug, facetNarrows, type BrowseFilters, type Facets, type FacetValue } from "@shared/commerce/browse";
import { categoryMessageKey } from "@/content/homeLayout";
import type { DeliverySpeed } from "@shared/commerce/deliverySpeed";
import type { MessageKey } from "@shared/i18n/dictionary";
import { useEffect, useState } from "react";

export function FilterSidebar({ facets, filters, currency, onChange, onSelectCategory }: {
  facets: Facets;
  filters: BrowseFilters;
  currency: string;
  onChange: (patch: Partial<BrowseFilters>) => void;
  onSelectCategory: (category: string) => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();

  // Price is typed, so it is held locally until it is applied — re-filtering on
  // every keystroke would fight the shopper as they type "1" of "150".
  const [minDraft, setMinDraft] = useState("");
  const [maxDraft, setMaxDraft] = useState("");
  useEffect(() => {
    setMinDraft(filters.minPrice === null ? "" : String(filters.minPrice));
    setMaxDraft(filters.maxPrice === null ? "" : String(filters.maxPrice));
  }, [filters.minPrice, filters.maxPrice]);

  const applyPrice = () => {
    const parse = (raw: string) => {
      const value = Number(raw);
      return raw.trim() === "" || !Number.isFinite(value) || value < 0 ? null : value;
    };
    const min = parse(minDraft);
    const max = parse(maxDraft);
    // A reversed range returns nothing and reads as a bug, so it is swapped
    // rather than obeyed.
    onChange(min !== null && max !== null && min > max ? { minPrice: max, maxPrice: min } : { minPrice: min, maxPrice: max });
  };

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter(entry => entry !== value) : [...list, value];

  /* A department NetLet knows is named as the header names it — "Home & kitchen",
     in the page's language — and a merchant's own type as they typed it. The
     filter read "Home & Kitchen" from the catalogue beside a header that said
     "Home & kitchen". */
  const departmentLabel = (value: string) => {
    const key = categoryMessageKey(value);
    return key ? t(key) : value;
  };

  /** One checkbox group of plain values, drawn only when ticking one would change something. */
  const valueGroup = (title: string, values: FacetValue[], selected: string[], set: (next: string[]) => void, label: (value: string) => string = value => value) =>
    facetNarrows(values, facets.total) ? (
      <FilterGroup title={title}>
        <CollapsibleList moreLabel={count => t("browse.showAll", { count })} fewerLabel={t("browse.showFewer")}>
          {values.map(entry => (
            <FilterCheckbox
              key={entry.value}
              label={label(entry.value)}
              count={entry.count}
              checked={selected.includes(entry.value)}
              onChange={() => set(toggle(selected, entry.value))}
            />
          ))}
        </CollapsibleList>
      </FilterGroup>
    ) : null;

  const priceField = "type-body h-9 w-full min-w-0 rounded-lg border border-[#d5dfeb] bg-white px-2.5 text-[13px] text-[#0a285a] outline-none focus:border-[#f2683a]";

  return (
    <div className="text-[#0a285a]">
      {facets.categories.length > 1 ? (
        <FilterGroup title={t("browse.category")}>
          <CollapsibleList
            moreLabel={count => t("browse.showAll", { count })}
            fewerLabel={t("browse.showFewer")}
          >
            {facets.categories.map(category => (
              <FilterCheckbox
                key={category.value}
                label={departmentLabel(category.value)}
                count={category.count}
                checked={filters.category === category.value}
                onChange={checked => onSelectCategory(checked ? category.value : "all")}
              />
            ))}
          </CollapsibleList>
        </FilterGroup>
      ) : null}

      {/* Drawn only with something in it: an empty department showed an
          "Offers and delivery" heading over nothing. */}
      {facets.inStock > 0 || facets.onOffer > 0 || facets.express > 0 ? (
      <FilterGroup title={t("browse.offers")}>
        {facets.inStock > 0 ? (
          <FilterCheckbox label={t("browse.inStock")} count={facets.inStock} checked={filters.inStock} onChange={inStock => onChange({ inStock })} />
        ) : null}
        {facets.onOffer > 0 ? (
          <FilterCheckbox label={t("browse.onOffer")} count={facets.onOffer} checked={filters.onOffer} onChange={onOffer => onChange({ onOffer })} />
        ) : null}
        {facets.express > 0 ? (
          <FilterCheckbox label={t("browse.expressOnly")} count={facets.express} checked={filters.express} onChange={express => onChange({ express })} />
        ) : null}
      </FilterGroup>
      ) : null}

      {valueGroup(t("browse.brand"), facets.brands, filters.brands, brands => onChange({ brands }))}
      {valueGroup(t("browse.seller"), facets.sellers, filters.sellers, sellers => onChange({ sellers }))}
      {valueGroup(
        t("browse.deliverySpeed"),
        facets.speeds,
        filters.speeds,
        speeds => onChange({ speeds: speeds as DeliverySpeed[] }),
        value => t(`speed.${value}` as MessageKey),
      )}

      {facets.priceBounds ? (
        <FilterGroup title={t("browse.price")}>
          <p className="mb-2.5 text-[12px] ink-muted">
            {t("browse.priceRange", {
              min: money({ amount: String(facets.priceBounds.min), currencyCode: currency }),
              max: money({ amount: String(facets.priceBounds.max), currencyCode: currency }),
            })}
          </p>
          <div className="flex items-center gap-2">
            <input
              inputMode="decimal"
              dir="ltr"
              value={minDraft}
              onChange={event => setMinDraft(event.target.value)}
              onKeyDown={event => { if (event.key === "Enter") applyPrice(); }}
              aria-label={t("browse.priceMin")}
              placeholder={t("browse.priceMin")}
              className={priceField}
            />
            <span className="ink-muted">–</span>
            <input
              inputMode="decimal"
              dir="ltr"
              value={maxDraft}
              onChange={event => setMaxDraft(event.target.value)}
              onKeyDown={event => { if (event.key === "Enter") applyPrice(); }}
              aria-label={t("browse.priceMax")}
              placeholder={t("browse.priceMax")}
              className={priceField}
            />
          </div>
          <button
            type="button"
            onClick={applyPrice}
            className="glass pressable mt-2.5 h-9 w-full rounded-lg border border-[#0a285a]/15 text-[12px] font-bold text-[#0a285a]"
          >
            {t("browse.priceApply")}
          </button>
        </FilterGroup>
      ) : null}

      {facets.ratings.length ? (
        <FilterGroup title={t("browse.rating")}>
          {facets.ratings.map(rating => (
            <FilterCheckbox
              key={rating.value}
              label={t("browse.ratingAndUp", { stars: rating.value })}
              count={rating.count}
              checked={filters.minRating === Number(rating.value)}
              onChange={checked => onChange({ minRating: checked ? Number(rating.value) : null })}
            />
          ))}
        </FilterGroup>
      ) : null}

      {/* Merchant-configured product options — Colour, Size, Ram Size — which
          is where a catalog's genuinely specific filters come from. */}
      {facets.options.map(option => (
        <FilterGroup key={option.name} title={option.name} defaultOpen={false}>
          <CollapsibleList
            moreLabel={count => t("browse.showAll", { count })}
            fewerLabel={t("browse.showFewer")}
          >
            {option.values.map(value => (
              <FilterCheckbox
                key={`${option.name}-${value.value}`}
                label={value.value}
                count={value.count}
                checked={(filters.options[option.name] ?? []).includes(value.value)}
                onChange={() => onChange({
                  options: { ...filters.options, [option.name]: toggle(filters.options[option.name] ?? [], value.value) },
                })}
              />
            ))}
          </CollapsibleList>
        </FilterGroup>
      ))}
    </div>
  );
}

/** Exported for the page's canonical link. */
export { categorySlug };
