/**
 * The departments, as a page of their own — what the phone's Categories tab
 * opens.
 *
 * The tab used to slide a sheet in from the side: a list of names over the
 * page the shopper was on, with no address, so Back did nothing useful and a
 * department could not be sent to anybody. The owner asked for a page, and it
 * is the home page's department art made the page's subject
 * (`Frontend/Web/public/departments/<slug>.webp`).
 *
 * **The departments open and close in place, on the owner's word** ("make the
 * category bigger … it can collapse and expand … very user friendly for
 * searching products by categories … get reference from Amazon, noon"): a
 * grid of large picture tiles — two to a row on a phone, three from `sm`,
 * all six across from `lg` — each a button that unfolds its department in a
 * panel the width of the page directly under its row, a notch pointing up at
 * the tile, and folds it again when pressed a second time or closed. One is
 * open at a time. The panel is what the department offers, in the order the
 * owner asked: **the stores that sell in it first, right under the tiles**
 * (`commerce.storesSelling`, a sideways row, the one selling the most first,
 * then "See all stores"); then the ways into it a shop like Amazon or noon
 * offers — everything in it, its deals, its newest, its highest rated, each
 * only where it leads to something (`departmentWays`, over the department
 * page's own shelf, `departmentFacts`); then its subcategories, **at the size
 * they were** (rows with their 56px picture); then its top brands, when any
 * product carries one. **A subcategory pressed shows the stores that sell
 * it**, unfolding under its row with a way to its products and its deals, and
 * folds again on a second press. Which department and subcategory are open is
 * the address's (`?dept=`, `&sub=`, replaced rather than pushed), so a link
 * opens the page as it was shared; with neither every department is shut.
 * The unfolding is the panel's height (`.cat-unfold`, a grid row from nothing
 * to its content), a cut under reduced motion.
 *
 * **All six, always**, on the home cards' rule rather than the navigation's —
 * this page is the shop's shape, and a department with nothing on sale yet says
 * so in its count instead of vanishing from the one page that lists them all.
 * "All departments" is the last tile, and a link. Above the tiles, the ways
 * into the whole shop: Today's deals while the home page draws that shelf
 * (`shelvesFor`), Shop by brand while there is a brand (`/brands`), the
 * stores, the newest and everything.
 *
 * **Its search searches the page, on the owner's word** ("the search bar
 * should only search for what's in the specific page"): the header's field
 * reads "Search categories and stores" here, and typing puts the
 * departments, the subcategories (by their names and the words they are
 * called by) and the stores that answer in place of the tiles
 * (`PageSearch.tsx`, `textsMatch`), with the shop's own search a press away
 * when nothing does. A department or a subcategory found opens the page on it.
 */
import { ChevronDown, ChevronRight, Menu, Sparkles, Star, Store, Tag, Tags, X } from "lucide-react";
import { PageSearchMissed, usePageTerm } from "@/components/layout/PageSearch";
import { StoreMark, StoreRating, type StoreCardData } from "@/components/store/StoreCard";
import { textsMatch } from "@shared/commerce/search";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { SubcategoryIcon } from "@/components/browse/SubcategoryIcon";
import { subcategoriesOf, subcategoryName } from "@shared/commerce/subcategories";
import { Breadcrumbs, CARD, PageBody, PageHeading } from "@/components/layout/Page";
import { usePageChrome } from "@/components/layout/StorefrontShell";
import { dealsDrawn as drawsDeals, shelvesFor } from "@/content/homeLayout";
import { useCatalog } from "@/hooks/useCatalog";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { SITE_URL, usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { appPath } from "@/lib/basePath";
import { DEPARTMENT_SHELF } from "@/lib/routeData";
import { trpc } from "@/lib/trpc";
import { categorySlug } from "@shared/commerce/browse";
import { departmentFacts, departmentWays, type DepartmentFacts } from "@shared/commerce/categoryGuide";
import { ALL_DEPARTMENTS, DEPARTMENTS, type Department } from "@shared/commerce/departments";
import { shownSubcategoryPicture } from "@shared/commerce/subcategoryPictures";
import { categoriesMeta } from "@shared/seo";

/** How long a panel takes to fold away before it leaves the page (`.cat-unfold`). */
const FOLD_MS = 300;

type Pictures = Parameters<typeof shownSubcategoryPicture>[0] | undefined;

export default function Categories() {
  const { t, locale } = useTranslation();
  usePageMeta(categoriesMeta(SITE_URL));
  usePageChrome({ activeDepartment: null, pageSearch: { placeholder: "search.inCategories" } });
  const term = usePageTerm();
  const counts = trpc.commerce.departmentCounts.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const subCounts = trpc.commerce.subcategoryCounts.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  /* A picture kept from the portal stands in place of the subcategory's own file. */
  const pictures = trpc.subcategoryPictures.list.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const shelf = useCatalog(24, { staleTime: 5 * 60 * 1000 });
  const dealsDrawn = drawsDeals(shelvesFor(shelf.data ?? []));
  /* The brands' own read, the one `/brands` lists (asked with the page, `routeData`). */
  const brands = trpc.commerce.brands.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const hasBrands = (brands.data?.length ?? 0) > 0;

  const [, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const opened = DEPARTMENTS.find(department => department.slug === params.get("dept")) ?? null;
  const openSub = opened ? subcategoriesOf(opened.slug).find(entry => entry.slug === params.get("sub"))?.slug ?? null : null;
  /* The department folding away, drawn until its fold has run. */
  const [closing, setClosing] = useState<string | null>(null);
  const shown = opened ?? DEPARTMENTS.find(department => department.slug === closing) ?? null;

  const toggle = (slug: string) => {
    if (opened?.slug === slug) {
      setClosing(slug);
      navigate("/categories", { replace: true });
    } else {
      setClosing(null);
      navigate(`/categories?dept=${slug}`, { replace: true });
    }
  };
  const setSub = (sub: string | null) => {
    if (!opened) return;
    navigate(`/categories?dept=${opened.slug}${sub ? `&sub=${sub}` : ""}`, { replace: true });
  };

  /* Two tiles to a row on a phone, three from sm, six from lg: the panel goes
     after the last tile of the opened one's row. */
  const wide = useMediaQuery("(min-width: 1024px)");
  const medium = useMediaQuery("(min-width: 640px)");
  const columns = wide ? 6 : medium ? 3 : 2;
  const tiles = [...DEPARTMENTS.map(entry => entry.slug), "all"];
  const shownIndex = shown ? tiles.indexOf(shown.slug) : -1;
  const panelAfter = shownIndex < 0 ? -1 : Math.min(tiles.length - 1, Math.floor(shownIndex / columns) * columns + columns - 1);

  /* An opened department whose panel starts low on the screen is brought up
     to its tile, so what it holds is in view. Measured once the fold starts. */
  const grid = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!opened) return;
    const timer = window.setTimeout(() => {
      const tile = grid.current?.querySelector<HTMLElement>(`[data-slug="${opened.slug}"]`);
      const panel = document.getElementById("category-panel");
      if (!tile || !panel) return;
      if (panel.getBoundingClientRect().top < window.innerHeight * 0.7) return;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      tile.scrollIntoView({ block: "start", behavior: still ? "instant" : "smooth" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [opened]);

  const countLine = (count: number) =>
    count === 0 ? t("browse.countNone") : count === 1 ? t("browse.countOne") : t("browse.countMany", { count });

  return (
    <PageBody>
      <Breadcrumbs trail={[{ label: t("nav.categories") }]} />
      <PageHeading title={t("nav.categories")} />
      {term ? <PageResults term={term} countLine={countLine} pictures={pictures.data} subCounts={subCounts.data} counts={counts.data} /> : <>
      <ShopWays dealsDrawn={dealsDrawn} hasBrands={hasBrands} />
      <h2 id="departments-title" className="mb-3 mt-7 text-xl font-extrabold tracking-[-.01em] text-[#0a285a] sm:mb-4 sm:mt-9 sm:text-2xl">{t("home.shopByCategory")}</h2>
      <ul ref={grid} aria-labelledby="departments-title" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6 lg:gap-5">
        {tiles.map((slug, index) => {
          const department = DEPARTMENTS.find(entry => entry.slug === slug) ?? null;
          return [
            <li key={slug} className="min-w-0">
              {department ? (
                <DepartmentTile
                  department={department}
                  open={opened?.slug === slug}
                  note={counts.data ? countLine(counts.data[slug] ?? 0) : null}
                  onPress={() => toggle(slug)}
                />
              ) : (
                <Link href={`/category/${categorySlug(ALL_DEPARTMENTS.query)}`} className="cat-dtile group flex h-full w-full flex-col overflow-hidden rounded-3xl border-2 border-[#e6e9ef] bg-white text-start hover:border-[#c9d3e1]">
                  <span className="flex aspect-[4/3] w-full items-center justify-center p-3"><TileArt slug="all" /></span>
                  <span className="flex items-center gap-2 px-3 pb-3">
                    <span className="min-w-0 flex-1 text-[15px] font-extrabold leading-tight text-[#0a285a] sm:text-[16px]">{t(ALL_DEPARTMENTS.label)}</span>
                    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-[#eef1f6] text-[#0a285a]"><ChevronRight className="size-4 rtl:-scale-x-100" /></span>
                  </span>
                </Link>
              )}
            </li>,
            index === panelAfter && shown ? (
              <li key={`panel-${shown.slug}`} className="col-span-full min-w-0">
                <Unfold open={Boolean(opened)} onGone={() => setClosing(null)}>
                  <DepartmentPanel
                    department={shown}
                    column={shownIndex % columns}
                    columns={columns}
                    openSub={openSub}
                    setSub={setSub}
                    onClose={() => toggle(shown.slug)}
                    count={counts.data ? counts.data[shown.slug] ?? 0 : null}
                    subCounts={subCounts.data}
                    pictures={pictures.data}
                    countLine={countLine}
                  />
                </Unfold>
              </li>
            ) : null,
          ];
        })}
      </ul>
      </>}
    </PageBody>
  );
}

/**
 * The ways into the whole shop, over the departments — the row Amazon and
 * noon open their categories on: Today's deals while the home page draws
 * that shelf, Shop by brand while there is a brand, the stores, the newest
 * and everything. A sideways row on a phone, wrapping from `sm`.
 */
function ShopWays({ dealsDrawn, hasBrands }: { dealsDrawn: boolean; hasBrands: boolean }) {
  const { t } = useTranslation();
  const ways: { href: string; label: string; icon: ReactNode; strong?: boolean }[] = [
    ...(dealsDrawn ? [{ href: "/category/all?offer=1", label: t("home.heroDeals"), icon: <Tag className="size-[18px]" />, strong: true }] : []),
    ...(hasBrands ? [{ href: "/brands", label: t("home.shopByBrand"), icon: <Tags className="size-[18px]" /> }] : []),
    { href: "/stores", label: t("stores.title"), icon: <Store className="size-[18px]" /> },
    { href: "/category/all?sort=newest", label: t("browse.sort.newest"), icon: <Sparkles className="size-[18px]" /> },
    { href: `/category/${categorySlug(ALL_DEPARTMENTS.query)}`, label: t("nav.allDepartments"), icon: <Menu className="size-[18px]" /> },
  ];
  return (
    <nav aria-label={t("categories.waysToShop")}>
      <ul className="hide-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {ways.map(way => (
          <li key={way.href} className="shrink-0">
            <Link
              href={way.href}
              className={`inline-flex h-11 items-center gap-2 rounded-full px-4 text-[14px] font-bold ${way.strong ? "bg-[#0a285a] text-white hover:bg-[#0d3372]" : "border border-[#d6dfeb] bg-white text-[#0a285a] hover:bg-[#f0f2f5]"}`}
            >
              <span aria-hidden className={way.strong ? "text-[#ffab85]" : "text-[#0a285a]"}>{way.icon}</span>
              {way.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** One department as a large picture tile that opens and closes its panel. */
function DepartmentTile({ department, open, note, onPress }: { department: Department; open: boolean; note: string | null; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-slug={department.slug}
      aria-expanded={open}
      aria-controls={open ? "category-panel" : undefined}
      onClick={onPress}
      className={`cat-dtile group flex h-full w-full scroll-mt-28 flex-col overflow-hidden rounded-3xl border-2 bg-white text-start lg:scroll-mt-32 ${open ? "border-[#0a285a] shadow-[0_10px_26px_rgba(10,40,90,.16)]" : "border-[#e6e9ef] hover:border-[#c9d3e1]"}`}
    >
      <span className="flex aspect-[4/3] w-full items-center justify-center p-3"><TileArt slug={department.slug} /></span>
      <span className="flex items-center gap-2 px-3 pb-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-extrabold leading-tight text-[#0a285a] sm:text-[16px]">{t(department.label)}</span>
          <span className="mt-0.5 block truncate text-[12.5px] leading-5 ink-muted">
            {note ?? <span aria-hidden className="inline-block h-3 w-14 animate-pulse rounded-full bg-[#e6e9ef] align-middle" />}
          </span>
        </span>
        <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-200 ${open ? "bg-[#0a285a] text-white" : "bg-[#eef1f6] text-[#0a285a]"}`}>
          <ChevronDown className={`size-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
        </span>
      </span>
    </button>
  );
}

/**
 * A panel unfolding to its content's height and folding back — a grid row
 * from nothing to the whole of it (`.cat-unfold`) — then leaving the page.
 */
function Unfold({ open, onGone, children }: { open: boolean; onGone?: () => void; children: ReactNode }) {
  const [unfolded, setUnfolded] = useState(false);
  const gone = useRef(onGone);
  gone.current = onGone;
  useEffect(() => {
    if (open) {
      /* A frame shut first, so the opening has somewhere to run from. */
      const frame = window.requestAnimationFrame(() => setUnfolded(true));
      return () => window.cancelAnimationFrame(frame);
    }
    setUnfolded(false);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => gone.current?.(), still ? 0 : FOLD_MS);
    return () => window.clearTimeout(timer);
  }, [open]);
  return (
    <div className="cat-unfold" data-open={unfolded ? "" : undefined}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/** The notch at a panel's top, pointing up at the tile or row that opened it. */
function Notch({ column, columns, tone }: { column: number; columns: number; tone: "white" | "pale" }) {
  return (
    <span
      aria-hidden
      style={{ insetInlineStart: `calc(${((column + 0.5) / columns) * 100}% - 9px)` } as CSSProperties}
      className={`absolute top-0 size-[18px] -translate-y-1/2 rotate-45 border-s border-t ${tone === "white" ? "border-[#dfe5ee] bg-white" : "border-[#dbe4f0] bg-[#f5f8fc]"}`}
    />
  );
}

/**
 * What one department holds, under its tile: its stores, the ways into it,
 * its subcategories and its brands.
 */
function DepartmentPanel({ department, column, columns, openSub, setSub, onClose, count, subCounts, pictures, countLine }: {
  department: Department;
  column: number;
  columns: number;
  openSub: string | null;
  setSub: (sub: string | null) => void;
  onClose: () => void;
  count: number | null;
  subCounts: Record<string, Record<string, number>> | undefined;
  pictures: Pictures;
  countLine: (count: number) => string;
}) {
  const { t, locale } = useTranslation();
  const arabic = locale === "ar";
  const name = t(department.label);
  const page = `/category/${categorySlug(department.name)}`;
  const storesIn = trpc.commerce.storesSelling.useQuery({ department: department.name, locale }, { staleTime: 5 * 60 * 1000 });
  /* The department page's own shelf, so a count here is what that page draws. */
  const shelf = useCatalog(DEPARTMENT_SHELF);
  const facts: DepartmentFacts | null = shelf.data ? departmentFacts(shelf.data, department.name) : null;
  const ways = facts ? departmentWays(facts) : null;

  /* The subcategory folding away, drawn until its fold has run. */
  const [closingSub, setClosingSub] = useState<string | null>(null);
  const subs = subcategoriesOf(department.slug);
  const shownSub = openSub ?? closingSub;
  const wide = useMediaQuery("(min-width: 1024px)");
  const medium = useMediaQuery("(min-width: 640px)");
  const subColumns = wide ? 3 : medium ? 2 : 1;
  const rows = [...subs.map(entry => entry.slug), "all"];
  const subIndex = shownSub ? rows.indexOf(shownSub) : -1;
  const subAfter = subIndex < 0 ? -1 : Math.min(rows.length - 1, Math.floor(subIndex / subColumns) * subColumns + subColumns - 1);
  const pressSub = (slug: string) => {
    if (openSub === slug) {
      setClosingSub(slug);
      setSub(null);
    } else {
      setClosingSub(null);
      setSub(slug);
    }
  };

  const heading = "text-[16px] font-extrabold text-[#0a285a] sm:text-[17px]";
  return (
    <section id="category-panel" aria-labelledby="category-panel-title" className="relative mt-[9px] rounded-3xl border border-[#dfe5ee] bg-white p-4 shadow-[0_8px_24px_rgba(10,40,90,.08)] sm:p-6">
      <Notch column={column} columns={columns} tone="white" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id="category-panel-title" className="text-[20px] font-extrabold leading-tight text-[#0a285a] sm:text-[22px]">{name}</h3>
          <p className="mt-0.5 text-[13px] ink-muted">{count === null ? " " : countLine(count)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={page} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-[#0a285a] px-4 text-[14px] font-bold text-white hover:bg-[#0d3372]">
            {t("categories.seeAllIn", { name })}
            <ChevronRight aria-hidden className="size-4 rtl:-scale-x-100" />
          </Link>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="grid size-11 place-items-center rounded-full border border-[#d6dfeb] bg-white text-[#0a285a] hover:bg-[#f0f2f5]">
            <X aria-hidden className="size-5" />
          </button>
        </div>
      </div>

      {/* The stores that sell here, right under the department, on the owner's word. */}
      <StoresRow
        title={t("categories.storesIn", { name })}
        stores={storesIn.data}
        pending={storesIn.isPending}
        hrefOf={slug => `/stores/${encodeURIComponent(slug)}?dept=${categorySlug(department.name)}`}
        countLine={countLine}
        level="h4"
      />

      {/* The ways in a shop's categories offer, each only where it leads somewhere. */}
      {ways === null ? (
        <div aria-hidden className="mt-5 flex gap-2">
          {[0, 1, 2].map(index => <span key={index} className="h-11 w-28 animate-pulse rounded-full bg-[#eef1f6]" />)}
        </div>
      ) : ways.length ? (
        <ul aria-label={t("categories.waysToShop")} className="mt-5 flex flex-wrap gap-2">
          {ways.map(way => (
            <li key={way}>
              <WayChip
                href={way === "deals" ? `${page}?offer=1` : way === "newest" ? `${page}?sort=newest` : `${page}?sort=rating`}
                icon={way === "deals" ? <Tag className="size-[18px] text-[#a44a2b]" /> : way === "newest" ? <Sparkles className="size-[18px]" /> : <Star className="size-[18px] fill-[#ffb800] text-[#ffb800]" />}
                label={way === "deals" ? t("nav.deals") : way === "newest" ? t("browse.sort.newest") : t("browse.sort.rating")}
                count={way === "deals" ? facts?.deals ?? null : null}
              />
            </li>
          ))}
        </ul>
      ) : null}

      <h4 className={`${heading} mb-3 mt-6`}>{t("categories.subcategories")}</h4>
      <ul aria-label={t("categories.subcategoriesOf", { name })} className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
        {rows.map((slug, index) => {
          const entry = subs.find(sub => sub.slug === slug);
          const count = entry ? subCounts?.[department.slug]?.[slug] ?? 0 : 0;
          return [
            <li key={slug} className="cat-rise min-w-0" style={{ "--rise": index } as CSSProperties}>
              {entry ? (
                <SubcategoryRow
                  onPress={() => pressSub(slug)}
                  expanded={openSub === slug}
                  icon={<SubcategoryIcon icon={entry.icon} />}
                  picture={shownSubcategoryPicture(pictures, department.slug, slug)}
                  title={subcategoryName(entry, arabic)}
                  note={subCounts ? countLine(count) : <span aria-hidden className="inline-block h-3 w-16 animate-pulse rounded-full bg-[#e6e9ef] align-middle" />}
                  quiet={Boolean(subCounts) && count === 0}
                />
              ) : (
                <SubcategoryRow href={page} icon={<Menu className="size-6" strokeWidth={1.75} aria-hidden />} title={t("home.viewAll")} note={t("categories.seeAllIn", { name })} />
              )}
            </li>,
            index === subAfter && shownSub ? (
              <li key={`sub-${shownSub}`} className="col-span-full min-w-0">
                <Unfold open={openSub === shownSub} onGone={() => setClosingSub(null)}>
                  <SubcategoryPanel
                    department={department}
                    sub={shownSub}
                    column={subIndex % subColumns}
                    columns={subColumns}
                    count={subCounts ? subCounts[department.slug]?.[shownSub] ?? 0 : null}
                    deals={facts?.subDeals[shownSub] ?? 0}
                    countLine={countLine}
                  />
                </Unfold>
              </li>
            ) : null,
          ];
        })}
      </ul>

      {facts?.brands.length ? (
        <section aria-labelledby="category-brands" className="mt-6">
          <h4 id="category-brands" className={`${heading} mb-3`}>{t("categories.topBrands", { name })}</h4>
          <ul className="flex flex-wrap gap-2">
            {facts.brands.map(brand => (
              <li key={brand.name}>
                <WayChip href={`${page}?brand=${encodeURIComponent(brand.name)}`} label={brand.name} count={brand.count} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

/** What one subcategory holds, under its row: the stores selling it, and the way to its products and its deals. */
function SubcategoryPanel({ department, sub, column, columns, count, deals, countLine }: {
  department: Department;
  sub: string;
  column: number;
  columns: number;
  count: number | null;
  deals: number;
  countLine: (count: number) => string;
}) {
  const { t, locale } = useTranslation();
  const entry = subcategoriesOf(department.slug).find(item => item.slug === sub);
  const stores = trpc.commerce.storesSelling.useQuery({ department: department.name, sub, locale }, { staleTime: 5 * 60 * 1000 });
  if (!entry) return null;
  const name = subcategoryName(entry, locale === "ar");
  const page = `/category/${categorySlug(department.name)}?sub=${sub}`;
  return (
    <div id="subcategory-panel" role="region" aria-label={name} className="relative mt-[9px] rounded-2xl border border-[#dbe4f0] bg-[#f5f8fc] p-4">
      <Notch column={column} columns={columns} tone="pale" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-[15px] text-[#0a285a]">
          <span className="font-extrabold">{name}</span>
          {count !== null ? <span className="ink-muted"> · {countLine(count)}</span> : null}
        </p>
        <div className="flex flex-wrap gap-2">
          {count !== 0 ? (
            <Link href={page} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-[#0a285a] px-4 text-[14px] font-bold text-white hover:bg-[#0d3372]">
              {t("categories.shopSub", { name })}
              <ChevronRight aria-hidden className="size-4 rtl:-scale-x-100" />
            </Link>
          ) : null}
          {deals > 0 ? <WayChip href={`${page}&offer=1`} icon={<Tag className="size-[18px] text-[#a44a2b]" />} label={t("nav.deals")} count={deals} /> : null}
        </div>
      </div>
      <StoresRow
        title={t("categories.storesIn", { name })}
        stores={stores.data}
        pending={stores.isPending}
        hrefOf={slug => `/stores/${encodeURIComponent(slug)}?dept=${categorySlug(department.name)}`}
        countLine={countLine}
        level="h5"
        emptyNote
      />
    </div>
  );
}

/** A way into a department as a pill: its icon, its words and, where it says something, a count. */
function WayChip({ href, icon, label, count = null }: { href: string; icon?: ReactNode; label: string; count?: number | null }) {
  return (
    <Link href={href} className="inline-flex h-11 items-center gap-2 rounded-full border border-[#d6dfeb] bg-white px-4 text-[14px] font-bold text-[#0a285a] hover:bg-[#f0f2f5]">
      {icon ? <span aria-hidden>{icon}</span> : null}
      <bdi dir="auto">{label}</bdi>
      {count !== null ? <span className="rounded-full bg-[#eef1f6] px-2 py-0.5 text-[12px] font-bold text-[#0a285a]">{count}</span> : null}
    </Link>
  );
}

/**
 * The stores that sell something, as a sideways row of small cards — each its
 * mark, its name and how many of them it sells — then "See all stores". While
 * asked it holds its place with outlines; with none it is not drawn, or says
 * so where it was asked for (`emptyNote`, a subcategory).
 */
function StoresRow({ title, stores, pending, hrefOf, countLine, level, emptyNote = false }: {
  title: string;
  stores: (StoreCardData & { matching?: number })[] | undefined;
  pending: boolean;
  hrefOf: (slug: string) => string;
  countLine: (count: number) => string;
  level: "h4" | "h5";
  emptyNote?: boolean;
}) {
  const { t } = useTranslation();
  const Heading = level;
  if (!pending && !stores?.length) {
    return emptyNote ? <p className="mt-4 text-[13.5px] ink-muted">{t("categories.noStoresYet")}</p> : null;
  }
  return (
    <section className="mt-5">
      <Heading className="mb-2.5 text-[15px] font-extrabold text-[#0a285a] sm:text-[16px]">{title}</Heading>
      <ul className="hide-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-1 sm:px-1">
        {pending
          ? [0, 1, 2].map(index => <li key={index} aria-hidden className="h-[60px] w-44 shrink-0 animate-pulse rounded-2xl bg-[#eef1f6]" />)
          : <>
              {(stores ?? []).slice(0, STORES_SHOWN).map(store => (
                <li key={store.slug} className="shrink-0">
                  <Link href={hrefOf(store.slug)} className="flex h-[60px] w-48 items-center gap-2.5 rounded-2xl border border-[#e1e7ef] bg-white px-2.5 hover:bg-[#f0f2f5]">
                    <StoreMark name={store.name} logoUrl={store.logoUrl} size="sm" />
                    <span className="min-w-0 flex-1">
                      <bdi dir="auto" className="block truncate text-[14px] font-bold leading-tight text-[#0a285a]">{store.name}</bdi>
                      <span className="mt-0.5 block truncate text-[12px] ink-muted">{countLine(store.matching ?? store.products)}</span>
                    </span>
                  </Link>
                </li>
              ))}
              <li className="shrink-0">
                <Link href="/stores" className="flex h-[60px] items-center gap-2 rounded-2xl border border-dashed border-[#c9d3e1] bg-white px-4 text-[14px] font-bold text-[#0a285a] hover:bg-[#f0f2f5]">
                  <Store aria-hidden className="size-[18px]" />
                  {t("stores.seeAll")}
                </Link>
              </li>
            </>}
      </ul>
    </section>
  );
}

/** How many of a department's stores its section lists; "See all stores" has the rest. */
const STORES_SHOWN = 6;
/** Mirrors the server's `STORE_INDEX_LIMIT`: every store, for the page's own search. */
const INDEX_LIMIT = 200;

/**
 * The page searched: the departments, the subcategories and the stores whose
 * names — and, for a subcategory, the words it is called by — answer every
 * word typed (`textsMatch`), in place of the tiles. A department opens the
 * page on it; a subcategory and a store open as they do from the page.
 */
function PageResults({ term, countLine, pictures, subCounts, counts }: {
  term: string;
  countLine: (count: number) => string;
  pictures: Parameters<typeof shownSubcategoryPicture>[0] | undefined;
  subCounts: Record<string, Record<string, number>> | undefined;
  counts: Record<string, number> | undefined;
}) {
  const { t, locale } = useTranslation();
  const arabic = locale === "ar";
  const stores = trpc.commerce.stores.useQuery({ locale, limit: INDEX_LIMIT }, { staleTime: 5 * 60 * 1000 });
  const departments = DEPARTMENTS.filter(entry => textsMatch([entry.name, entry.nameAr, t(entry.label)], term));
  const subcategories = DEPARTMENTS.flatMap(department => subcategoriesOf(department.slug)
    .filter(entry => textsMatch([entry.name, entry.nameAr, ...entry.words], term))
    .map(entry => ({ department, entry })));
  /* By either of its names: an Arabic page lists "غادجت هب", and somebody types "gadget". */
  const matchingStores = (stores.data ?? []).filter(store => textsMatch([store.name, store.otherName], term));
  const nothing = !departments.length && !subcategories.length && !matchingStores.length;
  const heading = "mb-3 text-[18px] font-extrabold text-[#0a285a] sm:text-xl";
  if (nothing && stores.isPending) return <div aria-hidden className={`${CARD} h-[72px] animate-pulse`} />;
  if (nothing) return <PageSearchMissed term={term} />;
  return (
    <div className="space-y-7">
      {departments.length ? (
        <section aria-labelledby="found-departments">
          <h2 id="found-departments" className={heading}>{t("categories.resultsDepartments")}</h2>
          <ul className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
            {departments.map(entry => (
              <li key={entry.slug} className="min-w-0">
                <SubcategoryRow
                  href={`/categories?dept=${entry.slug}`}
                  icon={<Menu className="size-6" strokeWidth={1.75} aria-hidden />}
                  picture={`/departments/${entry.slug}.webp`}
                  title={t(entry.label)}
                  note={counts ? countLine(counts[entry.slug] ?? 0) : ""}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {subcategories.length ? (
        <section aria-labelledby="found-subcategories">
          <h2 id="found-subcategories" className={heading}>{t("categories.subcategories")}</h2>
          <ul className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
            {subcategories.map(({ department, entry }) => {
              const count = subCounts?.[department.slug]?.[entry.slug] ?? 0;
              const where = t("search.within", { place: t(department.label) });
              return (
                <li key={`${department.slug}:${entry.slug}`} className="min-w-0">
                  <SubcategoryRow
                    href={`/categories?dept=${department.slug}&sub=${entry.slug}`}
                    icon={<SubcategoryIcon icon={entry.icon} />}
                    picture={shownSubcategoryPicture(pictures, department.slug, entry.slug)}
                    title={subcategoryName(entry, arabic)}
                    note={subCounts ? `${where} · ${countLine(count)}` : where}
                    quiet={Boolean(subCounts) && count === 0}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {matchingStores.length ? (
        <section aria-labelledby="found-stores">
          <h2 id="found-stores" className={heading}>{t("stores.title")}</h2>
          <ul className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
            {matchingStores.map(store => (
              <li key={store.slug} className="min-w-0">
                <StoreRow store={store} href={`/stores/${encodeURIComponent(store.slug)}`} note={countLine(store.products)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** A store as a row of the page: its mark, its name, what it sells here and its rating. */
function StoreRow({ store, href, note }: { store: StoreCardData; href: string; note: string }) {
  return (
    <Link
      href={href}
      className={`${CARD} cat-row flex min-h-[4.5rem] items-center gap-3 p-3 shadow-[0_1px_2px_rgba(10,40,90,.06)] hover:border-[#d5dfeb] hover:bg-[#f0f2f5]`}
    >
      <StoreMark name={store.name} logoUrl={store.logoUrl} />
      <span className="min-w-0 flex-1">
        <bdi dir="auto" className="block truncate text-[15px] font-bold leading-tight text-[#0a285a]">{store.name}</bdi>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] leading-5 ink-muted">
          <span>{note}</span>
          {store.rating ? <><span aria-hidden>·</span><StoreRating rating={store.rating} /></> : null}
        </span>
      </span>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-[#0a285a] rtl:-scale-x-100" />
    </Link>
  );
}

/** A department's picture in its tile, the home page's own art. */
function TileArt({ slug }: { slug: string }) {
  return (
    <img
      src={appPath(`/departments/${slug}.webp`)}
      alt=""
      loading="eager"
      decoding="async"
      width={480}
      height={360}
      className="max-h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.04]"
    />
  );
}

/**
 * One row of the list: its picture in a pale tile, its name, what it holds —
 * a link (`href`), or a button that opens and closes what is under it
 * (`onPress`, `expanded`), as a subcategory does on the page.
 */
function SubcategoryRow({ href, onPress, expanded = false, icon, picture = null, title, note, quiet = false }: {
  href?: string;
  onPress?: () => void;
  expanded?: boolean;
  icon: ReactNode;
  /** The subcategory's picture — its own file, or the one kept in its place — filling the tile on white. */
  picture?: string | null;
  title: string;
  note: ReactNode;
  /** Nothing in it yet: its icon is drawn lighter, still a link. A picture
   *  never is — faded, black and silver goods read as dull grey, and the
   *  owner asked why; the count beside it says "No products". */
  quiet?: boolean;
}) {
  /* A picture that cannot be read gives the tile back to the icon; which one
     failed is kept, so another department's picture is not held to it. */
  const [failed, setFailed] = useState<string | null>(null);
  const shown = picture && failed !== picture ? picture : null;
  const look = `${CARD} cat-row flex min-h-[4.5rem] w-full items-center gap-3 p-3 text-start shadow-[0_1px_2px_rgba(10,40,90,.06)] hover:border-[#d5dfeb] hover:bg-[#f0f2f5] ${expanded ? "border-[#0a285a] ring-1 ring-[#0a285a]" : ""}`;
  const inside = (
    <>
      {shown ? (
        <span aria-hidden className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-[#e6e9ef] bg-white">
          <img src={appPath(shown)} alt="" loading="lazy" decoding="async" width={56} height={56} onError={() => setFailed(shown)} className="size-full object-contain" />
        </span>
      ) : (
        <span aria-hidden className={`grid size-12 shrink-0 place-items-center rounded-xl ${quiet ? "bg-[#f4f5f8] text-[#536b8c]" : "bg-[#eef1f6] text-[#0a285a]"}`}>{icon}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold leading-tight text-[#0a285a]">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-5 ink-muted">{note}</span>
      </span>
      {onPress ? (
        <ChevronDown aria-hidden className={`size-5 shrink-0 text-[#0a285a] transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} />
      ) : (
        <ChevronRight aria-hidden className="size-5 shrink-0 text-[#0a285a] rtl:-scale-x-100" />
      )}
    </>
  );
  if (onPress) {
    return (
      <button type="button" onClick={onPress} aria-expanded={expanded} aria-controls={expanded ? "subcategory-panel" : undefined} className={look}>
        {inside}
      </button>
    );
  }
  return <Link href={href ?? "/categories"} className={look}>{inside}</Link>;
}
