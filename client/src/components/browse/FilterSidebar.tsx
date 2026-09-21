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
import { categorySlug, type BrowseFilters, type Facets } from "@shared/commerce/browse";
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
                label={category.value}
                count={category.count}
                checked={filters.category === category.value}
                onChange={checked => onSelectCategory(checked ? category.value : "all")}
              />
            ))}
          </CollapsibleList>
        </FilterGroup>
      ) : null}

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

      {facets.brands.length > 1 ? (
        <FilterGroup title={t("browse.brand")}>
          <CollapsibleList
            moreLabel={count => t("browse.showAll", { count })}
            fewerLabel={t("browse.showFewer")}
          >
            {facets.brands.map(brand => (
              <FilterCheckbox
                key={brand.value}
                label={brand.value}
                count={brand.count}
                checked={filters.brands.includes(brand.value)}
                onChange={() => onChange({ brands: toggle(filters.brands, brand.value) })}
              />
            ))}
          </CollapsibleList>
        </FilterGroup>
      ) : null}

      {facets.priceBounds ? (
        <FilterGroup title={t("browse.price")}>
          <p className="mb-2.5 text-[11px] ink-muted">
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
