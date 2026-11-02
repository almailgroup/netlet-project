/**
 * The filter sidebar.
 *
 * Every group here is derived from the products actually on the page — see
 * `facetsFor` — so the controls describe this catalog rather than an assumed
 * one. A group with nothing to offer is not rendered at all: an empty "Brand"
 * heading is worse than no heading.
 *
 * The same component is the desktop rail and the contents of the mobile sheet.
 * One list of filters, one set of behaviours, rendered in two frames — and,
 * with `only`, one group of it: what a chip in the phone's row opens. Which
 * groups there are is `filterGroups`, so a chip never names a group the
 * sheet does not draw.
 */
import { FilterCheckbox, FilterGroup, CollapsibleList } from "./FilterGroup";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { categorySlug, filterGroups, type BrowseFilters, type Facets, type FacetValue, type FilterGroupKey } from "@shared/commerce/browse";
import { categoryMessageKey } from "@/content/homeLayout";
import type { DeliverySpeed } from "@shared/commerce/deliverySpeed";
import type { MessageKey } from "@shared/i18n/dictionary";
import { useEffect, useState, type ReactNode } from "react";

export function FilterSidebar({ facets, filters, currency, onChange, onSelectCategory, only }: {
  facets: Facets;
  filters: BrowseFilters;
  currency: string;
  onChange: (patch: Partial<BrowseFilters>) => void;
  onSelectCategory: (category: string) => void;
  /** One group alone, without its heading — the sheet a chip opens is named for it. */
  only?: FilterGroupKey;
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

  /** One checkbox list of plain values. */
  const valueList = (values: FacetValue[], selected: string[], set: (next: string[]) => void, label: (value: string) => string = value => value) => (
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
  );

  /* An offer row is drawn when it can narrow, or is ticked — the groups' own rule. */
  const narrows = (count: number) => count > 0 && count < facets.total;

  const priceField = "type-body h-9 w-full min-w-0 rounded-lg border border-[#d5dfeb] bg-white px-2.5 text-[13px] text-[#0a285a] outline-none focus:border-[#f2683a]";

  /* Each group's controls, by its key; the sidebar heads each with its name,
     a chip's sheet is named for the one it draws. */
  const section = (key: FilterGroupKey): { title: string; body: ReactNode; defaultOpen?: boolean } | null => {
    switch (key) {
      case "category":
        return {
          title: t("browse.category"),
          body: (
            <CollapsibleList moreLabel={count => t("browse.showAll", { count })} fewerLabel={t("browse.showFewer")}>
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
          ),
        };
      case "offers":
        return {
          title: t("browse.offers"),
          body: (
            <>
              {narrows(facets.inStock) || filters.inStock ? (
                <FilterCheckbox label={t("browse.inStock")} count={facets.inStock} checked={filters.inStock} onChange={inStock => onChange({ inStock })} />
              ) : null}
              {narrows(facets.onOffer) || filters.onOffer ? (
                <FilterCheckbox label={t("browse.onOffer")} count={facets.onOffer} checked={filters.onOffer} onChange={onOffer => onChange({ onOffer })} />
              ) : null}
              {narrows(facets.express) || filters.express ? (
                <FilterCheckbox label={t("browse.expressOnly")} count={facets.express} checked={filters.express} onChange={express => onChange({ express })} />
              ) : null}
            </>
          ),
        };
      case "brand":
        return { title: t("browse.brand"), body: valueList(facets.brands, filters.brands, brands => onChange({ brands })) };
      case "seller":
        return { title: t("browse.seller"), body: valueList(facets.sellers, filters.sellers, sellers => onChange({ sellers })) };
      case "speed":
        return {
          title: t("browse.deliverySpeed"),
          body: valueList(facets.speeds, filters.speeds, speeds => onChange({ speeds: speeds as DeliverySpeed[] }), value => t(`speed.${value}` as MessageKey)),
        };
      case "price":
        return {
          title: t("browse.price"),
          body: (
            <>
              {facets.priceBounds ? (
                <p className="mb-2.5 text-[12px] ink-muted">
                  {t("browse.priceRange", {
                    min: money({ amount: String(facets.priceBounds.min), currencyCode: currency }),
                    max: money({ amount: String(facets.priceBounds.max), currencyCode: currency }),
                  })}
                </p>
              ) : null}
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
            </>
          ),
        };
      case "rating":
        return {
          title: t("browse.rating"),
          body: (
            <>
              {facets.ratings.map(rating => (
                <FilterCheckbox
                  key={rating.value}
                  label={t("browse.ratingAndUp", { stars: rating.value })}
                  count={rating.count}
                  checked={filters.minRating === Number(rating.value)}
                  onChange={checked => onChange({ minRating: checked ? Number(rating.value) : null })}
                />
              ))}
            </>
          ),
        };
      default: {
        /* Merchant-configured product options — Colour, Size, Ram Size — which
           is where a catalog's genuinely specific filters come from. */
        const name = key.slice("option:".length);
        const values = facets.options.find(option => option.name === name)?.values ?? [];
        const selected = filters.options[name] ?? [];
        const shown = values.length ? values : selected.map(value => ({ value, count: 0 }));
        return {
          title: name,
          defaultOpen: false,
          body: valueList(shown, selected, next => onChange({ options: { ...filters.options, [name]: next } })),
        };
      }
    }
  };

  const groups = filterGroups(facets, filters).map(group => group.key);
  if (only) {
    const one = groups.includes(only) ? section(only) : null;
    return one ? <div className="py-3 text-[#0a285a]">{one.body}</div> : null;
  }
  /* The rail keeps its own order: the department first, as a search's
     results are most often narrowed by it, then what is in each product. */
  const RAIL: FilterGroupKey[] = ["category", "offers", "brand", "seller", "speed", "price", "rating"];
  const ordered = [...RAIL.filter(key => groups.includes(key)), ...groups.filter(key => key.startsWith("option:"))];
  return (
    <div className="text-[#0a285a]">
      {ordered.map(key => {
        const one = section(key);
        return one ? <FilterGroup key={key} title={one.title} defaultOpen={one.defaultOpen}>{one.body}</FilterGroup> : null;
      })}
    </div>
  );
}

/** Exported for the page's canonical link. */
export { categorySlug };
