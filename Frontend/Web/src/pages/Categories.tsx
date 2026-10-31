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
 */
import { ChevronRight, Store, Tag, Tags } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
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
  const { t } = useTranslation();
  usePageMeta(categoriesMeta(SITE_URL));
  usePageChrome({ activeDepartment: null });
  const counts = trpc.commerce.departmentCounts.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const shelf = useCatalog(24, { staleTime: 5 * 60 * 1000 });
  const dealsDrawn = shelvesFor(shelf.data ?? []).deals.length > 0;

  const countLine = (slug: string) => {
    const count = counts.data?.[slug] ?? 0;
    return count === 0 ? t("browse.countNone") : count === 1 ? t("browse.countOne") : t("browse.countMany", { count });
  };

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
        {TILES.map(tile => (
          <li key={tile.slug} className="min-w-0">
            <Link
              href={`/category/${categorySlug(tile.query)}`}
              className={`${CARD} group flex h-full flex-col items-center px-3 pb-4 pt-3 shadow-[0_1px_2px_rgba(10,40,90,.06)] transition-colors hover:border-[#d5dfeb] hover:bg-[#f0f2f5]`}
            >
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
              <span className="mt-1 h-5 text-center text-[13px] leading-5 ink-muted">
                {!tile.counted
                  ? t("browse.browseEverything")
                  : counts.data
                    ? countLine(tile.slug)
                    : <span aria-hidden className="inline-block h-3 w-16 animate-pulse rounded-full bg-[#e6e9ef] align-middle" />}
              </span>
            </Link>
          </li>
        ))}
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
