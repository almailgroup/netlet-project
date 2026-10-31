/**
 * Every brand on the shelf — what "Shop by brand" opens on `/categories`, on
 * the owner's word ("two options at the top of shop by category … when you
 * tap on any of them it lists the brands or stores").
 *
 * The same read the row once was (`commerce.brands`), whole rather than the
 * first twelve, each tile opening the whole shop filtered to the brand
 * (`BrandTile`). The stores have their own page already (`/stores`).
 */
import { Tags } from "lucide-react";
import { Link } from "wouter";
import { BUTTON_PRIMARY, Breadcrumbs, EmptyState, PageBody, PageHeading } from "@/components/layout/Page";
import { usePageChrome } from "@/components/layout/StorefrontShell";
import { BrandTile } from "@/components/store/BrandTile";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { privatePageMeta } from "@shared/seo";

export default function Brands() {
  const { t } = useTranslation();
  usePageMeta(privatePageMeta(t("brands.title")));
  usePageChrome({ activeDepartment: null });
  const brands = trpc.commerce.brands.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const list = brands.data ?? [];

  return (
    <PageBody>
      <Breadcrumbs trail={[{ label: t("nav.categories"), href: "/categories" }, { label: t("brands.title") }]} />
      <PageHeading title={t("brands.title")} note={t("brands.note")} />
      {brands.isLoading ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-hidden>
          {Array.from({ length: 8 }, (_, index) => <li key={index} className="h-[70px] animate-pulse rounded-2xl border border-[#e6e9ef] bg-white/60" />)}
        </ul>
      ) : brands.error || !list.length ? (
        <EmptyState icon={<Tags className="size-6" />} title={t(brands.error ? "home.catalogSlow" : "brands.empty")} note={t(brands.error ? "home.refreshNote" : "brands.emptyNote")}>
          {brands.error
            ? <button type="button" onClick={() => void brands.refetch()} className={BUTTON_PRIMARY}>{t("home.refreshCatalog")}</button>
            : <Link href="/category/all" className={BUTTON_PRIMARY}>{t("browse.browseEverything")}</Link>}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map(brand => <li key={brand.name} className="min-w-0"><BrandTile brand={brand} /></li>)}
        </ul>
      )}
    </PageBody>
  );
}
