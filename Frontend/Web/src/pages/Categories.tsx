/**
 * The departments, as a page of their own — what the phone's Categories tab
 * opens.
 *
 * The tab used to slide a sheet in from the side: a list of names over the
 * page the shopper was on, with no address, so Back did nothing useful and a
 * department could not be sent to anybody. The owner asked for a page, and it
 * is the home page's department cards made the page's subject: the same art
 * (`Frontend/Web/public/departments/<slug>.webp`), larger, two to a row on a phone,
 * each saying how many products it holds, so the press goes where something is.
 *
 * **All six, always**, on the home cards' rule rather than the navigation's —
 * this page is the shop's shape, and a department with nothing on sale yet says
 * so in its count instead of vanishing from the one page that lists them all.
 * "All departments" comes last, where somebody who did not find theirs looks
 * next. Deals follows the grid only while the home page draws a Deals shelf
 * (`shelvesFor`), the rule every link to it keeps.
 *
 * **Two boxes lead it, Shop by brand and Shop by stores, on the owner's
 * word** ("two options at the top of shop by category … when you tap on any
 * of them it lists the brands or stores"): each opens its own list, `/brands`
 * and `/stores`. They were two sideways rows of the first dozen of each, which
 * pushed the departments a screen down a phone.
 *
 * **A department opens onto its subcategories, on the owner's word** ("when
 * you tap on any category, it expands to show the subcategories"). Its card is
 * a disclosure button now, and the panel opens under the row it sits in —
 * the full width of the grid, with a small pointer at the card — so the row
 * keeps its shape at two, three or six to a row. The panel says "See all in
 * …" and every subcategory with its count (`commerce.subcategoryCounts`,
 * `Shared/commerce/subcategories.ts`), each opening the department narrowed
 * to it (`?sub=`). All of them, as the cards keep all six: an empty one says
 * so on the page it opens. One department open at a time; pressing it again
 * closes it. "All departments" has no subcategories and stays a link.
 */
import { ChevronDown, ChevronRight, Store, Tag, Tags } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Link } from "wouter";
import { useMediaQuery } from "@/hooks/useMediaQuery";
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
import type { MessageKey } from "@shared/i18n/dictionary";
import { categoriesMeta } from "@shared/seo";

const TILES: { slug: string; query: string; label: MessageKey; counted: boolean }[] = [
  ...DEPARTMENTS.map(department => ({ slug: department.slug, query: department.name, label: department.label, counted: true })),
  /* "All" has no count of its own: a product a seller filed under a type of
     their own is in it and in no department, so a sum would be short. */
  { slug: "all", query: ALL_DEPARTMENTS.query, label: ALL_DEPARTMENTS.label, counted: false },
];

export default function Categories() {
  const { t, locale } = useTranslation();
  usePageMeta(categoriesMeta(SITE_URL));
  usePageChrome({ activeDepartment: null });
  const counts = trpc.commerce.departmentCounts.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const subCounts = trpc.commerce.subcategoryCounts.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const shelf = useCatalog(24, { staleTime: 5 * 60 * 1000 });
  const dealsDrawn = shelvesFor(shelf.data ?? []).deals.length > 0;

  /* The grid's own columns — two, three or six — so the panel opens under
     the row the pressed card is in, never in the middle of one. */
  const wide = useMediaQuery("(min-width: 1024px)");
  const medium = useMediaQuery("(min-width: 640px)");
  const columns = wide ? 6 : medium ? 3 : 2;
  const [open, setOpen] = useState<string | null>(null);
  const openIndex = TILES.findIndex(tile => tile.slug === open);
  const rowEnd = openIndex < 0 ? -1 : Math.min(Math.ceil((openIndex + 1) / columns) * columns, TILES.length) - 1;
  const panelRef = useRef<HTMLDivElement>(null);

  /* An opened panel below the fold is brought up to meet the thumb, clear of
     the phone's tab bar; one already on screen does not move the page. */
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const room = window.innerHeight - (medium ? 24 : 112);
    const bottom = panel.getBoundingClientRect().bottom;
    if (bottom > room) {
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollBy({ top: bottom - room, behavior: still ? "instant" : "smooth" });
    }
  }, [open, medium]);

  const countLine = (count: number) =>
    count === 0 ? t("browse.countNone") : count === 1 ? t("browse.countOne") : t("browse.countMany", { count });

  return (
    <PageBody>
      <Breadcrumbs trail={[{ label: t("nav.categories") }]} />
      <PageHeading title={t("nav.categories")} />
      <ul className="mb-7 grid grid-cols-2 gap-3 sm:mb-9 sm:gap-4">
        <li className="min-w-0"><WayIn href="/brands" icon={<Tags className="size-5" />} title={t("home.shopByBrand")} note={t("categories.byBrandNote")} /></li>
        <li className="min-w-0"><WayIn href="/stores" icon={<Store className="size-5" />} title={t("categories.byStore")} note={t("categories.byStoreNote")} /></li>
      </ul>
      <h2 id="departments-title" className="mb-4 text-xl font-extrabold tracking-[-.01em] text-[#0a285a] sm:text-2xl">{t("home.shopByCategory")}</h2>
      <ul aria-labelledby="departments-title" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
        {TILES.map((tile, index) => {
          const expanded = open === tile.slug;
          const face = (
            <>
              <img
                src={appPath(`/departments/${tile.slug}.webp`)}
                alt=""
                loading="eager"
                decoding="async"
                width={480}
                height={360}
                className="aspect-[4/3] w-full object-contain transition-transform duration-200 group-hover:scale-[1.04]"
              />
              <span className="mt-2 line-clamp-2 text-center text-[15px] font-bold leading-tight text-[#0a285a]">{t(tile.label)}</span>
              {/* One line on every tile, so the row keeps one height while the counts arrive. */}
              <span className="mt-1 flex h-5 items-center justify-center gap-1 text-center text-[13px] leading-5 ink-muted">
                {!tile.counted
                  ? t("browse.browseEverything")
                  : counts.data
                    ? countLine(counts.data[tile.slug] ?? 0)
                    : <span aria-hidden className="inline-block h-3 w-16 animate-pulse rounded-full bg-[#e6e9ef] align-middle" />}
                {tile.counted ? <ChevronDown aria-hidden className={`size-4 shrink-0 text-[#0a285a] transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} /> : null}
              </span>
            </>
          );
          const look = `${CARD} group flex h-full w-full flex-col items-center px-3 pb-4 pt-3 shadow-[0_1px_2px_rgba(10,40,90,.06)] transition-colors hover:border-[#d5dfeb] hover:bg-[#f0f2f5]`;
          return (
            <Fragment key={tile.slug}>
              <li className="min-w-0">
                {tile.counted ? (
                  <button
                    id={`department-${tile.slug}`}
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={expanded ? `subcategories-${tile.slug}` : undefined}
                    onClick={() => setOpen(expanded ? null : tile.slug)}
                    className={`${look} ${expanded ? "border-[#0a285a] ring-1 ring-[#0a285a]" : ""}`}
                  >
                    {face}
                  </button>
                ) : (
                  <Link href={`/category/${categorySlug(tile.query)}`} className={look}>{face}</Link>
                )}
              </li>
              {index === rowEnd && open ? (
                <li className="col-span-full min-w-0">
                  <SubcategoryPanel
                    ref={panelRef}
                    slug={open}
                    label={t(TILES[openIndex].label)}
                    query={TILES[openIndex].query}
                    pointer={((openIndex % columns) + 0.5) / columns}
                    counts={subCounts.data?.[open]}
                    loading={!subCounts.data}
                    arabic={locale === "ar"}
                    countLine={countLine}
                  />
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ul>
      {dealsDrawn ? (
        <Link
          href="/category/all?offer=1"
          className="glass glass-navy mt-4 flex min-h-14 items-center gap-3 rounded-2xl px-4 sm:mt-5"
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

/**
 * A department's subcategories, under its row: "See all in …" and a chip for
 * each with how many it holds, the pointer over the card that opened it.
 */
function SubcategoryPanel({ ref, slug, label, query, pointer, counts, loading, arabic, countLine }: {
  ref: Ref<HTMLDivElement>;
  slug: string;
  label: string;
  query: string;
  /** Where the opening card's middle is across the grid, from its start edge, 0 to 1. */
  pointer: number;
  counts: Record<string, number> | undefined;
  loading: boolean;
  arabic: boolean;
  countLine: (count: number) => string;
}) {
  const { t } = useTranslation();
  const department = `/category/${categorySlug(query)}`;
  return (
    <div ref={ref} id={`subcategories-${slug}`} role="region" aria-labelledby={`department-${slug}`} className="subcats-in relative pt-2">
      {/* The pointer up at the card: drawn, so it needs no side of its own. */}
      <svg aria-hidden viewBox="0 0 20 10" className="absolute top-0 z-10 h-2.5 w-5" style={{ insetInlineStart: `calc(${pointer * 100}% - 10px)` }}>
        <path d="M0 10 L10 0 L20 10" fill="#fff" stroke="#e6e9ef" strokeWidth="1" />
        <path d="M1 10.5 H19" stroke="#fff" strokeWidth="2" />
      </svg>
      <div className={`${CARD} p-4 shadow-[0_6px_18px_rgba(10,40,90,.08)] sm:p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h3 className="text-[16px] font-extrabold text-[#0a285a]">{label}</h3>
          <Link href={department} className="inline-flex min-h-11 items-center gap-1 text-[14px] font-bold ink-accent hover:underline">
            {t("categories.seeAllIn", { name: label })}
            <ChevronRight aria-hidden className="size-4 rtl:-scale-x-100" />
          </Link>
        </div>
        <ul aria-label={t("categories.subcategoriesOf", { name: label })} className="mt-2 flex flex-wrap gap-2">
          {subcategoriesOf(slug).map(entry => {
            const name = subcategoryName(entry, arabic);
            const count = counts?.[entry.slug] ?? 0;
            return (
              <li key={entry.slug}>
                <Link
                  href={`${department}?sub=${entry.slug}`}
                  aria-label={loading ? name : `${name}, ${countLine(count)}`}
                  className={`flex min-h-11 items-center gap-2 rounded-full border px-4 text-[14px] font-semibold ${count || loading ? "border-[#d5dfeb] bg-white text-[#0a285a]" : "border-dashed border-[#d5dfeb] bg-white text-[#536b8c]"} hover:bg-[#f0f2f5]`}
                >
                  <span>{name}</span>
                  {loading
                    ? <span aria-hidden className="inline-block h-3 w-5 animate-pulse rounded-full bg-[#e6e9ef]" />
                    : <span aria-hidden className="rounded-full bg-[#f1f2f6] px-2 py-0.5 text-[12px] font-bold text-[#404553]">{count}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
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
