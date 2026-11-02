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
 * **Two boxes lead it, Shop by brand and Shop by stores, on the owner's
 * word** ("two options at the top of shop by category … when you tap on any
 * of them it lists the brands or stores"): each opens its own list, `/brands`
 * and `/stores`. They were two sideways rows of the first dozen of each, which
 * pushed the departments a screen down a phone.
 *
 * **A department's subcategories are a list under a row of its pictures, on
 * the owner's word** — drawn to a picture they sent of a shop's Categories
 * screen. The departments are a row of picture tiles (a sideways row on a
 * phone, all six across from `sm`), the chosen one outlined in navy; under
 * them, the chosen department's subcategories as rows, each with its picture
 * (`SubcategoryIcon`, from the name `Shared/commerce/subcategories.ts` gives
 * it), its name and how many it holds (`commerce.subcategoryCounts`), opening
 * the department narrowed to it (`?sub=`); a last row, "View all", opens the
 * whole department. Every subcategory is listed, an empty one saying so, as
 * the tiles keep all six. The choice is the address's (`?dept=`, replaced
 * rather than pushed, so Back leaves the page rather than stepping through
 * the departments), and the first department with none. **The tiles are
 * large, and the chosen one grows a little on a spring, on the owner's word**
 * ("make the category images bigger, and when you select any of them it gets
 * a bit bigger"): its subcategories then rise into place one after another,
 * and the phone's row brings it to the middle. Transforms and opacity only
 * (`.cat-tile`, `.cat-rise`, `.cat-row` in `index.css`), none of it under
 * reduced motion. "All departments" ends the row and is a link: it has no
 * subcategories of its own. It replaced a panel that opened under the
 * pressed card, which the owner found harder to read than a list.
 */
import { ChevronRight, Menu, Store, Tag, Tags } from "lucide-react";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { SubcategoryIcon } from "@/components/browse/SubcategoryIcon";
import { subcategoriesOf, subcategoryName } from "@shared/commerce/subcategories";
import { Breadcrumbs, CARD, PageBody, PageHeading } from "@/components/layout/Page";
import { usePageChrome } from "@/components/layout/StorefrontShell";
import { shelvesFor } from "@/content/homeLayout";
import { useCatalog } from "@/hooks/useCatalog";
import { SITE_URL, usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { appPath } from "@/lib/basePath";
import { trpc } from "@/lib/trpc";
import { categorySlug } from "@shared/commerce/browse";
import { ALL_DEPARTMENTS, DEPARTMENTS } from "@shared/commerce/departments";
import { categoriesMeta } from "@shared/seo";

export default function Categories() {
  const { t, locale } = useTranslation();
  usePageMeta(categoriesMeta(SITE_URL));
  usePageChrome({ activeDepartment: null });
  const counts = trpc.commerce.departmentCounts.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const subCounts = trpc.commerce.subcategoryCounts.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const shelf = useCatalog(24, { staleTime: 5 * 60 * 1000 });
  const dealsDrawn = shelvesFor(shelf.data ?? []).deals.length > 0;

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

  const countLine = (count: number) =>
    count === 0 ? t("browse.countNone") : count === 1 ? t("browse.countOne") : t("browse.countMany", { count });
  const placeholder = <span aria-hidden className="inline-block h-3 w-16 animate-pulse rounded-full bg-[#e6e9ef] align-middle" />;

  const name = t(chosen.label);
  const department = `/category/${categorySlug(chosen.name)}`;
  const arabic = locale === "ar";
  const tile = "cat-tile flex aspect-square w-full items-center justify-center rounded-2xl border-2 bg-white p-2";
  const tileWidth = "w-[6.5rem] shrink-0 snap-center min-[390px]:w-28 sm:w-auto";

  return (
    <PageBody>
      <Breadcrumbs trail={[{ label: t("nav.categories") }]} />
      <PageHeading title={t("nav.categories")} />
      <ul className="mb-7 grid grid-cols-2 gap-3 sm:mb-9 sm:gap-4">
        <li className="min-w-0"><WayIn href="/brands" icon={<Tags className="size-5" />} title={t("home.shopByBrand")} note={t("categories.byBrandNote")} /></li>
        <li className="min-w-0"><WayIn href="/stores" icon={<Store className="size-5" />} title={t("categories.byStore")} note={t("categories.byStoreNote")} /></li>
      </ul>
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
    </PageBody>
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
function SubcategoryRow({ href, icon, title, note, quiet = false }: {
  href: string;
  icon: ReactNode;
  title: string;
  note: ReactNode;
  /** Nothing in it yet: drawn lighter, still a link. */
  quiet?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`${CARD} cat-row flex min-h-[4.5rem] items-center gap-3 p-3 shadow-[0_1px_2px_rgba(10,40,90,.06)] hover:border-[#d5dfeb] hover:bg-[#f0f2f5]`}
    >
      <span aria-hidden className={`grid size-12 shrink-0 place-items-center rounded-xl ${quiet ? "bg-[#f4f5f8] text-[#536b8c]" : "bg-[#eef1f6] text-[#0a285a]"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold leading-tight text-[#0a285a]">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-5 ink-muted">{note}</span>
      </span>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-[#0a285a] rtl:-scale-x-100" />
    </Link>
  );
}

/** A box at the top of the page that opens a list: the brands or the stores. */
function WayIn({ href, icon, title, note }: { href: string; icon: ReactNode; title: string; note: string }) {
  return (
    <Link
      href={href}
      className={`${CARD} flex h-full min-h-[92px] flex-col justify-between gap-3 p-3.5 shadow-[0_1px_2px_rgba(10,40,90,.06)] hover:border-[#d5dfeb] hover:bg-[#f0f2f5] sm:flex-row sm:items-center sm:p-4`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#0a285a] text-white">{icon}</span>
        <span className="min-w-0">
          <span className="block text-[15px] font-extrabold leading-tight text-[#0a285a]">{title}</span>
          <span className="mt-0.5 hidden text-[13px] leading-5 ink-muted sm:block">{note}</span>
        </span>
      </span>
      <ChevronRight aria-hidden className="hidden size-5 shrink-0 text-[#0a285a] rtl:-scale-x-100 sm:block" />
    </Link>
  );
}
