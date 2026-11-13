/**
 * The departments, as a page of their own — what the phone's Categories tab
 * opens.
 *
 * **It is drawn after the owner's picture of a shop's Categories screen, in
 * three steps** ("when you tap on a category, it must open the sub category
 * of that category. And then when you tap on a sub category, it should show
 * the products for that sub category, with the stores shown at the top, with
 * the filters option"). The last round's panels — the stores, the ways in,
 * the brands and a second panel under each subcategory — read as confusing,
 * and went. Now:
 *
 * 1. **The departments are a grid of pictures with their names under them**
 *    — three to a row on a phone, six across from `lg` — the home page's own
 *    art (`Frontend/Web/public/departments/<slug>.webp`) on a pale tile.
 * 2. **A press on one opens its subcategories directly under its row**: the
 *    tile's picture is rimmed in navy and a list of rows unfolds, each the
 *    subcategory's picture and its name, ending on "View all", which is the
 *    whole department. A second press, or another department, folds it. One
 *    is open at a time, and which is the address's (`?dept=`, replaced rather
 *    than pushed), so a link opens the page as it was shared.
 * 3. **A subcategory is a link to its products** (`/category/<slug>?sub=`),
 *    the department page narrowed to it, which leads with the filter chips
 *    and the stores that sell it and floats the Sort | Filter pill.
 *
 * **All six, always**, on the home cards' rule: this page is the shop's
 * shape. "All departments" is the last tile, and a link.
 *
 * **Its search searches the page, on the owner's word** ("the search bar
 * should only search for what's in the specific page"): the header's field
 * reads "Search categories and stores" here, and typing puts the
 * departments, the subcategories (by their names and the words they are
 * called by) and the stores that answer in place of the tiles
 * (`PageSearch.tsx`, `textsMatch`), with the shop's own search a press away
 * when nothing does. A department found opens the page on it; a subcategory
 * found opens its products.
 */
import { ChevronRight, Menu } from "lucide-react";
import { PageSearchMissed, usePageTerm } from "@/components/layout/PageSearch";
import { StoreMark, StoreRating, type StoreCardData } from "@/components/store/StoreCard";
import { textsMatch } from "@shared/commerce/search";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { SubcategoryIcon } from "@/components/browse/SubcategoryIcon";
import { DepartmentArt } from "@/components/browse/DepartmentArt";
import { DepartmentIcon } from "@/components/browse/DepartmentIcon";
import { subcategoriesOf, subcategoryName } from "@shared/commerce/subcategories";
import { Breadcrumbs, CARD, PageBody, PageHeading } from "@/components/layout/Page";
import { usePageChrome } from "@/components/layout/StorefrontShell";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { SITE_URL, usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { appPath } from "@/lib/basePath";
import { trpc } from "@/lib/trpc";
import { categorySlug } from "@shared/commerce/browse";
import { ALL_DEPARTMENTS, DEPARTMENTS, type Department } from "@shared/commerce/departments";
import { shownSubcategoryPicture } from "@shared/commerce/subcategoryPictures";
import { categoriesMeta } from "@shared/seo";

/** How long a department's list takes to fold away before it leaves the page (`.cat-unfold`). */
const FOLD_MS = 300;

type Pictures = Parameters<typeof shownSubcategoryPicture>[0] | undefined;

export default function Categories() {
  const { t } = useTranslation();
  usePageMeta(categoriesMeta(SITE_URL));
  usePageChrome({ activeDepartment: null, pageSearch: { placeholder: "search.inCategories" } });
  const term = usePageTerm();
  /* A picture kept from the portal stands in place of the subcategory's own file. */
  const pictures = trpc.subcategoryPictures.list.useQuery(undefined, { staleTime: 5 * 60 * 1000 });

  const [, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const opened = DEPARTMENTS.find(department => department.slug === params.get("dept")) ?? null;
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

  /* Three tiles to a row, six from lg: the list goes after the last tile of the opened one's row. */
  const wide = useMediaQuery("(min-width: 1024px)");
  const columns = wide ? 6 : 3;
  const tiles = [...DEPARTMENTS.map(entry => entry.slug), "all"];
  const shownIndex = shown ? tiles.indexOf(shown.slug) : -1;
  const listAfter = shownIndex < 0 ? -1 : Math.min(tiles.length - 1, Math.floor(shownIndex / columns) * columns + columns - 1);

  /* An opened department whose list starts low on the screen is brought up
     to its tile, so its subcategories are in view. */
  const grid = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!opened) return;
    const timer = window.setTimeout(() => {
      const tile = grid.current?.querySelector<HTMLElement>(`[data-slug="${opened.slug}"]`);
      const list = document.getElementById("category-panel");
      if (!tile || !list) return;
      if (list.getBoundingClientRect().top < window.innerHeight * 0.7) return;
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
      {term ? <PageResults term={term} countLine={countLine} pictures={pictures.data} /> : (
        <ul ref={grid} aria-label={t("nav.categories")} className="grid grid-cols-3 gap-x-3 gap-y-5 sm:gap-x-4 lg:grid-cols-6 lg:gap-x-5">
          {tiles.map((slug, index) => {
            const department = DEPARTMENTS.find(entry => entry.slug === slug) ?? null;
            return [
              <li key={slug} className="min-w-0">
                {department ? (
                  <DepartmentTile department={department} open={opened?.slug === slug} onPress={() => toggle(slug)} />
                ) : (
                  <Link href={`/category/${categorySlug(ALL_DEPARTMENTS.query)}`} className="cat-dtile group flex w-full flex-col text-start hover:bg-transparent">
                    <TileFace slug="all" open={false} />
                    <TileName>{t(ALL_DEPARTMENTS.label)}</TileName>
                  </Link>
                )}
              </li>,
              index === listAfter && shown ? (
                <li key={`list-${shown.slug}`} className="col-span-full -mt-1 min-w-0">
                  <Unfold open={Boolean(opened)} onGone={() => setClosing(null)}>
                    <SubcategoryList department={shown} pictures={pictures.data} />
                  </Unfold>
                </li>
              ) : null,
            ];
          })}
        </ul>
      )}
    </PageBody>
  );
}

/** One department as a picture with its name under it, which opens and closes its subcategories. */
function DepartmentTile({ department, open, onPress }: { department: Department; open: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-slug={department.slug}
      aria-expanded={open}
      aria-controls={open ? "category-panel" : undefined}
      onClick={onPress}
      className="cat-dtile group flex w-full scroll-mt-28 flex-col text-start hover:bg-transparent lg:scroll-mt-32"
    >
      <TileFace slug={department.slug} open={open} />
      <TileName>{t(department.label)}</TileName>
    </button>
  );
}

/** A tile's picture on its pale ground, rimmed in navy while its department is open. */
function TileFace({ slug, open }: { slug: string; open: boolean }) {
  return (
    <span
      className={`cat-dtile-art tint-in-group grid aspect-square w-full place-items-center overflow-hidden rounded-[22px] bg-[#eef1f6] p-2 outline outline-[3px] -outline-offset-[3px] sm:p-3 ${open ? "outline-[#0a285a]" : "outline-transparent"}`}
    >
      <TileArt slug={slug} />
    </span>
  );
}

function TileName({ children }: { children: ReactNode }) {
  return <span className="mt-2 block px-0.5 text-[14px] font-bold leading-tight text-[#0a285a] sm:text-[16px]">{children}</span>;
}

/**
 * A list unfolding to its content's height and folding back — a grid row
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

/**
 * One department's subcategories under its tile, each a row — its picture and
 * its name — that opens its products, and "View all", the whole department.
 */
function SubcategoryList({ department, pictures }: { department: Department; pictures: Pictures }) {
  const { t, locale } = useTranslation();
  const arabic = locale === "ar";
  const name = t(department.label);
  const page = `/category/${categorySlug(department.name)}`;
  const subs = subcategoriesOf(department.slug);
  return (
    <ul id="category-panel" aria-label={t("categories.subcategoriesOf", { name })} className="grid gap-2.5 pt-1 sm:grid-cols-2 lg:grid-cols-3">
      {subs.map((entry, index) => (
        <li key={entry.slug} className="cat-rise min-w-0" style={{ "--rise": index } as CSSProperties}>
          <ListRow
            href={`${page}?sub=${entry.slug}`}
            icon={<SubcategoryIcon icon={entry.icon} />}
            picture={shownSubcategoryPicture(pictures, department.slug, entry.slug)}
            title={subcategoryName(entry, arabic)}
          />
        </li>
      ))}
      <li className="cat-rise min-w-0" style={{ "--rise": subs.length } as CSSProperties}>
        <ListRow href={page} icon={<Menu className="size-7" strokeWidth={2} aria-hidden />} title={t("home.viewAll")} label={t("categories.seeAllIn", { name })} />
      </li>
    </ul>
  );
}

/** Mirrors the server's `STORE_INDEX_LIMIT`: every store, for the page's own search. */
const INDEX_LIMIT = 200;

/**
 * The page searched: the departments, the subcategories and the stores whose
 * names — and, for a subcategory, the words it is called by — answer every
 * word typed (`textsMatch`), in place of the tiles. A department opens the
 * page on it, a subcategory its products and a store its page.
 */
function PageResults({ term, countLine, pictures }: {
  term: string;
  countLine: (count: number) => string;
  pictures: Pictures;
}) {
  const { t, locale } = useTranslation();
  const counts = trpc.commerce.departmentCounts.useQuery(undefined, { staleTime: 5 * 60 * 1000 }).data;
  const subCounts = trpc.commerce.subcategoryCounts.useQuery(undefined, { staleTime: 5 * 60 * 1000 }).data;
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
                <ListRow
                  href={`/categories?dept=${entry.slug}`}
                  icon={<DepartmentIcon query={entry.name} className="size-6" strokeWidth={1.75} />}
                  picture={entry.art ? `/departments/${entry.slug}.webp` : null}
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
                  <ListRow
                    href={`/category/${categorySlug(department.name)}?sub=${entry.slug}`}
                    icon={<SubcategoryIcon icon={entry.icon} />}
                    picture={shownSubcategoryPicture(pictures, department.slug, entry.slug)}
                    title={subcategoryName(entry, arabic)}
                    note={subCounts ? `${where} · ${countLine(count)}` : where}
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

/** A department's picture in its tile, the home page's own art (its icon until that arrives). */
function TileArt({ slug }: { slug: string }) {
  return <DepartmentArt slug={slug} eager className="aspect-square max-h-full w-full" />;
}

/**
 * One row of a list, the owner's picture of a shop's subcategories: a pale
 * grey row, the subcategory's picture on white at its start and its name —
 * a link to its products. A search's rows carry a line under the name saying
 * where it is and how many it holds (`note`).
 */
function ListRow({ href, icon, picture = null, title, note, label }: {
  href: string;
  icon: ReactNode;
  /** The subcategory's picture — its own file, or the one kept in its place — filling the tile on white. */
  picture?: string | null;
  title: string;
  note?: ReactNode;
  /** A fuller name for a screen reader than the words drawn ("View all" says which department). */
  label?: string;
}) {
  /* A picture that cannot be read gives the tile back to the icon; which one
     failed is kept, so another department's picture is not held to it. */
  const [failed, setFailed] = useState<string | null>(null);
  const shown = picture && failed !== picture ? picture : null;
  return (
    <Link
      href={href}
      aria-label={label}
      className="tint-on-hover flex min-h-[4.75rem] w-full items-center gap-3.5 rounded-2xl bg-[#f1f3f6] p-2.5 text-start transition-transform duration-150 active:scale-[.98] sm:min-h-[5.25rem]"
    >
      {shown ? (
        <span aria-hidden className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-white sm:size-16">
          <img src={appPath(shown)} alt="" loading="lazy" decoding="async" width={64} height={64} onError={() => setFailed(shown)} className="size-full object-contain" />
        </span>
      ) : (
        <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-xl bg-[#e2e6ed] text-[#2b3a55] sm:size-16">{icon}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-bold leading-tight text-[#0a285a]">{title}</span>
        {note ? <span className="mt-0.5 block text-[13px] leading-5 ink-muted">{note}</span> : null}
      </span>
    </Link>
  );
}
