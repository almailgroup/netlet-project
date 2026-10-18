/**
 * `/guides`: every published guide (3.5.3), shopping first and then selling,
 * each group drawn only when it has one.
 *
 * Two groups rather than a filter, because there will be a handful of guides
 * and somebody arriving knows which side of the counter they are on. With
 * none published the page says so and points at Help, rather than drawing an
 * empty grid under a heading.
 */
import { BookOpen } from "lucide-react";
import { Link } from "wouter";
import { GuideCard } from "@/components/guides/GuideCard";
import { BUTTON_PRIMARY, Breadcrumbs, EmptyState, PageBody, PageHeading } from "@/components/layout/Page";
import { usePageChrome } from "@/components/layout/StorefrontShell";
import { SITE_URL, usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { guidesMeta } from "@shared/seo";

export default function Guides() {
  const { t } = useTranslation();
  usePageMeta(guidesMeta(SITE_URL));
  usePageChrome({ activeDepartment: null });
  const guides = trpc.guides.published.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const list = guides.data ?? [];
  const groups = [
    { audience: "shopper" as const, title: t("guides.shoppingTitle") },
    { audience: "seller" as const, title: t("guides.sellingTitle") },
  ].map(group => ({ ...group, guides: list.filter(guide => guide.audience === group.audience) })).filter(group => group.guides.length > 0);

  return (
    <PageBody>
      <Breadcrumbs trail={[{ label: t("guides.title") }]} />
      <PageHeading title={t("guides.title")} note={t("guides.intro")} />
      {guides.isLoading ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {Array.from({ length: 3 }, (_, index) => <li key={index} className="h-[320px] animate-pulse rounded-2xl border border-[#e6e9ef] bg-white/60" />)}
        </ul>
      ) : guides.error || groups.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-6" />}
          title={t(guides.error ? "home.catalogSlow" : "guides.empty")}
          note={t(guides.error ? "home.refreshNote" : "guides.emptyNote")}
        >
          {guides.error
            ? <button type="button" onClick={() => void guides.refetch()} className={BUTTON_PRIMARY}>{t("home.refreshCatalog")}</button>
            : <Link href="/help" className={BUTTON_PRIMARY}>{t("help.title")}</Link>}
        </EmptyState>
      ) : (
        groups.map((group, groupIndex) => (
          <section key={group.audience} aria-labelledby={`guides-${group.audience}`} className={groupIndex > 0 ? "mt-10" : ""}>
            {groups.length > 1 ? <h2 id={`guides-${group.audience}`} className="mb-4 text-lg font-extrabold text-[#0a285a]">{group.title}</h2> : <h2 id={`guides-${group.audience}`} className="sr-only">{group.title}</h2>}
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {group.guides.map((guide, index) => <li key={guide.slug} className="min-w-0"><GuideCard guide={guide} eager={groupIndex === 0 && index < 3} /></li>)}
            </ul>
          </section>
        ))
      )}
    </PageBody>
  );
}
