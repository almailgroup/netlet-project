/**
 * The header, on every shopping page.
 *
 * There used to be two. Home's was taller, labelled its controls, carried the
 * delivery area and a row of departments; every other page wore a shorter one
 * with four unlabelled circles, no area and no departments. A shopper leaving
 * the home page watched the departments vanish and the controls lose their
 * names, and the area — which decides what delivery costs — could only be seen
 * or changed from one page, and never on a phone. Two copies had also drifted
 * apart more than once. This is the one copy now, and Home wears it too.
 * Checkout keeps its bare header — every exit on a payment page is an
 * invitation to take it.
 *
 * **On a phone the top bar does not repeat the bottom one.** The bottom bar is
 * the navigation — home, profile, cart, categories — so the top carries what
 * the bottom does not: the logo, centred and larger, and the language at its
 * end, on the owner's word. The delivery area left the phone's bar at the same
 * time, also on the owner's word; checkout and the account's preferences still
 * set it, and a wide screen keeps its button. Search keeps a whole row, because it is how most people move through
 * a catalogue on a small screen, and it is the row that stays: the top row
 * scrolls away with the page like anything else.
 *
 * **Nothing here moves on its own.** The bar used to collapse on scroll and
 * expand on hover, animating heights while a scroll listener and a settle
 * timer kept the two from feeding each other; it is a white bar of fixed
 * height now, `position: sticky` and nothing else. What is not pinned — the
 * phone's top row, the departments row — simply scrolls, which needs no
 * script, cannot oscillate, and never shifts the page under a reader. No blur
 * either: a solid white bar costs nothing to scroll under.
 *
 * **On a wide screen the search field takes the room.** The controls beside it
 * are plain — an icon and a word, no pill of their own — so the only filled
 * button on the bar is the cart. Five shadowed pills in a row were what made
 * the bar read as busy, and they took the width the field needed. The words
 * that can go when the bar is tight go first: "Deliver to" waits for 2xl and
 * "Saved" for xl, hidden from the eye and never from the name.
 *
 * The departments row is a row of links, it marks the department the shopper
 * is in, and it scrolls away under the pinned bar. It ends on **Deals**, drawn by the rule that draws the
 * home page's Deals shelf (`shelvesFor`): offers had no standing place in the
 * navigation, and a link to a shelf of one or two would be the half-empty
 * shelf the home page already refuses to draw.
 *
 * **"/" goes to the search field**, as it does on most shops with a keyboard
 * to press it on — never while somebody is typing somewhere else, and never
 * past an open dialog.
 */
import { useCatalog } from "@/hooks/useCatalog";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { useAuth } from "@/hooks/useAuth";
import { useLastAddressId } from "@/hooks/useLastAddressId";
import { useDepartmentsInStock } from "@/hooks/useDepartmentsInStock";
import { addressInUse } from "@/lib/lastAddress";
import { DepartmentIcon } from "@/components/browse/DepartmentIcon";
import { LiveSearch } from "@/components/search/LiveSearch";
import { PixelBadge } from "@/components/ui/PixelBadge";
import { categoryRail, shelvesFor } from "@/content/homeLayout";
import { useCart } from "@/contexts/CartContext";
import { useCustomer } from "@/contexts/CustomerContext";
import { useTranslation } from "@/hooks/useTranslation";
import { logoImage } from "@/lib/brandAssets";
import { ALL_DEPARTMENTS } from "@shared/commerce/departments";
import { categorySlug, searchTermFrom } from "@shared/commerce/browse";
import type { Product } from "@shared/commerce/types";
import { trpc } from "@/lib/trpc";
import { Heart, MapPin, ShoppingBag, Tag } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { whenIdle } from "@/lib/idle";
import { Link, useLocation, useSearch } from "wouter";

/*
 * The address book, with its form and its map picker, loads when the delivery
 * button is first pressed. It was in the first download of every page for a
 * dialog most visits never open — the sign-in dialog's reason for being lazy.
 * It is fetched once the page is idle, so the first press still opens it at
 * once; the bytes come after the first paint rather than before it.
 */
const loadDeliveryDialog = () => import("@/components/layout/DeliveryZoneDialog");
const DeliveryZoneDialog = lazy(() => loadDeliveryDialog().then(module => ({ default: module.DeliveryZoneDialog })));

/** A plain bar control: an icon and a word, a tint on hover, no fill of its own. */
const plain = "pressable flex h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-[13px] font-extrabold text-[#0a285a] transition-colors hover:bg-[#0a285a]/[.06]";

/**
 * A count on a control's shoulder, drawn only when there is something to
 * count — the shop's pixel badge (`PixelBadge`), which hops when it changes.
 */
function Count({ value }: { value: number }) {
  return <PixelBadge value={value} className="absolute -end-2.5 -top-2.5" />;
}

export function StoreHeader({ activeDepartment }: {
  /** The department this page is in, by its query ("Electronics", "All"), so the row can mark it. */
  activeDepartment?: string | null;
}) {
  const { t, isArabic } = useTranslation();
  const [location, navigate] = useLocation();
  const query = useSearch();
  const { itemCount, openCart } = useCart();
  const { savedIds, toggleLocale, deliveryZone } = useCustomer();
  /* The logo is the way home, and on the home page the way back to its top: a
     link to the page already open would push a second copy of it into the
     history and move nothing. The page's own `scroll-behavior` decides how —
     smooth, or a cut for somebody who asked for less motion. Any other page
     moves home, and a new page starts at its top (`ScrollMemory`). */
  const toTopOnHome = (event: MouseEvent<HTMLAnchorElement>) => {
    if (location !== "/" || query) return;
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: "auto" });
  };
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  /* Only where the bar draws the delivery button: a phone has none to open. */
  useEffect(() => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    return whenIdle(() => void loadDeliveryDialog());
  }, []);
  const inStock = useDepartmentsInStock();
  /* The home page's own read, so on Home the header asks nothing new. */
  const shelf = useCatalog(24, { staleTime: 5 * 60 * 1000 });
  const dealsDrawn = useMemo(() => shelvesFor(shelf.data ?? []).deals.length > 0, [shelf.data]);
  const onDeals = location === "/category/all" && new URLSearchParams(query).get("offer") === "1";

  /*
   * The field keeps its own words. It is drawn once for the whole shop now
   * (`StorefrontShell`) and stays while pages change under it, so it starts
   * each page from what the address searched for — the term on a results or
   * department page, nothing anywhere else — exactly as a fresh header did
   * when every page drew its own. Typing changes no address, so nothing here
   * resets the field under somebody's fingers.
   */
  const [search, setSearch] = useState(() => searchTermFrom(query));
  useEffect(() => { setSearch(searchTermFrom(query)); }, [location, query]);
  const selectProduct = (product: Product) => navigate(`/products/${encodeURIComponent(product.handle)}`);
  const zoneName = deliveryZone ? (isArabic ? deliveryZone.labelAr : deliveryZone.label) : t("home.chooseAreaShort");
  /*
   * The address being delivered to, by the name the shopper gave it — "Home"
   * says more than "Hawalli" to the person who lives there. Only while it is
   * in the area in use (`addressInUse`): an area with no saved address in it
   * is named as itself.
   */
  const { isAuthenticated } = useAuth();
  const book = trpc.customer.addresses.list.useQuery(undefined, { enabled: isAuthenticated, staleTime: 5 * 60 * 1000 });
  const lastAddressId = useLastAddressId();
  const deliveringTo = isAuthenticated ? addressInUse(book.data ?? [], lastAddressId, deliveryZone?.id) : null;
  const areaName = deliveringTo ? deliveringTo.label : zoneName;
  /* The language a press would give you, spoken in that language. */
  const otherLanguage = isArabic ? "en" : "ar";

  /*
   * Whether the header is stuck over the page, for its bottom edge. A marker
   * sits just above it; once the marker has scrolled out of view, the header is
   * pinned and content is passing underneath. The attribute is set on the
   * element directly, so scrolling never re-renders the header.
   */
  const headerRef = useRef<HTMLElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const marker = markerRef.current;
    const header = headerRef.current;
    if (!marker || !header || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) header.removeAttribute("data-stuck");
      else header.setAttribute("data-stuck", "");
    });
    observer.observe(marker);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const toSearch = (event: KeyboardEvent) => {
      /* The key, or the key in its place on an Arabic layout, where it types a letter. */
      if ((event.key !== "/" && event.code !== "Slash") || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector("[aria-modal=true]")) return;
      const input = [...document.querySelectorAll<HTMLInputElement>("header input[role=combobox]")].find(candidate => candidate.offsetParent !== null);
      if (!input) return;
      event.preventDefault();
      input.focus();
    };
    window.addEventListener("keydown", toSearch);
    return () => window.removeEventListener("keydown", toSearch);
  }, []);

  const field = <LiveSearch catalog={shelf.data ?? []} value={search} onChange={setSearch} onSelectProduct={selectProduct} department={activeDepartment} />;

  const area = (
    <button onClick={() => setDeliveryOpen(true)} title={deliveringTo ? `${t("delivery.buttonTitle")}: ${deliveringTo.label}, ${zoneName}` : t("delivery.buttonTitle")} className={plain}>
      <MapPin className="size-[18px] shrink-0 ink-accent" aria-hidden />
      {/* "Deliver to" is in the name and not drawn: the pin and the area say it,
          and the width it took is the search field's now. The name still
          starts with what is seen (WCAG 2.5.3), and the trailing space keeps
          it "Deliver to Hawalli" rather than one word. */}
      <span className="sr-only">{t("home.deliverTo")} </span>
      <span dir="auto" className="max-w-[130px] truncate">{areaName}</span>
    </button>
  );

  const language = (
    <button onClick={toggleLocale} title={t("header.changeLanguage")} className={plain}>
      <span lang={otherLanguage}>{t("header.language")}</span>
    </button>
  );

  /* Phone: the logo in the middle and the language at the end — one fixed
     height, because the bar's sticky offset is exactly this row (`-top-16`).
     Three columns, the outer two of one width, so the logo sits on the
     screen's centre line whatever the language button's word is. */
  const phoneTop = (
    <div className="container grid h-16 grid-cols-[1fr_auto_1fr] items-center lg:hidden">
      <span aria-hidden />
      <Link href="/" onClick={toTopOnHome} className="flex items-center rounded-xl px-1" aria-label={t("header.home")}>
        <img src={logoImage} alt="NetLet" loading="eager" decoding="async" className="h-12 w-auto max-w-[150px] object-contain" />
      </Link>
      <div className="flex justify-end">{language}</div>
    </div>
  );

  return (
    <>
      <a
        href="#main"
        className="glass glass-navy sr-only rounded-full px-4 py-2 text-xs font-extrabold focus:not-sr-only focus:fixed focus:start-4 focus:top-3 focus:z-50"
      >
        {t("nav.skipToContent")}
      </a>
      {/*
        No line under the bar on a wide screen: the department row sits right
        below it, and a rule between the two cut one header into two strips.
        The edge comes back only once the page is moving underneath
        (`.header-edge`, drawn while the header is stuck). A phone keeps its
        line, because nothing sits below the search row there.
      */}
      <div ref={markerRef} aria-hidden className="pointer-events-none -mb-px h-px" />
      {/*
        On a phone the logo row is inside the header — it is the header's,
        and outside every landmark a screen reader's map of the page lost it —
        and the header sticks sixteen units *above* the top of the screen,
        so that row scrolls away and the search row stays. One sticky element
        rather than a row before it, which is the same picture with no
        stranded content.
      */}
      <header ref={headerRef} className="sticky-header glass-bar sticky -top-16 z-40 border-b border-[#0a285a]/[.08] lg:top-0 lg:border-b-0">
        {/* The bar's liquid glass, behind everything in it (`.glass-bar` in
            index.css). Layers inside the header rather than a filter on the
            header itself: a `backdrop-filter` there would make the bar the
            containing block for every fixed overlay drawn inside it. */}
        <span aria-hidden className="glass-bar-surface">
          <span className="glass-bar-bend" />
          <span className="glass-bar-face" />
        </span>
        <svg aria-hidden focusable="false" className="pointer-events-none absolute size-0 overflow-hidden">
          <filter id="netlet-glass" x="0" y="0" width="100%" height="100%" filterUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.003 0.007" numOctaves={1} seed={7} result="turbulence" />
            <feDisplacementMap in="SourceGraphic" in2="turbulence" scale={70} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
        {phoneTop}
        <div className="container pb-2.5 pt-1 lg:hidden">{field}</div>

        {/* Wide: logo, a field that takes the room, then the controls. */}
        <div className="container hidden h-[76px] items-center gap-5 lg:flex">
          <Link href="/" onClick={toTopOnHome} className="flex shrink-0 items-center" aria-label={t("header.home")}>
            <img src={logoImage} alt="NetLet" loading="eager" decoding="async" className="h-12 w-auto max-w-[156px] object-contain" />
          </Link>
          <div className="min-w-0 flex-1">{field}</div>
          {/* Where it goes, then saved, language, account, cart — the order
              both old headers had settled on, kept so nothing moves for
              somebody who knew it. */}
          <div className="flex shrink-0 items-center gap-0.5">
            {area}
            {/* A link, because it goes to a page: it opens in a new tab, and a
                pointer resting on it starts fetching the page. */}
            <Link href="/saved" aria-current={location === "/saved" ? "page" : undefined} aria-label={t("header.savedItems", { count: savedIds.length })} title={t("header.savedItems", { count: savedIds.length })} className={plain}>
              <span className="relative grid shrink-0 place-items-center">
                <Heart className="size-[19px]" aria-hidden />
                <Count value={savedIds.length} />
              </span>
              <span className="hidden xl:inline">{t("nav.saved")}</span>
            </Link>
            {language}
            <AccountMenu />
            <button
              onClick={openCart}
              aria-label={itemCount ? t("header.cartWithCount", { count: itemCount }) : t("nav.cart")}
              title={t("header.openCart")}
              className="glass glass-navy pressable ms-1 flex h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-[13px] font-extrabold"
            >
              <span className="relative grid shrink-0 place-items-center">
                <ShoppingBag className="size-[19px]" aria-hidden />
                <Count value={itemCount} />
              </span>
              {t("nav.cart")}
            </button>
          </div>
        </div>
        <div aria-hidden className="header-edge pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[#e6e9ef]" />
      </header>
      {/* The bar's tint without its blur: nothing passes under this row while
          it is on screen, so it only has to match the glass at rest. */}
      <nav aria-label={t("nav.primary")} className="glass-bar-row hidden border-b border-[#e6e9ef] lg:block">
        <div className="container flex h-12 items-center gap-1.5">
          {categoryRail.filter(department => inStock(department.query) || activeDepartment === department.query).map(department => {
            const current = !onDeals && activeDepartment === department.query;
            const lead = department.query === ALL_DEPARTMENTS.query;
            return (
              <Link
                key={department.query}
                href={`/category/${categorySlug(department.query)}`}
                aria-current={current ? "page" : undefined}
                className={`pressable flex items-center gap-1.5 rounded-full px-3 py-2 text-xs transition-colors ${current ? "glass glass-navy font-bold" : `${lead ? "font-bold text-[#0a285a]" : "font-semibold text-[#536b8c]"} hover:bg-[#0a285a]/[.06] hover:text-[#0a285a]`}`}
              >
                <DepartmentIcon query={department.query} className="size-3.5 shrink-0" />
                {t(department.key)}
              </Link>
            );
          })}
          {dealsDrawn ? (
            <Link
              href="/category/all?offer=1"
              aria-current={onDeals ? "page" : undefined}
              className={`pressable ms-auto flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-extrabold transition-colors ${onDeals ? "glass glass-navy" : "ink-accent hover:bg-[#0a285a]/[.06]"}`}
            >
              <Tag className="size-3.5 shrink-0" aria-hidden />
              {t("rail.deals.title")}
            </Link>
          ) : null}
        </div>
      </nav>
      {deliveryOpen ? <Suspense fallback={null}><DeliveryZoneDialog open onClose={() => setDeliveryOpen(false)} /></Suspense> : null}
    </>
  );
}
