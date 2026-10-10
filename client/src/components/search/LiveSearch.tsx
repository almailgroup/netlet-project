import { trpc } from "@/lib/trpc";
import type { Product } from "@shared/commerce/types";
import { Thumb } from "@/components/product/Thumb";
import { PhotoSearchPanel, VoiceSearchPanel } from "@/components/search/SearchModes";
import { useFeature } from "@/hooks/useFeature";
import { ArrowRight, Camera, CornerDownLeft, LoaderCircle, Mic, Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "@/hooks/useTranslation";
import { matchesSearch, searchPath } from "@shared/commerce/browse";

/**
 * What the placeholder suggests searching for, taken from the shelf.
 *
 * It used to cycle four hard-coded phrases every 2.6 seconds — "espresso
 * maker", "wireless headphones" — which was wrong twice. It named things the
 * shop may not sell, the same invention as an advert for an app that does not
 * exist; and text that rewrites itself in the corner of your eye is a moving
 * target while you are trying to read the page.
 *
 * A real product type from the live catalog says something true about this
 * shop, and stays still. With nothing to draw on, the field asks plainly
 * rather than making something up.
 */
function catalogExample(catalog: Product[]): string | null {
  for (const product of catalog) {
    const type = product.productType?.trim();
    if (type) return type.toLowerCase();
  }
  return null;
}

type LiveSearchProps = {
  catalog: Product[];
  value: string;
  onChange: (query: string) => void;
  onSelectProduct: (product: Product) => void;
};

export function LiveSearch({ catalog, value, onChange, onSelectProduct }: LiveSearchProps) {
  const { t } = useTranslation();
  const mobilePreview = import.meta.env.DEV && new URLSearchParams(window.location.search).get("searchTest") === "mobile";
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [refineMessage, setRefineMessage] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  /*
   * A spoken or photographed search lands in the field and the field takes
   * focus. The control that opened the sheet is gone by then — the field has
   * text, so clear has replaced the pair — and the sheet's own "return focus
   * to the opener" has nothing to return to, which dropped the keyboard on
   * `<body>`. The field is where the shopper's next act is anyway.
   */
  const searchFor = (query: string) => {
    applySearch(query);
    window.requestAnimationFrame(() => field.current?.focus());
  };
  const [photoOpen, setPhotoOpen] = useState(false);
  const refine = trpc.search.refine.useMutation();
  const voiceOn = useFeature("voiceSearch");
  const photoOn = useFeature("photoSearch");
  const searchTerm = value.trim().toLowerCase();
  const example = useMemo(() => catalogExample(catalog), [catalog]);

  useEffect(() => {
    if (mobilePreview && !value) {
      onChange("espresso");
      setFocused(true);
    }
  }, [mobilePreview, onChange, value]);

  const suggestions = useMemo(() => {
    /* The results page's own rule, so a suggestion is never something "See all" then leaves out. */
    const base = searchTerm ? catalog.filter(product => matchesSearch(product, searchTerm)) : catalog;
    return base.slice(0, 4);
  }, [catalog, searchTerm]);

  const applySearch = (query: string) => {
    onChange(query);
    setActiveIndex(-1);
    setRefineMessage("");
  };

  const selectSuggestion = (product: Product) => {
    applySearch(product.title);
    onSelectProduct(product);
    setFocused(false);
  };

  const [, navigate] = useLocation();

  /**
   * Enter opens the ordinary results page — the department layout, with its
   * filters and sort — for whatever is typed. It used to send the words to the
   * model instead, so the most common act on a shop's search box depended on a
   * third party being up, and when it was not the shopper got an apology and
   * no results at all.
   */
  const openResults = (query: string) => {
    const term = query.trim();
    if (!term) return;
    setFocused(false);
    field.current?.blur();
    navigate(searchPath(term));
  };

  /**
   * The model's version of the request, as an option rather than the default.
   * Whatever it says, the shopper lands on the same results page; when it is
   * down they are told so and taken to the standard results for what they
   * typed, rather than left in the dropdown with nothing.
   */
  const refineQuery = async () => {
    if (value.trim().length < 2 || refine.isPending) return;
    try {
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("searchTest") === "offline") {
        throw new Error("Development-only AI search outage simulation");
      }
      const result = await refine.mutateAsync({ query: value.trim(), catalogTitles: catalog.map(product => product.title).slice(0, 24) });
      const refined = result.query.trim() || value.trim();
      applySearch(refined);
      openResults(refined);
    } catch {
      setRefineMessage(t("header.aiUnavailable"));
    }
  };

  // Same behaviour as pressing Enter, so the button and the keyboard agree.
  const submitSearch = () => {
    if (activeIndex >= 0 && suggestions[activeIndex]) selectSuggestion(suggestions[activeIndex]);
    else openResults(value);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && suggestions.length) { event.preventDefault(); setActiveIndex(current => Math.min(current + 1, suggestions.length - 1)); }
    if (event.key === "ArrowUp" && suggestions.length) { event.preventDefault(); setActiveIndex(current => Math.max(current - 1, 0)); }
    if (event.key === "Escape") { setFocused(false); event.currentTarget.blur(); }
    if (event.key === "Enter") {
      event.preventDefault();
      submitSearch();
    }
  };

  const showPanel = focused && (value.length > 0 || catalog.length > 0);
  return (
    <div className="relative ms-auto w-full min-w-0 flex-1 lg:ms-0">
      <label className="glass-field group flex h-11 items-center rounded-full py-1 ps-5 pe-1">
        <input ref={field} value={value} onChange={(event) => applySearch(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => window.setTimeout(() => setFocused(false), 140)} onKeyDown={onKeyDown} aria-label={t("header.searchAria")} role="combobox" aria-autocomplete="list" aria-expanded={showPanel && suggestions.length > 0} aria-controls={showPanel && suggestions.length > 0 ? "netlet-search-suggestions" : undefined} className="type-body w-full min-w-0 bg-transparent px-3 outline-none placeholder:text-[#536b8c]" placeholder={example ? t("header.searchPlaceholder", { example }) : t("header.searchAria")} />
        {/*
          Voice and camera stand where the clear button stands, because the two
          are never wanted at once: you speak or point *instead* of typing, and
          the moment there is something in the field the thing you want is to
          empty it. Sharing the slot is what keeps a 292px phone field from
          holding four controls and no room to read what you typed.

          Unlike clear and submit, these two do not swallow their own mousedown.
          That trick exists so the field does not blur and take the suggestions
          with it — but a button that refuses focus is one `useOverlay` cannot
          hand focus back to, so closing the sheet dropped the keyboard on
          `<body>` and a shopper tabbing had to start from the top of the page.

          They are flat rather than filled — `.glass` discs beside the navy
          submit would make three equal buttons and no answer to which one
          searches. `size-9` rather than a 28px disc wearing `.tap-target`:
          two 44px pseudo-targets sitting 34px apart overlap, and the one that
          wins is whichever is later in the document, which is a coin toss
          nobody can see.
        */}
        {value ? (
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applySearch("")} aria-label={t("header.searchClear")} className="glass type-control grid size-7 shrink-0 place-items-center rounded-full !text-[#536b8c]"><X className="size-4" /></button>
        ) : voiceOn || photoOn ? (
          <>
            {voiceOn ? <button type="button" onClick={() => setVoiceOpen(true)} aria-label={t("search.voice")} title={t("search.voice")} className="pressable grid size-9 shrink-0 place-items-center rounded-full ink-muted hover:bg-[#e7edf5] hover:text-[#0a285a]"><Mic className="size-[18px]" /></button> : null}
            {photoOn ? <button type="button" onClick={() => setPhotoOpen(true)} aria-label={t("search.photo")} title={t("search.photo")} className="pressable grid size-9 shrink-0 place-items-center rounded-full ink-muted hover:bg-[#e7edf5] hover:text-[#0a285a]"><Camera className="size-[18px]" /></button> : null}
            {/* A hairline, so the pair reads as other ways *in* rather than as
                two more things the submit button might mean. */}
            <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-[#c9d6e6]" />
          </>
        ) : null}
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={submitSearch} aria-label={t("header.searchSubmit")} className="glass glass-navy pressable ms-1.5 grid size-9 shrink-0 place-items-center rounded-full"><Search className="size-[17px]" /></button>
      </label>
      {/*
        A solid sheet, not glass: the department rail sat behind it and read
        through the 82% white, so the suggestions shared their background with a
        row of other links. Above the header's own layers, under the overlays.
      */}
      {showPanel && (
        <div className="absolute inset-x-0 top-[calc(100%+.5rem)] z-[60] w-full overflow-hidden rounded-2xl border border-[#d5dfeb] bg-[#fffdf9] p-2 shadow-[0_18px_45px_rgba(10,40,90,.18)]">
          <div className="type-label flex items-center justify-between px-3 pb-2 pt-1 text-[#536b8c]">
            <span>{t(value ? "header.matchingCatalog" : "header.popularSearches")}</span>
          </div>
          {refineMessage && <div role="status" className="type-label mx-1 mb-2 rounded-xl bg-[#fff7e3] px-3 py-2 text-[#705523]">{refineMessage}</div>}
          {suggestions.length ? (
            <div id="netlet-search-suggestions" role="listbox" aria-label={t("header.matchingCatalog")}>
              {suggestions.map((product, index) => (
                <button key={product.id} type="button" role="option" aria-selected={activeIndex === index} onMouseDown={(event) => event.preventDefault()} onClick={() => selectSuggestion(product)} className={`type-control flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-[#0a285a] ${activeIndex === index ? "bg-[#e7edf5]" : "hover:bg-[#f3f2ed]"}`}>
                  <Thumb src={product.images[0]?.url} alt="" className="size-9 rounded-sg object-cover" icon={<Search className="size-4" />} />
                  <span className="min-w-0 flex-1"><span className="type-product block truncate text-sm">{product.title}</span><span className="type-label block truncate text-[#536b8c]">{product.productType || t("header.netletFind")}</span></span>
                  <CornerDownLeft className="size-4 ink-muted" />
                </button>
              ))}
            </div>
          ) : (
            <div className="type-body px-3 py-4 text-center text-[#536b8c]">{t("header.noMatchYet")}</div>
          )}
          {value.trim() ? (
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => openResults(value)} className="type-control mt-1 flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-start font-extrabold text-[#0a285a] hover:bg-[#f3f2ed]">
              <span className="min-w-0 truncate">{t("header.seeAllResults", { query: value.trim() })}</span>
              <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" />
            </button>
          ) : null}
          {/* Optional, and quieter than the results it sits under. */}
          {value.trim().length >= 2 && (
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void refineQuery()} disabled={refine.isPending} className="type-control mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-[#d5dfeb] bg-white px-3 py-2.5 text-[#0a285a] hover:bg-[#f3f2ed] disabled:opacity-60">
              {refine.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4 ink-accent" />}
              {t(refine.isPending ? "header.refining" : "header.refineWithAi")}
            </button>
          )}
        </div>
      )}
      <VoiceSearchPanel
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        onUse={(query) => { setVoiceOpen(false); searchFor(query); }}
      />
      {/* What the photo was read as goes into the field like anything typed,
          so the shopper sees the words and can change them. */}
      <PhotoSearchPanel
        open={photoOpen}
        onClose={() => setPhotoOpen(false)}
        onUse={(query) => { setPhotoOpen(false); searchFor(query); }}
      />
    </div>
  );
}
