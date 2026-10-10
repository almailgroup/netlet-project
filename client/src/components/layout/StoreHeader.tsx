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
 * the navigation — home, browse, saved, account, cart — so the top carries
 * what the bottom does not: the logo, where the order goes, and the language.
 * Search keeps a whole row, because it is how most people move through a
 * catalogue on a small screen, and once the page scrolls the top row folds
 * away and the search row is the header. A page with nothing to search keeps
 * its top row, or it would have no header at all.
 *
 * **On a wide screen the search field takes the room.** The controls beside it
 * are plain — an icon and a word, no pill of their own — so the only filled
 * button on the bar is the cart. Five shadowed pills in a row were what made
 * the bar read as busy, and they took the width the field needed. The words
 * that can go when the bar is tight go first: "Deliver to" waits for 2xl and
 * "Saved" for xl, hidden from the eye and never from the name.
 *
 * The departments row is a row of links, it marks the department the shopper
 * is in, and it folds away on scroll and comes back on hover or focus
 * (`useCompactHeader`). It ends on **Deals**, drawn by the rule that draws the
 * home page's Deals shelf (`shelvesFor`): offers had no standing place in the
 * navigation, and a link to a shelf of one or two would be the half-empty
 * shelf the home page already refuses to draw.
 *
 * **"/" goes to the search field**, as it does on most shops with a keyboard
 * to press it on — never while somebody is typing somewhere else, and never
 * past an open dialog.
 */
import { AccountMenu } from "@/components/layout/AccountMenu";
import { DeliveryZoneDialog } from "@/components/layout/DeliveryZoneDialog";
import { DepartmentIcon } from "@/components/browse/DepartmentIcon";
import { LiveSearch } from "@/components/search/LiveSearch";
import { categoryRail, shelvesFor } from "@/content/homeLayout";
import { useCart } from "@/contexts/CartContext";
import { useCustomer } from "@/contexts/CustomerContext";
import { useCompactHeader } from "@/hooks/useCompactHeader";
import { useTranslation } from "@/hooks/useTranslation";
import { logoImage } from "@/lib/brandAssets";
import { ALL_DEPARTMENTS } from "@shared/commerce/departments";
import { categorySlug } from "@shared/commerce/browse";
import type { Product } from "@shared/commerce/types";
import { trpc } from "@/lib/trpc";
import { ChevronDown, Heart, MapPin, ShoppingBag, Tag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";

/** A plain bar control: an icon and a word, a tint on hover, no fill of its own. */
const plain = "pressable flex h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-[13px] font-extrabold text-[#0a285a] transition-colors hover:bg-[#0a285a]/[.06]";

/**
 * A count on a control's shoulder, drawn only when there is something to count.
 *
 * Navy on the brand orange rather than white: white on `#f2683a` is 3.08:1 and
 * these are 10px, so 4.5:1 is the bar; navy on the same orange is 4.65:1, and
 * the badge keeps its colour.
 */
function Count({ value }: { value: number }) {
  if (!value) return null;
  return (
    <span aria-hidden className="absolute -end-2 -top-2 grid min-w-[17px] place-items-center rounded-full bg-[#f2683a] px-1 text-[10px] font-extrabold text-[#0a285a]">
      <bdi dir="ltr">{value > 99 ? "99+" : value}</bdi>
    </span>
  );
}

export function StoreHeader({ catalog = [], search = "", onSearch, onSelectProduct, activeDepartment }: {
  catalog?: Product[];
  search?: string;
  onSearch?: (query: string) => void;
  onSelectProduct?: (product: Product) => void;
  /** The department this page is in, by its query ("Electronics", "All"), so the row can mark it. */
  activeDepartment?: string | null;
}) {
  const { t, isArabic } = useTranslation();
  const [location, navigate] = useLocation();
  const query = useSearch();
  const { itemCount, openCart } = useCart();
  const { savedIds, toggleLocale, deliveryZone } = useCustomer();
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const { compact, handlers } = useCompactHeader();
  /* The home page's own read, so on Home the header asks nothing new. */
  const shelf = trpc.commerce.products.list.useQuery({ first: 24 }, { staleTime: 5 * 60 * 1000 });
  const dealsDrawn = useMemo(() => shelvesFor(shelf.data ?? []).deals.length > 0, [shelf.data]);
  const onDeals = location === "/category/all" && new URLSearchParams(query).get("offer") === "1";

  // A page with nothing to search (an invoice, the sell page) passes no handler
  // and gets the header without the field rather than a field that does nothing.
  const searchable = Boolean(onSearch && onSelectProduct);
  /* The phone's top row folds only while a search row is there to stay. */
  const phoneTopFolded = compact && searchable;
  const zoneName = deliveryZone ? (isArabic ? deliveryZone.labelAr : deliveryZone.label) : t("home.chooseAreaShort");
  /* The language a press would give you, spoken in that language. */
  const otherLanguage = isArabic ? "en" : "ar";

  useEffect(() => {
    if (!searchable) return;
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
  }, [searchable]);

  const field = searchable ? <LiveSearch catalog={catalog} value={search} onChange={onSearch!} onSelectProduct={onSelectProduct!} /> : null;

  const area = (where: "bar" | "phone") => (
    <button onClick={() => setDeliveryOpen(true)} title={t("delivery.chooseGovernorate")} className={`${plain} ${where === "phone" ? "min-w-0 px-2.5" : ""}`}>
      <MapPin className="size-[18px] shrink-0 ink-accent" aria-hidden />
      {/* "Deliver to" is in the name at every width (WCAG 2.5.3: what is said
          aloud has to match what is seen), and drawn only where it fits. */}
      {/* The trailing space keeps the name "Deliver to Hawalli" rather than one word. */}
      <span className="sr-only 2xl:not-sr-only 2xl:font-semibold 2xl:text-[#536b8c]">{t("home.deliverTo")} </span>
      <span dir="auto" className={`truncate ${where === "phone" ? "max-w-[118px]" : "max-w-[130px]"}`}>{zoneName}</span>
      {where === "phone" ? <ChevronDown className="size-3.5 shrink-0 text-[#536b8c]" aria-hidden /> : null}
    </button>
  );

  const language = (
    <button onClick={toggleLocale} title={t("header.changeLanguage")} className={plain}>
      <span lang={otherLanguage}>{t("header.language")}</span>
    </button>
  );

  return (
    <>
      <header
        {...handlers}
        data-compact={compact}
        className="sticky top-0 z-40 border-b border-[#d5dfeb] bg-background/95 backdrop-blur-xl transition-shadow duration-300 data-[compact=true]:shadow-[0_6px_20px_rgba(10,40,90,.09)]"
      >
        <a
          href="#main"
          className="glass glass-navy sr-only rounded-full px-4 py-2 text-xs font-extrabold focus:not-sr-only focus:absolute focus:start-4 focus:top-3 focus:z-50"
        >
          {t("nav.skipToContent")}
        </a>

        {/* Phone: the logo, where it goes, the language. */}
        <div
          className={`container flex items-center gap-1 overflow-hidden transition-all duration-300 ease-out lg:hidden ${phoneTopFolded ? "max-h-0 opacity-0" : "max-h-16 py-1.5 opacity-100"}`}
          aria-hidden={phoneTopFolded}
          inert={phoneTopFolded}
        >
          <Link href="/" className="me-auto flex shrink-0 items-center" aria-label={t("header.home")}>
            <img src={logoImage} alt="NetLet" loading="eager" decoding="async" className="h-8 w-auto max-w-[104px] object-contain" />
          </Link>
          {area("phone")}
          {language}
        </div>
        {field ? <div className={`container lg:hidden ${phoneTopFolded ? "py-2" : "pb-3"}`}>{field}</div> : null}

        {/* Wide: logo, a field that takes the room, then the controls. */}
        <div className={`container hidden items-center gap-4 transition-[height] duration-300 ease-out lg:flex ${compact ? "h-[62px]" : "h-[72px]"}`}>
          <Link href="/" className="flex shrink-0 items-center" aria-label={t("header.home")}>
            <img src={logoImage} alt="NetLet" loading="eager" decoding="async" className="h-10 w-auto max-w-[128px] object-contain" />
          </Link>
          {field ? <div className="min-w-0 flex-1">{field}</div> : <div className="flex-1" />}
          {/* Where it goes, then saved, language, account, cart — the order
              both old headers had settled on, kept so nothing moves for
              somebody who knew it. */}
          <div className="flex shrink-0 items-center gap-0.5">
            {area("bar")}
            <button onClick={() => navigate("/saved")} aria-label={t("header.savedItems", { count: savedIds.length })} title={t("header.savedItems", { count: savedIds.length })} className={plain}>
              <span className="relative grid shrink-0 place-items-center">
                <Heart className="size-[19px]" aria-hidden />
                <Count value={savedIds.length} />
              </span>
              <span className="hidden xl:inline">{t("nav.saved")}</span>
            </button>
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

        <nav
          aria-label={t("nav.primary")}
          aria-hidden={compact}
          inert={compact}
          className={`container hidden items-center gap-1.5 overflow-hidden transition-all duration-300 ease-out lg:flex ${compact ? "h-0 -translate-y-1 opacity-0" : "h-12 translate-y-0 opacity-100"}`}
        >
          {categoryRail.map(department => {
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
        </nav>
      </header>
      <DeliveryZoneDialog open={deliveryOpen} onClose={() => setDeliveryOpen(false)} />
    </>
  );
}
