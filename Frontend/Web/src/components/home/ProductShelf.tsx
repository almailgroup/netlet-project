/**
 * The home page's shelves: a heading with its way to everything else, a
 * strip of cards scrolled sideways or a grid to browse, the navy band for
 * the deepest savings — and over most of them a row of department tabs, on
 * the owner's word ("category tabs at the top, similar to Noon, allowing
 * customers to switch between categories without leaving the section. Apply
 * the same concept to other relevant sections").
 *
 * **A tab narrows the shelf and is not a tab.** The row is `aria-pressed`
 * buttons in a named group, the portal's `Segmented` rule and the department
 * page's subcategory chips: it narrows a list, so it is not a WAI-ARIA
 * tablist with panels. "All" leads and is the shelf as decided; a department
 * is on the row only with two or more of the shelf in it (`departmentTabs`),
 * and no row is drawn when it could change nothing. The choice is the
 * shelf's own, kept while the page is open and never in the address — it is
 * a glance, not a view anybody sends. A ranked shelf renumbers inside the
 * tab, so the places read "first among the electronics".
 */
import { ChevronRight } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ProductCard } from "@/components/product/ProductCard";
import { ScrollArrows } from "@/components/ui/ScrollArrows";
import { departmentTabs, MAX_SHELF_PRODUCTS, type DepartmentTab, type OccasionShelf } from "@/content/homeLayout";
import { occasionName } from "@shared/commerce/occasionDesk";
import { useSideScroll } from "@/hooks/useSideScroll";
import { useTranslation } from "@/hooks/useTranslation";
import type { Product } from "@shared/commerce/types";
import type { MessageKey } from "@shared/i18n/dictionary";

/** The page is where "View all" for a deals shelf lands: the Deals page, deepest first. */
export const DEALS_PATH = "/category/all?offer=1&sort=discount";

/** What every card on the page is handed: the hearts, and the one preview. */
export type ShelfCardProps = {
  saved: string[];
  onSave: (id: string, title: string) => void;
  onQuickView: (product: Product) => void;
};

export function CatalogSkeleton() {
  return <div className="hide-scrollbar mt-4 flex gap-3 overflow-hidden">{[0, 1, 2, 3].map((item) => <div key={item} className="min-w-[164px] animate-pulse rounded-2xl border border-[#e6e9ef] bg-white p-3 sm:min-w-[195px] lg:min-w-0 lg:flex-1"><div className="aspect-square rounded-xl bg-[#eef1f5]" /><div className="mt-4 h-4 w-2/3 rounded bg-[#eef1f5]" /><div className="mt-2 h-3 w-1/3 rounded bg-[#eef1f5]" /></div>)}</div>;
}

/**
 * A shelf's title and its way to everything else. A plain heading and a "View
 * all" link: the shelves used to carry a display-face headline, a sentence of
 * description under it and an uppercase pill, which is three ways of saying
 * the title.
 */
export function ShelfHeading({ id, title, onViewAll, children }: { id: string; title: string; onViewAll?: () => void; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 id={`${id}-title`} className="text-xl font-extrabold tracking-[-.01em] text-[#0a285a] sm:text-2xl">{title}</h2>
      <div className="flex items-center gap-2">
        {children}
        {onViewAll ? (
          <button onClick={onViewAll} className="pressable -me-2 inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-bold ink-accent hover:underline">
            {t("home.viewAll")}<ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The row of departments over a shelf: "All", then each department with
 * enough of the shelf in it, the chosen one navy. The department page's
 * subcategory chips, in the same clothes.
 */
function DepartmentTabRow({ title, total, tabs, chosen, onChoose }: { title: string; total: number; tabs: DepartmentTab[]; chosen: string | null; onChoose: (slug: string | null) => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("home.shelfTabs", { title })}
      className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
    >
      {[null, ...tabs].map(tab => {
        const pressed = (tab?.slug ?? null) === chosen;
        return (
          <button
            key={tab?.slug ?? "all"}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChoose(tab?.slug ?? null)}
            className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[14px] font-semibold ${
              pressed ? "border-[#0a285a] bg-[#0a285a] text-white hover:bg-[#0d3372]" : "border-[#d5dfeb] bg-white text-[#0a285a] hover:bg-[#f0f2f5]"
            }`}
          >
            {tab ? t(tab.label) : t("categories.allSub")}
            <span className={pressed ? "text-white/80" : "ink-muted"}>{tab ? tab.products.length : total}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * One shelf: the heading, the department tabs where they would change
 * something, and the cards — a strip scrolled sideways (the arrows scroll it
 * a screenful at a time and appear only when there is something off-screen
 * to reach) or a grid, two to a row on a phone and up to five on a wide
 * screen. `ranked` draws each card beside its place in large outlined
 * figures, only for a shelf whose order *is* a ranking.
 */
export function TabbedShelf({ id, title, titleText, products, layout, ranked = false, onViewAll, tabs = true, loading = false, failed = false, note, tinted = false, banner, children, saved, onSave, onQuickView }: {
  id: string;
  title: MessageKey;
  /** A name that is somebody's own words rather than the dictionary's: one of NetLet's occasions. */
  titleText?: string;
  products: Product[];
  layout: "rail" | "grid";
  ranked?: boolean;
  /** Absent where the shelf is the whole list — Bestsellers has no page of its own. */
  onViewAll?: () => void;
  /** Off for a shelf that is the shopper's own rather than the shop's. */
  tabs?: boolean;
  /** The outline where the cards will be, so the page does not jump. */
  loading?: boolean;
  failed?: boolean;
  /** A line under the heading saying what the shelf is. */
  note?: string;
  /** On a panel of the brand's pale orange, for a season's shelf. */
  tinted?: boolean;
  /** A picture across the top of the shelf, over its heading. */
  banner?: ReactNode;
  /** More for the heading, before "View all": the arrows, a Clear. */
  children?: ReactNode;
} & ShelfCardProps) {
  const { t } = useTranslation();
  const shelfTitle = titleText ?? t(title);
  const rows = useMemo(() => (tabs ? departmentTabs(products) : []), [products, tabs]);
  const [chosen, setChosen] = useState<string | null>(null);
  /* A department that left the shelf leaves the row; the shelf is "All" again. */
  const current = rows.find(row => row.slug === chosen) ?? null;
  const shown = current ? current.products : products;
  const visible = layout === "grid" ? shown.slice(0, 15) : shown.slice(0, MAX_SHELF_PRODUCTS);
  const scroll = useSideScroll<HTMLDivElement>([visible.length, loading, current?.slug ?? ""]);

  const card = (product: Product) => (
    <ProductCard compact product={product} saved={saved.includes(product.id)} onSave={() => onSave(product.id, product.title)} onQuickView={() => onQuickView(product)} />
  );

  return (
    <section id={id} className="py-6 sm:py-8" aria-labelledby={`${id}-title`}>
      <div className="container">
       <div className={tinted ? "rounded-[1.5rem] bg-[#fff3ec] px-4 py-5 sm:px-6 sm:py-7" : ""}>
        {banner}
        <ShelfHeading id={id} title={shelfTitle} onViewAll={onViewAll}>
          {children}
          {layout === "rail" && !loading && !failed ? (
            <ScrollArrows scroll={scroll} previousLabel={t("home.previousProducts", { title: shelfTitle })} nextLabel={t("home.nextProducts", { title: shelfTitle })} />
          ) : null}
        </ShelfHeading>
        {note ? <p dir="auto" className="mt-1 max-w-prose text-xs leading-5 ink-muted">{note}</p> : null}
        {rows.length ? <DepartmentTabRow title={shelfTitle} total={products.length} tabs={rows} chosen={current?.slug ?? null} onChoose={setChosen} /> : null}
        {loading ? <CatalogSkeleton /> : failed ? (
          <div className="mt-4 rounded-2xl border border-[#f2b69e] bg-white px-6 py-10 text-center text-[#0a285a]"><p className="text-sm font-bold">{t("home.catalogSlow")}</p></div>
        ) : layout === "grid" ? (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visible.map(product => (
              <li key={`${id}-${product.id}`} className="min-w-0">{card(product)}</li>
            ))}
          </ul>
        ) : (
          <div ref={scroll.trackRef} className="hide-scrollbar mt-4 flex snap-x gap-3 overflow-x-auto scroll-smooth pb-1">
            {visible.map((product, index) => (
              /* Four to a row from lg up, whatever the container's width, so a shelf fills its row. */
              <div key={`${id}-${product.id}`} className={`shrink-0 snap-start ${ranked ? "flex w-[200px] items-end sm:w-[235px]" : "w-[164px] sm:w-[195px]"} lg:w-[calc((100%-2.25rem)/4)]`}>
                {/* Drawn, not said: the list's own order is the ranking for a
                    screen reader, and "1" read before every card is noise. */}
                {ranked ? <span aria-hidden className="rank-figure" data-digits={String(index + 1).length}>{index + 1}</span> : null}
                <div className="relative min-w-0 flex-1">{card(product)}</div>
              </div>
            ))}
          </div>
        )}
       </div>
      </div>
    </section>
  );
}

/**
 * A season's or an occasion's shelf — Back to school, Ramadan, the New Year
 * — on the owner's word, on a panel of the brand's pale orange so it reads
 * as the season's rather than one more white shelf. The calendar's
 * (`Shared/commerce/occasions.ts`) is the products the stores tagged for it,
 * under the dictionary's name. One NetLet curated
 * (`Shared/commerce/occasionDesk.ts`) is under its own name, with its banner
 * across the top when it has one and the products NetLet chose leading.
 * "View all" is the occasion's page, `/category/all?occasion=<slug>`.
 */
export function OccasionBand({ shelf, ...cards }: { shelf: OccasionShelf } & ShelfCardProps) {
  const { t, locale } = useTranslation();
  const [, navigate] = useLocation();
  const href = `/category/all?occasion=${shelf.slug}`;
  const name = shelf.curated ? occasionName(shelf.curated, locale === "ar") : shelf.occasion ? t(shelf.occasion.label) : "";
  return (
    <TabbedShelf
      id={`occasion-${shelf.slug}`}
      title={shelf.occasion?.label ?? "occasions.title"}
      titleText={name}
      products={shelf.products}
      layout="rail"
      tabs={false}
      tinted
      banner={shelf.curated?.imageUrl ? <OccasionBanner src={shelf.curated.imageUrl} href={href} /> : null}
      note={shelf.curated ? t("rail.occasion.noteNetLet") : t("rail.occasion.note")}
      onViewAll={() => navigate(href)}
      {...cards}
    />
  );
}

/**
 * An occasion's banner, 3:1 as it was cropped when it was uploaded. It opens
 * the occasion's page for the eye and the finger; "View all" under it is the
 * same link for the keyboard and a screen reader, so the picture is hidden
 * from both — the card photo's rule. A picture that cannot be read draws
 * nothing rather than a broken frame.
 */
export function OccasionBanner({ src, href, eager = false }: { src: string; href?: string; /** At the top of its own page, where it is the first thing drawn. */ eager?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return null;
  /* On its own page a wide screen draws it 4:1, a strip off its top and foot:
     whole, it was 459px of a 900px window, with the occasion's name and every
     product under the fold. The home page's band keeps the 3:1 it was cropped to. */
  const picture = (
    <img
      src={src}
      alt=""
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(src)}
      className={`aspect-[3/1] w-full rounded-2xl bg-[#fde3d6] object-cover ${href ? "" : "lg:aspect-[4/1]"}`}
    />
  );
  return href ? (
    <Link href={href} tabIndex={-1} aria-hidden className="mb-4 block">{picture}</Link>
  ) : (
    <div className="mb-4">{picture}</div>
  );
}

/**
 * The deepest savings, as a navy band across the page rather than one more
 * white shelf — Mega deals, on the owner's word.
 *
 * The deepest saving leads, two columns wide (`ProductCard`'s `feature`), and
 * three more sit beside it — the shelf `shelvesFor` already decided, deepest
 * first, so the band is drawn exactly when the home page's Mega deals shelf
 * would be, from four products up, and a saving is only ever one the store's
 * discount permit allows (`fromInventory` drops the rest on the read). No
 * "ends on" date: a permit's period is when a saving *may* be advertised, not
 * when this one stops, and saying it would be the shop promising for a seller.
 */
export function DealsBand({ id, title, products, saved, onSave, onQuickView }: { id: string; title: MessageKey; products: Product[] } & ShelfCardProps) {
  const { t } = useTranslation();
  const [lead, ...rest] = products;
  if (!lead) return null;
  const card = (product: Product, feature = false) => (
    <ProductCard compact={!feature} feature={feature} product={product} saved={saved.includes(product.id)} onSave={() => onSave(product.id, product.title)} onQuickView={() => onQuickView(product)} />
  );
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-6 bg-[#0a285a] py-8 sm:mt-10 sm:py-11">
      <div className="container">
        <div className="flex items-center justify-between gap-4">
          <h2 id={`${id}-title`} className="text-xl font-extrabold tracking-[-.01em] text-white sm:text-2xl">{t(title)}</h2>
          <Link href={DEALS_PATH} className="pressable -me-2 inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-bold ink-accent-on-dark hover:underline">
            {t("home.viewAll")}<ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </Link>
        </div>
        {/* The lead is the whole row on a phone and a tablet, two of five
            columns on a wide screen. A phone shows two beside nothing, not
            three with one left alone on a row. */}
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <li className="col-span-2 min-w-0 sm:col-span-3 lg:col-span-2">{card(lead, true)}</li>
          {rest.slice(0, 3).map((product, index) => (
            <li key={product.id} className={`min-w-0 ${index === 2 ? "hidden sm:block" : ""}`}>{card(product)}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
