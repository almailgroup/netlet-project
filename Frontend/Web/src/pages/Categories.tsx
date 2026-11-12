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
 * **All six, always**, on the home cards' rule rather than the navigation's —
 * this page is the shop's shape, and a department with nothing on sale yet says
 * so in its count instead of vanishing from the one page that lists them all.
 * "All departments" comes last, where somebody who did not find theirs looks
 * next. Deals follows the list only while the home page draws a Deals shelf
 * (`shelvesFor`), the rule every link to it keeps.
 *
 * **Shop by brand leads it** (`/brands`), drawn while there is a brand to
 * list. Shop by stores stood beside it, and **the stores are under each
 * department now, on the owner's word** ("remove the shop by stores, instead
 * add the stores to the sub category"): under the chosen department's
 * subcategories, the stores that sell in it, the one selling the most first
 * (`commerce.storesSelling`), each opening its page on that department, and
 * "See all stores" after them.
 *
 * **Its search searches the page, on the owner's word** ("the search bar
 * should only search for what's in the specific page"): the header's field
 * reads "Search categories and stores" here, and typing puts the
 * departments, the subcategories (by their names and the words they are
 * called by) and the stores that answer in place of the tiles
 * (`PageSearch.tsx`, `textsMatch`), with the shop's own search a press away
 * when nothing does.
 *
 * **A department's subcategories are a list under a row of its pictures, on
 * the owner's word** — drawn to a picture they sent of a shop's Categories
 * screen. The departments are a row of picture tiles (a sideways row on a
 * phone, all six across from `sm`), the chosen one outlined in navy; under
 * them, the chosen department's subcategories as rows, each with its picture
 * — its own file, `public/subcategories/<department>-<slug>.webp`, which the
 * owner sent for all thirty-five, or the one kept from the portal in its
 * place (`shownSubcategoryPicture`); the outline icon
 * (`SubcategoryIcon`) only where a picture cannot be read — its name and how
 * many it holds (`commerce.subcategoryCounts`), opening the department
 * narrowed to it (`?sub=`); a last row, "View all", opens the whole
 * department. Every subcategory is listed, an empty one saying so, as
 * the tiles keep all six. The choice is the address's (`?dept=`, replaced
 * rather than pushed, so Back leaves the page rather than stepping through
 * the departments), and the first department with none. **The tiles are
 * large, and the chosen one grows a little on a spring, on the owner's word**
 * ("make the category images bigger, and when you select any of them it gets
 * a bit bigger"; then "make the category icons bigger than the
 * subcategory": a phone's tile is 120px, 132 from 390, where a
 * subcategory's picture is 56): its subcategories then rise into place one after another,
 * and the phone's row brings it to the middle. Transforms and opacity only
 * (`.cat-tile`, `.cat-rise`, `.cat-row` in `index.css`), none of it under
 * reduced motion. "All departments" ends the row and is a link: it has no
 * subcategories of its own. It replaced a panel that opened under the
 * pressed card, which the owner found harder to read than a list.
 */
import { ChevronRight, Menu, Store, Tag, Tags } from "lucide-react";
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
import { SITE_URL, usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { appPath } from "@/lib/basePath";
import { trpc } from "@/lib/trpc";
import { categorySlug } from "@shared/commerce/browse";
import { ALL_DEPARTMENTS, DEPARTMENTS } from "@shared/commerce/departments";
import { shownSubcategoryPicture } from "@shared/commerce/subcategoryPictures";
import { categoriesMeta } from "@shared/seo";

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

  const [, navigate] = useLocation();
  const asked = new URLSearchParams(useSearch()).get("dept");
  const chosen = DEPARTMENTS.find(department => department.slug === asked) ?? DEPARTMENTS[0];
  const choose = (slug: string) => {
    if (slug !== chosen.slug) navigate(`/categories?dept=${slug}`, { replace: true });
  };

  /* The chosen tile is brought to the middle of the phone's sideways row, so
     the one just pressed is never left half off the screen. Measured as a
     distance on the screen, which is the same sum on either page's side. */
  const row = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const scroller = row.current;
    const tile = scroller?.querySelector<HTMLElement>(`[data-slug="${chosen.slug}"]`);
    if (!scroller || !tile || scroller.scrollWidth <= scroller.clientWidth) return;
    const box = scroller.getBoundingClientRect();
    const at = tile.getBoundingClientRect();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollBy({ left: at.left + at.width / 2 - (box.left + box.width / 2), behavior: still ? "instant" : "smooth" });
  }, [chosen.slug]);

  /* The brands' own read, the one `/brands` lists (asked with the page, `routeData`). */
  const brands = trpc.commerce.brands.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const hasBrands = (brands.data?.length ?? 0) > 0;

  const countLine = (count: number) =>
    count === 0 ? t("browse.countNone") : count === 1 ? t("browse.countOne") : t("browse.countMany", { count });
  const placeholder = <span aria-hidden className="inline-block h-3 w-16 animate-pulse rounded-full bg-[#e6e9ef] align-middle" />;

  const name = t(chosen.label);
  const department = `/category/${categorySlug(chosen.name)}`;
  const arabic = locale === "ar";
  const tile = "cat-tile flex aspect-square w-full items-center justify-center rounded-2xl border-2 bg-white p-2";
  const tileWidth = "w-[7.5rem] shrink-0 snap-center min-[390px]:w-[8.25rem] sm:w-auto";
  /* The stores that sell in the chosen department, the one selling the most first. */
  const storesIn = trpc.commerce.storesSelling.useQuery({ department: chosen.name, locale }, { staleTime: 5 * 60 * 1000, enabled: !term });

  return (
    <PageBody>
      <Breadcrumbs trail={[{ label: t("nav.categories") }]} />
      <PageHeading title={t("nav.categories")} />
      {term ? <PageResults term={term} countLine={countLine} pictures={pictures.data} subCounts={subCounts.data} counts={counts.data} /> : <>
      {/* Only while there is a brand to list: a box that opens "No brands yet"
          is a control that leads nowhere, the departments' rule. */}
      {hasBrands ? (
        <div className="mb-7 sm:mb-9">
          <WayIn href="/brands" icon={<Tags className="size-5" />} title={t("home.shopByBrand")} note={t("categories.byBrandNote")} />
        </div>
      ) : null}
      <h2 id="departments-title" className="mb-3 text-xl font-extrabold tracking-[-.01em] text-[#0a285a] sm:mb-4 sm:text-2xl">{t("home.shopByCategory")}</h2>
      {/* A sideways row on a phone, reaching the screen's edges so the tile cut
          off there says there is more; all six across from sm, held to a
          tile's size there so the list under them starts on the first screen.
          Room above and below for the chosen tile to grow into. */}
      <div role="group" aria-labelledby="departments-title">
        <ul
          ref={row}
          className="hide-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto scroll-px-4 px-4 py-2.5 sm:mx-0 sm:grid sm:max-w-4xl sm:grid-cols-6 sm:gap-4 sm:overflow-visible sm:px-0 lg:max-w-5xl lg:gap-5"
        >
          {DEPARTMENTS.map(entry => {
            const pressed = entry.slug === chosen.slug;
            return (
              <li key={entry.slug} data-slug={entry.slug} className={tileWidth}>
                <button
                  type="button"
                  aria-pressed={pressed}
                  aria-controls="subcategory-list"
                  onClick={() => choose(entry.slug)}
                  className="cat-tile-press group flex w-full flex-col items-center gap-3 rounded-2xl text-center"
                >
                  <span
                    data-chosen={pressed ? "" : undefined}
                    className={`${tile} ${pressed ? "border-[#0a285a] shadow-[0_8px_22px_rgba(10,40,90,.16)]" : "border-[#e6e9ef] group-hover:border-[#c9d3e1]"}`}
                  >
                    <TileArt slug={entry.slug} />
                  </span>
                  <span className={`line-clamp-2 text-[13px] leading-tight transition-colors duration-200 sm:text-[14px] ${pressed ? "font-extrabold text-[#0a285a]" : "font-semibold text-[#2b3a55]"}`}>{t(entry.label)}</span>
                </button>
              </li>
            );
          })}
          <li className={tileWidth}>
            <Link href={`/category/${categorySlug(ALL_DEPARTMENTS.query)}`} className="cat-tile-press group flex w-full flex-col items-center gap-3 rounded-2xl text-center">
              <span className={`${tile} border-[#e6e9ef] group-hover:border-[#c9d3e1]`}><TileArt slug="all" /></span>
              <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-[#2b3a55] sm:text-[14px]">{t(ALL_DEPARTMENTS.label)}</span>
            </Link>
          </li>
        </ul>
      </div>

      {/* Keyed by the department, so choosing another draws its list afresh
          and its rows rise into place one after another (`.cat-rise`). */}
      <section key={chosen.slug} id="subcategory-list" aria-labelledby="subcategory-title" className="mt-5 sm:mt-7">
        <div className="cat-rise mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id="subcategory-title" className="text-[18px] font-extrabold text-[#0a285a] sm:text-xl">{name}</h3>
          <span className="text-[13px] ink-muted">{counts.data ? countLine(counts.data[chosen.slug] ?? 0) : placeholder}</span>
        </div>
        <ul aria-label={t("categories.subcategoriesOf", { name })} className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
          {subcategoriesOf(chosen.slug).map((entry, index) => {
            const label = subcategoryName(entry, arabic);
            const count = subCounts.data?.[chosen.slug]?.[entry.slug] ?? 0;
            return (
              <li key={entry.slug} className="cat-rise min-w-0" style={{ "--rise": index + 1 } as CSSProperties}>
                <SubcategoryRow
                  href={`${department}?sub=${entry.slug}`}
                  icon={<SubcategoryIcon icon={entry.icon} />}
                  picture={shownSubcategoryPicture(pictures.data, chosen.slug, entry.slug)}
                  title={label}
                  note={subCounts.data ? countLine(count) : placeholder}
                  quiet={Boolean(subCounts.data) && count === 0}
                />
              </li>
            );
          })}
          <li className="cat-rise min-w-0" style={{ "--rise": subcategoriesOf(chosen.slug).length + 1 } as CSSProperties}>
            <SubcategoryRow
              href={department}
              icon={<Menu className="size-6" strokeWidth={1.75} aria-hidden />}
              title={t("home.viewAll")}
              note={t("categories.seeAllIn", { name })}
            />
          </li>
        </ul>
        {/* The stores that sell here, on the owner's word: each opens its
            page on this department. Only once somebody sells in it. */}
        {storesIn.data?.length ? (
          <section aria-labelledby="stores-in-title" className="mt-6 sm:mt-8">
            <h4 id="stores-in-title" className="cat-rise mb-3 text-[16px] font-extrabold text-[#0a285a] sm:text-[17px]" style={{ "--rise": subcategoriesOf(chosen.slug).length + 2 } as CSSProperties}>
              {t("categories.storesIn", { name })}
            </h4>
            <ul aria-labelledby="stores-in-title" className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
              {storesIn.data.slice(0, STORES_SHOWN).map((store, index) => (
                <li key={store.slug} className="cat-rise min-w-0" style={{ "--rise": subcategoriesOf(chosen.slug).length + 3 + index } as CSSProperties}>
                  <StoreRow store={store} href={`/stores/${encodeURIComponent(store.slug)}?dept=${categorySlug(chosen.name)}`} note={countLine(store.matching)} />
                </li>
              ))}
              <li className="cat-rise min-w-0" style={{ "--rise": subcategoriesOf(chosen.slug).length + 3 + Math.min(STORES_SHOWN, storesIn.data.length) } as CSSProperties}>
                <SubcategoryRow href="/stores" icon={<Store className="size-6" strokeWidth={1.75} aria-hidden />} title={t("stores.seeAll")} note={t("categories.byStoreNote")} />
              </li>
            </ul>
          </section>
        ) : null}
      </section>

      {dealsDrawn ? (
        <Link
          href="/category/all?offer=1"
          className="glass glass-navy mt-6 flex min-h-14 items-center gap-3 rounded-2xl px-4"
        >
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-[#f2683a] text-[#0a285a]">
            <Tag className="size-[18px]" />
          </span>
          <span className="min-w-0 flex-1 text-[15px] font-bold">{t("home.heroDeals")}</span>
          <ChevronRight aria-hidden className="size-5 shrink-0 rtl:-scale-x-100" />
        </Link>
      ) : null}
      </>}
    </PageBody>
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
                    href={`/category/${categorySlug(department.name)}?sub=${entry.slug}`}
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

/** One row of the list: its picture in a pale tile, its name, what it holds. */
function SubcategoryRow({ href, icon, picture = null, title, note, quiet = false }: {
  href: string;
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
  return (
    <Link
      href={href}
      className={`${CARD} cat-row flex min-h-[4.5rem] items-center gap-3 p-3 shadow-[0_1px_2px_rgba(10,40,90,.06)] hover:border-[#d5dfeb] hover:bg-[#f0f2f5]`}
    >
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
      <ChevronRight aria-hidden className="size-5 shrink-0 text-[#0a285a] rtl:-scale-x-100" />
    </Link>
  );
}

/** The box at the top of the page that opens the brands' list — a row the width of the page now it is alone. */
function WayIn({ href, icon, title, note }: { href: string; icon: ReactNode; title: string; note: string }) {
  return (
    <Link
      href={href}
      className={`${CARD} flex min-h-[68px] items-center justify-between gap-3 p-3.5 shadow-[0_1px_2px_rgba(10,40,90,.06)] hover:border-[#d5dfeb] hover:bg-[#f0f2f5] sm:p-4`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#0a285a] text-white">{icon}</span>
        <span className="min-w-0">
          <span className="block text-[15px] font-extrabold leading-tight text-[#0a285a]">{title}</span>
          <span className="mt-0.5 block text-[13px] leading-5 ink-muted">{note}</span>
        </span>
      </span>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-[#0a285a] rtl:-scale-x-100" />
    </Link>
  );
}
