import { trpc } from "@/lib/trpc";
import type { Product } from "@shared/commerce/types";
import { Thumb } from "@/components/product/Thumb";
import { useFeature } from "@/hooks/useFeature";
import { ArrowRight, Camera, Clock, CornerDownLeft, LoaderCircle, Mic, Search, Sparkles, Store, Tag, X } from "lucide-react";
import { lazy, Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { EMPTY_FILTERS, searchPath, searchWithTerm } from "@shared/commerce/browse";
import { brandsMatching, departmentsMatching, highlightParts } from "@shared/commerce/search";
import { ALL_DEPARTMENTS, DEPARTMENTS, type Department } from "@shared/commerce/departments";
import { useDepartmentsInStock } from "@/hooks/useDepartmentsInStock";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { appPath } from "@/lib/basePath";
import { categoryMessageKey, categoryRail } from "@/content/homeLayout";
import { DepartmentIcon } from "@/components/browse/DepartmentIcon";
import { categorySlug } from "@shared/commerce/browse";
import { clearRecentSearches, readRecentSearches, rememberSearch } from "@/lib/recentSearches";
import type { MessageKey } from "@shared/i18n/dictionary";
import { Select } from "@/components/ui/Select";

/*
 * The voice and photo sheets are fetched when a shop has switched them on, or
 * when one is opened for review — not in the bundle every shopper downloads
 * first. Both switches start off, so for most visitors they never load.
 */
const VoiceSearchPanel = lazy(() => import("@/components/search/SearchModes").then(module => ({ default: module.VoiceSearchPanel })));
const PhotoSearchPanel = lazy(() => import("@/components/search/SearchModes").then(module => ({ default: module.PhotoSearchPanel })));
const reviewingSearchModes = () => /^(voice|photo)-/.test(new URLSearchParams(window.location.search).get("searchTest") ?? "");

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
 *
 * **In the page's language.** A product type is what the seller typed, so the
 * Arabic field read "ابحث عن electronics". A type that is one of NetLet's
 * departments takes the department's own name in either language; any other
 * type is the seller's word, which suits the English page and suits the
 * Arabic one only if the seller wrote it in Arabic.
 */
const ARABIC_LETTERS = /[\u0600-\u06FF]/;

export function catalogExample(catalog: Product[], translate: (key: MessageKey) => string, arabic: boolean): string | null {
  for (const product of catalog) {
    const type = product.productType?.trim();
    if (!type) continue;
    const department = categoryMessageKey(type);
    if (department) return arabic ? translate(department) : translate(department).toLowerCase();
    if (!arabic) return type.toLowerCase();
    if (ARABIC_LETTERS.test(type)) return type;
  }
  return null;
}

type LiveSearchProps = {
  catalog: Product[];
  value: string;
  onChange: (query: string) => void;
  onSelectProduct: (product: Product) => void;
  /** The department the page is in, which the field starts out searching. */
  department?: string | null;
  /** Whether the home page draws a Deals shelf — the rule every link to deals keeps. */
  dealsDrawn?: boolean;
};

/** Whether this browser can listen at all. Firefox and the iOS app's WebView cannot. */
const canListen = () => typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

/** One thing the dropdown offers: a recent search, a department, a brand, or a product. */
type Entry =
  | { kind: "recent"; key: string; term: string }
  | { kind: "department"; key: string; department: Department }
  | { kind: "brand"; key: string; brand: string }
  | { kind: "product"; key: string; product: Product };

/** How long typing must pause before the server is asked: one request per word, not per letter. */
const SETTLE_MS = 120;
/** How many products the dropdown shows; the results page has the rest. */
const SUGGESTED_PRODUCTS = 5;

export function LiveSearch({ catalog, value, onChange, onSelectProduct, department = null, dealsDrawn = false }: LiveSearchProps) {
  const { t, isArabic, locale } = useTranslation();
  const money = useMoney();
  const uid = useId();
  const listboxId = `${uid}-suggestions`;
  const optionId = (index: number) => `${uid}-option-${index}`;
  /*
   * Where to search: everywhere, or one department. On a department page it
   * starts as that department, the way a shop's own search box does — somebody
   * on Electronics who types "charger" means a phone charger. Changing page
   * changes it back.
   */
  const [scope, setScope] = useState(department ?? ALL_DEPARTMENTS.query);
  useEffect(() => setScope(department ?? ALL_DEPARTMENTS.query), [department]);
  const scoped = scope !== ALL_DEPARTMENTS.query;
  const mobilePreview = import.meta.env.DEV && new URLSearchParams(window.location.search).get("searchTest") === "mobile";
  /* Focus and the panel are two things: Escape closes the panel and leaves the
     keyboard in the field, where the next thing somebody does is type. */
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [refineMessage, setRefineMessage] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const inStock = useDepartmentsInStock();
  const counts = trpc.commerce.departmentCounts.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const wide = useMediaQuery("(min-width: 1024px)");
  /* Read again on every focus, so the phone field and the wide one agree. */
  const [recent, setRecent] = useState<string[]>(() => readRecentSearches());
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
  /*
   * Each other way in is offered only where it works. The microphone needs a
   * browser that can listen; the camera needs a model to read the photo, which
   * the server reports, so a shop with no key never shows a camera that can
   * only say "nothing is looking yet".
   */
  const voiceOn = useFeature("voiceSearch") && canListen();
  const photoSwitch = useFeature("photoSearch");
  const photoReady = trpc.search.photoAvailable.useQuery(undefined, { enabled: photoSwitch, staleTime: 10 * 60 * 1000, retry: false });
  const photoOn = photoSwitch && photoReady.data?.available === true;
  const typed = value.trim();
  const example = useMemo(() => catalogExample(catalog, t, isArabic), [catalog, t, isArabic]);

  useEffect(() => {
    if (mobilePreview && !value) {
      onChange("espresso");
      setFocused(true);
      setOpen(true);
    }
  }, [mobilePreview, onChange, value]);

  /*
   * The products come from the server, over the whole catalogue
   * (`server/productSearch.ts`), ranked by the rules the results page uses — so
   * a suggestion is never something "See all" then leaves out, and the shelf
   * past the first page can be found from here. It was the 24 newest products,
   * searched in the browser. Asked once typing pauses; the last answer stays
   * on screen while the next arrives, so the list does not blink per letter.
   */
  const [settled, setSettled] = useState(typed);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(typed), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [typed]);
  const answer = trpc.search.products.useQuery(
    { q: settled, department: scoped ? scope : null, locale, limit: SUGGESTED_PRODUCTS },
    { enabled: open && settled.length > 0, placeholderData: previous => previous, staleTime: 60_000, retry: false },
  );
  const brands = trpc.commerce.brands.useQuery(undefined, { enabled: open, staleTime: 10 * 60 * 1000 });

  /*
   * With nothing typed, the choices are what this device searched for lately.
   * With something typed: a department it names (in either language, and only
   * one with something on sale), a brand the shop sells, then the products. One
   * list for the arrow keys either way.
   */
  const emptyField = !typed;
  const entries = useMemo<Entry[]>(() => {
    if (emptyField) return recent.map(term => ({ kind: "recent" as const, key: `recent:${term}`, term }));
    const departments = scoped ? [] : departmentsMatching(typed).filter(entry => inStock(entry.name)).slice(0, 2);
    const brandNames = brandsMatching(typed, (brands.data ?? []).map(brand => brand.name)).slice(0, 2);
    const products = settled ? answer.data?.products ?? [] : [];
    return [
      ...departments.map(entry => ({ kind: "department" as const, key: `department:${entry.slug}`, department: entry })),
      ...brandNames.map(brand => ({ kind: "brand" as const, key: `brand:${brand}`, brand })),
      ...products.map(product => ({ kind: "product" as const, key: `product:${product.id}`, product })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emptyField, recent, typed, scoped, brands.data, settled, answer.data]);
  const waiting = !emptyField && (settled !== typed || (answer.isFetching && !answer.data));
  const total = answer.data?.total ?? 0;
  useEffect(() => setActiveIndex(-1), [entries.length, emptyField]);

  const applySearch = (query: string) => {
    onChange(query);
    setActiveIndex(-1);
    setRefineMessage("");
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setActiveIndex(-1);
  };

  const [, navigate] = useLocation();

  const selectSuggestion = (product: Product) => {
    if (typed) setRecent(rememberSearch(typed));
    applySearch(product.title);
    onSelectProduct(product);
    close();
  };

  const goTo = (path: string) => {
    if (typed) setRecent(rememberSearch(typed));
    close();
    field.current?.blur();
    navigate(path);
  };

  const activate = (entry: Entry) => {
    if (entry.kind === "recent") openRecent(entry.term);
    else if (entry.kind === "product") selectSuggestion(entry.product);
    else if (entry.kind === "department") goTo(`/category/${entry.department.slug}`);
    else goTo(`/category/all?brand=${encodeURIComponent(entry.brand)}`);
  };

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
    setRecent(rememberSearch(term));
    close();
    field.current?.blur();
    /* A department search is that department's page with the words on it. */
    navigate(scoped ? `/category/${categorySlug(scope)}${searchWithTerm(EMPTY_FILTERS, term)}` : searchPath(term));
  };

  /**
   * The model's version of the request, as an option rather than the default.
   * Whatever it says, the shopper lands on the same results page; when it is
   * down they are told so and taken to the standard results for what they
   * typed, rather than left in the dropdown with nothing.
   */
  const refineQuery = async () => {
    if (typed.length < 2 || refine.isPending) return;
    try {
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("searchTest") === "offline") {
        throw new Error("Development-only AI search outage simulation");
      }
      const result = await refine.mutateAsync({ query: typed, catalogTitles: catalog.map(product => product.title).slice(0, 24) });
      const refined = result.query.trim() || typed;
      applySearch(refined);
      openResults(refined);
    } catch {
      setRefineMessage(t("header.aiUnavailable"));
    }
  };

  // Same behaviour as pressing Enter, so the button and the keyboard agree.
  const submitSearch = () => {
    const entry = open && activeIndex >= 0 ? entries[activeIndex] : undefined;
    if (entry) activate(entry);
    else openResults(value);
  };

  /* A recent search runs again exactly as it was typed. */
  const openRecent = (term: string) => {
    onChange(term);
    openResults(term);
  };

  /*
   * The panel stays open while focus is anywhere inside the search — the field,
   * a recent search, "Clear", a department — so a keyboard can Tab into it. It
   * closed on the field's own blur, which made everything below the
   * suggestions reachable by mouse alone.
   */
  const leave = (event: React.FocusEvent) => {
    if (box.current?.contains(event.relatedTarget as Node | null)) return;
    window.setTimeout(() => { setFocused(false); close(); }, 140);
  };

  /*
   * The WAI-ARIA combobox: focus stays in the field and the highlighted option
   * is named to a screen reader through `aria-activedescendant` — before, the
   * arrows moved a highlight nobody using one could hear. Escape closes the
   * list and keeps the field focused (it used to drop the keyboard on
   * `<body>`); a second Escape empties the field.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      if (entries.length) setActiveIndex(current => (current + 1) % entries.length);
    }
    if (event.key === "ArrowUp" && entries.length) {
      event.preventDefault();
      setActiveIndex(current => (current <= 0 ? entries.length - 1 : current - 1));
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (open) close();
      else if (value) applySearch("");
    }
    if (event.key === "Enter") {
      event.preventDefault();
      submitSearch();
    }
  };

  const optionClass = (index: number) =>
    `type-control flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-[#0a285a] ${activeIndex === index ? "bg-[#0a285a]/[.06]" : "hover:bg-[#0a285a]/[.06]"}`;
  const departmentLabel = (product: Product) => {
    const key = product.productType ? categoryMessageKey(product.productType) : null;
    return key ? t(key) : product.productType;
  };
  const priceOf = (product: Product) => {
    const { min, max } = product.priceRange;
    return Number(min.amount) < Number(max.amount) ? t("browse.priceFrom", { min: money(min) }) : money(min);
  };

  /* The departments are always there to offer, so an open field always has a panel. */
  const showPanel = open;
  const listed = showPanel && entries.length > 0;

  /*
   * On a phone the panel is a sheet the width of the screen, hung from the foot
   * of the header, with the page dimmed under it. It was a card floating 8px
   * below the field, a few pixels narrower than the screen on either side, over
   * whatever the page had there — on the home page the dark hero, which made a
   * busy frame of photograph round a small cream box. The sheet's top is the
   * header's bottom, measured, because the header is 123px tall at the top of
   * the page and 65px once its logo row has gone; measured again as the page or
   * the screen moves. **Its height is what the keyboard leaves**, from the
   * visual viewport: a phone's keyboard covers the layout viewport without
   * shrinking it, so a sheet sized to the screen put its last rows behind the
   * keys — and putting the keyboard away blurs the field, which closes the
   * sheet, so those rows could not be reached at all. Sized to what shows, the
   * sheet scrolls instead.
   */
  const [sheetTop, setSheetTop] = useState(0);
  const [sheetRoom, setSheetRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!showPanel || wide) return;
    const place = () => {
      const edge = box.current?.closest("header") ?? box.current;
      if (!edge) return;
      const top = Math.max(0, Math.round(edge.getBoundingClientRect().bottom));
      const view = window.visualViewport;
      const shown = view ? view.offsetTop + view.height : window.innerHeight;
      setSheetTop(top);
      setSheetRoom(Math.max(160, Math.round(shown - top)));
    };
    place();
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [showPanel, wide]);

  /* Leaving the search by a press on a link or the dimmed page: the keyboard goes too. */
  const dismiss = () => { close(); field.current?.blur(); };

  /*
   * The departments, as pictures: the home page's own art, so a department
   * looks the same in the search as on the shelf. Only those with something on
   * sale — the navigation's rule — and "All departments" last, where somebody
   * who did not find theirs looks next.
   */
  const tiles = [
    ...DEPARTMENTS.filter(entry => inStock(entry.name)).map(entry => ({ slug: entry.slug, query: entry.name, label: entry.label, counted: true })),
    { slug: "all", query: ALL_DEPARTMENTS.query, label: ALL_DEPARTMENTS.label, counted: false },
  ];
  const countLine = (slug: string, counted: boolean) => {
    if (!counted) return t("browse.browseEverything");
    if (!counts.data) return "";
    const count = counts.data[slug] ?? 0;
    return count === 0 ? t("browse.countNone") : count === 1 ? t("browse.countOne") : t("browse.countMany", { count });
  };
  /* The other ways in a shopper reaches for, each only while it leads somewhere. */
  const shortcuts: { key: string; href: string; label: MessageKey; icon: typeof Tag }[] = [
    ...(dealsDrawn ? [{ key: "deals", href: "/category/all?offer=1", label: "home.heroDeals" as MessageKey, icon: Tag }] : []),
    { key: "new", href: "/category/all?sort=newest", label: "footer.newArrivals", icon: Sparkles },
    { key: "stores", href: "/stores", label: "stores.title", icon: Store },
  ];
  return (
    <div ref={box} className="relative ms-auto w-full min-w-0 flex-1 lg:ms-0">
      {/*
        A box rather than a <label>: a label takes the first control inside it as
        the one it names, and with the department picker first that was the
        picker — a click anywhere in the field opened a dropdown. Pressing the
        box's own padding still lands in the text.
      */}
      <div
        onMouseDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); field.current?.focus(); } }}
        className="glass-field group flex h-11 cursor-text items-center rounded-full py-1 ps-2 pe-1 lg:h-12"
      >
        {/*
          Where to look. Hidden on a phone, where the field is the width of the
          screen and the words need it; the department pages have their own
          search there.
        */}
        {/*
          The picker is as wide as what it says: the shop's own dropdown sizes
          its button to the choice, where a native <select> was as wide as its
          longest option and had to be laid, transparent, over a drawn label.
        */}
        <span className="hidden shrink-0 sm:flex">
          <Select
            value={scope}
            onChange={(event) => { setScope(event.target.value); setActiveIndex(-1); field.current?.focus(); }}
            onBlur={leave}
            aria-label={t("search.scope")}
            title={t("search.scope")}
            className="h-8 max-w-[180px] rounded-full border-e border-[#d5dfeb] px-3 text-[13px] font-semibold text-[#0a285a] hover:bg-[#0a285a]/[.06]"
          >
            {categoryRail.map(entry => (
              <option key={entry.query} value={entry.query}>{entry.query === ALL_DEPARTMENTS.query ? t("search.scopeAll") : t(entry.key)}</option>
            ))}
          </Select>
        </span>
        <input
          ref={field}
          value={value}
          onChange={(event) => applySearch(event.target.value)}
          onFocus={() => { setFocused(true); setOpen(true); setRecent(readRecentSearches()); }}
          onClick={() => setOpen(true)}
          onBlur={leave}
          onKeyDown={onKeyDown}
          aria-label={t("header.searchAria")}
          aria-keyshortcuts="/"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={listed}
          aria-controls={listed ? listboxId : undefined}
          aria-activedescendant={listed && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          enterKeyHint="search"
          className="type-body w-full min-w-0 bg-transparent px-3 outline-none placeholder:text-[#536b8c]"
          placeholder={scoped ? t("search.placeholderIn", { department: t(categoryMessageKey(scope) ?? ALL_DEPARTMENTS.label) }) : example ? t("header.searchPlaceholder", { example }) : t("header.searchAria")}
        />
        {/* The shortcut, said where it applies. Only on a wide screen, which is
            where there is a keyboard to press it on. */}
        {!value && !focused ? <kbd aria-hidden className="me-2 hidden h-6 min-w-6 shrink-0 place-items-center rounded-md border border-[#d5dfeb] px-1.5 font-sans text-[12px] font-semibold text-[#536b8c] lg:grid">/</kbd> : null}
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
        ) : null}
        {/* On a phone they give their place to clear once something is typed;
            a wide field has room for both. */}
        {voiceOn || photoOn ? (
          <span className={`${value ? "hidden lg:flex" : "flex"} shrink-0 items-center`}>
            {voiceOn ? <button type="button" onClick={() => setVoiceOpen(true)} aria-label={t("search.voice")} title={t("search.voice")} className="pressable grid size-9 shrink-0 place-items-center rounded-full ink-muted hover:bg-[#0a285a]/[.06] hover:text-[#0a285a]"><Mic className="size-[18px]" /></button> : null}
            {photoOn ? <button type="button" onClick={() => setPhotoOpen(true)} aria-label={t("search.photo")} title={t("search.photo")} className="pressable grid size-9 shrink-0 place-items-center rounded-full ink-muted hover:bg-[#0a285a]/[.06] hover:text-[#0a285a]"><Camera className="size-[18px]" /></button> : null}
            {/* A hairline, so the pair reads as other ways *in* rather than as
                two more things the submit button might mean. */}
            <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-[#c9d6e6]" />
          </span>
        ) : null}
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={submitSearch} aria-label={t("header.searchSubmit")} className="glass glass-navy pressable ms-1.5 grid size-9 shrink-0 place-items-center rounded-full lg:size-10"><Search className="size-[17px]" /></button>
      </div>
      {/*
        A solid sheet, not glass: the department rail sat behind it and read
        through the 82% white, so the suggestions shared their background with a
        row of other links. Above the header's own layers, under the overlays.
      */}
      {/* What the list holds, said to a screen reader once typing settles — the
          list itself is silent until somebody arrows into it. */}
      <p role="status" className="sr-only">
        {showPanel && !emptyField && !waiting
          ? entries.length === 1 ? t("search.suggestionOne") : entries.length ? t("search.suggestionCount", { count: entries.length }) : t("search.noSuggestions")
          : ""}
      </p>
      {showPanel && (
        <>
        {/* The page under a phone's sheet, dimmed; a press on it puts the search away. */}
        {!wide ? (
          <div aria-hidden onClick={dismiss} style={{ top: sheetTop }} className="fixed inset-x-0 bottom-0 z-[59] touch-none bg-[#0a285a]/30" />
        ) : null}
        {/*
          Liquid glass, on the owner's word — the header's own recipe
          (`.glass-bar-surface` in index.css: a blur that saturates what passes
          under it, warped under a fine pointer, beneath a white tint with a
          bright rim), with a tint of its own (`.glass-panel`, 70%) because
          this sheet carries headings straight on the glass. The layers sit in
          a frame round the scroller rather than inside it, or they would
          scroll away with the content. Everything with words in it — a chip,
          a tile, a shortcut, the results — is a plate of white over the
          glass, which is what keeps the muted ink at 4.5:1 over the darkest
          thing that can pass beneath (the navy Deals band, dimmed).
        */}
        <div
          onBlur={leave}
          style={wide ? undefined : { top: sheetTop }}
          className={`glass-panel ${wide
            ? "absolute inset-x-0 top-[calc(100%+.5rem)] z-[60] w-full rounded-2xl border border-white/70 shadow-[0_18px_45px_rgba(10,40,90,.2)]"
            : "fixed inset-x-0 z-[60] rounded-b-3xl border-b border-white/70 shadow-[0_24px_48px_rgba(10,40,90,.3)]"}`}
        >
          <span aria-hidden className="glass-bar-surface glass-bar-round">
            <span className="glass-bar-bend" />
            <span className="glass-bar-face" />
          </span>
          <div
            style={wide ? undefined : { maxHeight: sheetRoom ? `${sheetRoom}px` : `calc(100dvh - ${sheetTop}px)` }}
            className={wide ? "max-h-[min(36rem,calc(100dvh-9rem))] overflow-y-auto overscroll-contain p-3" : "overflow-y-auto overscroll-contain px-4 pb-5 pt-3"}
          >
          {emptyField ? (
            <>
              {recent.length ? (
                <section className="mb-4">
                  <div className="flex items-center justify-between gap-3 pb-2">
                    <h2 className="text-[14px] font-bold text-[#0a285a]">{t("header.recentSearches")}</h2>
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => { clearRecentSearches(); setRecent([]); setActiveIndex(-1); }}
                      aria-label={t("header.clearRecentAria")}
                      className="tap-target tint-on-hover rounded-full bg-white/80 px-3 py-1 text-[13px] font-bold ink-accent"
                    >
                      {t("header.clearRecent")}
                    </button>
                  </div>
                  {/* Chips rather than rows: six searches in two lines, not six lines. */}
                  <div id={listboxId} role="listbox" aria-label={t("header.recentSearches")} className="flex flex-wrap gap-2">
                    {entries.map((entry, index) => entry.kind === "recent" ? (
                      <button
                        key={entry.key}
                        id={optionId(index)}
                        type="button"
                        role="option"
                        aria-selected={activeIndex === index}
                        tabIndex={-1}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => activate(entry)}
                        className={`tint-on-hover flex min-h-10 max-w-full items-center gap-1.5 rounded-full border px-3 text-[14px] font-medium text-[#0a285a] shadow-[0_1px_2px_rgba(10,40,90,.06)] ${activeIndex === index ? "border-[#0a285a]/40 bg-white" : "border-white/80 bg-white/80"}`}
                      >
                        <Clock className="size-4 shrink-0 text-[#536b8c]" aria-hidden />
                        <span dir="auto" className="min-w-0 truncate">{entry.term}</span>
                      </button>
                    ) : null)}
                  </div>
                </section>
              ) : null}
              <section>
                <h2 className="pb-2 text-[14px] font-bold text-[#0a285a]">{t("header.shopByDepartment")}</h2>
                <ul className="grid grid-cols-3 gap-2 lg:grid-cols-6">
                  {tiles.map(tile => (
                    <li key={tile.slug} className="min-w-0">
                      <Link
                        href={`/category/${categorySlug(tile.query)}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={dismiss}
                        className="tint-on-hover flex h-full flex-col items-center rounded-2xl border border-white/80 bg-white/80 px-1.5 pb-2.5 pt-2 text-center shadow-[0_1px_2px_rgba(10,40,90,.06)]"
                      >
                        <img src={appPath(`/departments/${tile.slug}.webp`)} alt="" loading="lazy" decoding="async" width={480} height={360} className="aspect-[4/3] w-full object-contain" />
                        <span className="mt-1.5 line-clamp-2 text-[13px] font-bold leading-tight text-[#0a285a]">{t(tile.label)}</span>
                        {/* One line on every tile, so the row keeps one height while the counts arrive. */}
                        <span className="mt-0.5 h-4 truncate text-[12px] leading-4 ink-muted">{countLine(tile.slug, tile.counted)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
              <nav aria-label={t("header.searchShortcuts")} className={`mt-4 grid gap-2 border-t border-[#0a285a]/10 pt-4 ${shortcuts.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
                {shortcuts.map(({ key, href, label, icon: Icon }) => (
                  <Link
                    key={key}
                    href={href}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={dismiss}
                    className="tint-on-hover flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl border border-white/80 bg-white/80 px-2 py-2 text-center text-[13px] font-bold leading-tight text-[#0a285a] shadow-[0_1px_2px_rgba(10,40,90,.06)] lg:min-h-11 lg:flex-row lg:gap-2"
                  >
                    <Icon className="size-[18px] shrink-0 ink-accent" aria-hidden />
                    {t(label)}
                  </Link>
                ))}
              </nav>
            </>
          ) : (
            <>
              {refineMessage && <div role="status" className="type-label mx-1 mb-2 rounded-xl bg-[#fff7e3] px-3 py-2 text-[#705523]">{refineMessage}</div>}
              {/* The results are one white plate on the glass: their muted lines need it. */}
              <div className="rounded-2xl border border-white/80 bg-white/90 p-1 shadow-[0_1px_2px_rgba(10,40,90,.06)]">
              {/* The words as typed found nothing and the catalogue's own spelling did: said, never silently swapped. */}
              {answer.data?.correctedTo && !waiting ? (
                <p className="type-label px-3 pb-1 pt-1 text-[#536b8c]">{t("search.showingFor", { term: answer.data.correctedTo })}</p>
              ) : null}
              {entries.length ? (
                <div id={listboxId} role="listbox" aria-label={t("header.matchingCatalog")} aria-busy={waiting || undefined}>
                  {entries.map((entry, index) => {
                    if (entry.kind === "department") {
                      return (
                        <button key={entry.key} id={optionId(index)} type="button" role="option" aria-selected={activeIndex === index} tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => activate(entry)} className={optionClass(index)}>
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#eef1f5]"><DepartmentIcon query={entry.department.name} className="size-4 text-[#0a285a]" /></span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{t(entry.department.label)}</span><span className="type-label block truncate text-[#536b8c]">{t("search.kindDepartment")}</span></span>
                          <ArrowRight className="size-4 shrink-0 ink-muted rtl:-scale-x-100" aria-hidden />
                        </button>
                      );
                    }
                    if (entry.kind === "brand") {
                      return (
                        <button key={entry.key} id={optionId(index)} type="button" role="option" aria-selected={activeIndex === index} tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => activate(entry)} className={optionClass(index)}>
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#eef1f5]"><Tag className="size-4 text-[#0a285a]" aria-hidden /></span>
                          <span className="min-w-0 flex-1"><bdi dir="auto" className="block truncate text-sm font-bold">{entry.brand}</bdi><span className="type-label block truncate text-[#536b8c]">{t("search.kindBrand")}</span></span>
                          <ArrowRight className="size-4 shrink-0 ink-muted rtl:-scale-x-100" aria-hidden />
                        </button>
                      );
                    }
                    if (entry.kind !== "product") return null;
                    const product = entry.product;
                    const department = departmentLabel(product);
                    return (
                      <button key={entry.key} id={optionId(index)} type="button" role="option" aria-selected={activeIndex === index} tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => activate(entry)} className={optionClass(index)}>
                        <Thumb src={product.images[0]?.url} alt="" className="size-9 rounded-sg object-cover" icon={<Search className="size-4" />} />
                        <span className="min-w-0 flex-1">
                          {/* The words searched for in bold, matched as the search matches them. */}
                          {/* Not `.type-product`: its 18px bold, forced, left nothing for the match to be bolder than. */}
                          <span dir="auto" className="block truncate text-[14px] font-medium leading-5 text-[#0a285a]">
                            {highlightParts(product.title, answer.data?.correctedTo ?? settled).map((part, partIndex) => (
                              part.hit ? <strong key={partIndex} className="font-extrabold">{part.text}</strong> : <span key={partIndex}>{part.text}</span>
                            ))}
                          </span>
                          <span className="type-label block truncate text-[#536b8c]">
                            {department ? <>{department} · </> : null}
                            <span className="font-bold text-[#0a285a]">{priceOf(product)}</span>
                          </span>
                        </span>
                        <CornerDownLeft className="size-4 shrink-0 ink-muted rtl:-scale-x-100" aria-hidden />
                      </button>
                    );
                  })}
                </div>
              ) : waiting ? (
                <div aria-hidden className="space-y-1 px-1 py-1">
                  {[0, 1, 2].map(row => (
                    <div key={row} className="flex items-center gap-3 rounded-xl px-2 py-2">
                      <span className="size-9 shrink-0 animate-pulse rounded-lg bg-[#eef1f5]" />
                      <span className="h-3 flex-1 animate-pulse rounded bg-[#eef1f5]" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="type-body px-3 py-4 text-center text-[#536b8c]">{t("header.noMatchYet")}</div>
              )}
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => openResults(value)} className="type-control mt-1 flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-start font-extrabold text-[#0a285a] hover:bg-[#0a285a]/[.06]">
                <span className="min-w-0 truncate">
                  {total > SUGGESTED_PRODUCTS && !waiting
                    ? scoped
                      ? t("header.seeAllCountIn", { count: total, query: typed, department: t(categoryMessageKey(scope) ?? ALL_DEPARTMENTS.label) })
                      : t("header.seeAllCount", { count: total, query: typed })
                    : scoped
                      ? t("header.seeAllResultsIn", { query: typed, department: t(categoryMessageKey(scope) ?? ALL_DEPARTMENTS.label) })
                      : t("header.seeAllResults", { query: typed })}
                </span>
                <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" />
              </button>
              </div>
              {/* Optional, and quieter than the results it sits under. */}
              {typed.length >= 2 && (
                <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void refineQuery()} disabled={refine.isPending} className="type-control tint-on-hover mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-white/80 bg-white/80 px-3 py-2.5 text-[#0a285a] shadow-[0_1px_2px_rgba(10,40,90,.06)] disabled:opacity-60">
                  {refine.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4 ink-accent" />}
                  {t(refine.isPending ? "header.refining" : "header.refineWithAi")}
                </button>
              )}
            </>
          )}
          </div>
        </div>
        </>
      )}
      {voiceOn || photoOn || voiceOpen || photoOpen || reviewingSearchModes() ? (
        <Suspense fallback={null}>
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
        </Suspense>
      ) : null}
    </div>
  );
}
