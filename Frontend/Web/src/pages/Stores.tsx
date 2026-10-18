/**
 * Every store selling on NetLet, the busiest shelf first.
 *
 * The home page's Stores on NetLet row holds ten; this is the rest of it, the
 * same cards (`StoreCardLink`) from the same read (`commerce.stores`). A store
 * is listed while it has something on sale, so no card here opens an empty
 * shelf. The read stops at `STORE_INDEX_LIMIT`, and the page says so when it
 * reaches it rather than letting a long list look like the whole of one.
 */
import { Store as StoreIcon } from "lucide-react";
import { Link } from "wouter";
import { BUTTON_PRIMARY, Breadcrumbs, EmptyState, PageBody, PageHeading } from "@/components/layout/Page";
import { usePageChrome } from "@/components/layout/StorefrontShell";
import { StoreCardLink } from "@/components/store/StoreCard";
import { SITE_URL, usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { storesMeta } from "@shared/seo";

/** Mirrors the server's `STORE_INDEX_LIMIT`: the most the read returns. */
const INDEX_LIMIT = 200;

export default function Stores() {
  const { t, locale } = useTranslation();
  usePageMeta(storesMeta(SITE_URL));
  usePageChrome({ activeDepartment: null });
  const stores = trpc.commerce.stores.useQuery({ locale, limit: INDEX_LIMIT }, { staleTime: 5 * 60 * 1000 });
  const list = stores.data ?? [];

  return (
    <PageBody>
      <Breadcrumbs trail={[{ label: t("stores.title") }]} />
      <PageHeading
        title={t("stores.title")}
        note={stores.isLoading || stores.error ? " " : list.length >= INDEX_LIMIT
          ? t("stores.countAtLeast", { count: list.length })
          : list.length === 1 ? t("stores.countOne") : t("stores.countMany", { count: list.length })}
      />
      {stores.isLoading ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-hidden>
          {Array.from({ length: 8 }, (_, index) => <li key={index} className="h-[78px] animate-pulse rounded-2xl border border-[#e6e9ef] bg-white/60" />)}
        </ul>
      ) : stores.error || !list.length ? (
        <EmptyState icon={<StoreIcon className="size-6" />} title={t(stores.error ? "home.catalogSlow" : "stores.empty")} note={t(stores.error ? "home.refreshNote" : "stores.emptyNote")}>
          {stores.error
            ? <button type="button" onClick={() => void stores.refetch()} className={BUTTON_PRIMARY}>{t("home.refreshCatalog")}</button>
            : <Link href="/category/all" className={BUTTON_PRIMARY}>{t("browse.browseEverything")}</Link>}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map(store => <li key={store.slug} className="min-w-0"><StoreCardLink store={store} /></li>)}
        </ul>
      )}
    </PageBody>
  );
}
