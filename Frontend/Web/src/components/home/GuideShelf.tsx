/**
 * The home page's guides (3.5.3): the newest three for shoppers, beside the
 * way to every guide — drawn only once one is published.
 *
 * It replaced "Useful reading", three made-up articles whose buttons could
 * only say "not published yet", which is the rule a control that changes
 * nothing breaks. Behind the `articles` switch, which can take it off the
 * home page; the guides themselves stay at `/guides`.
 */
import { ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { GuideCard } from "@/components/guides/GuideCard";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";

export function GuideShelf() {
  const { t } = useTranslation();
  /* The same read as the footer's and `/guides`, so the three share one request. */
  const guides = trpc.guides.published.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const list = (guides.data ?? []).filter(guide => guide.audience === "shopper").slice(0, 3);
  if (list.length === 0) return null;
  return (
    <section className="py-6 sm:py-8" aria-labelledby="guides-title">
      <div className="container">
        <div className="flex items-center justify-between gap-4">
          <h2 id="guides-title" className="text-xl font-extrabold tracking-[-.01em] text-[#0a285a] sm:text-2xl">{t("guides.homeTitle")}</h2>
          <Link href="/guides" className="pressable inline-flex items-center gap-1 rounded-full px-2 py-2 text-sm font-bold ink-accent hover:underline">
            {t("guides.all")}<ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </Link>
        </div>
        <ul className="hide-scrollbar mt-4 grid auto-cols-[82%] grid-flow-col gap-3 overflow-x-auto pb-1 sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-2 sm:overflow-visible lg:grid-cols-3">
          {list.map(guide => <li key={guide.slug} className="min-w-0"><GuideCard guide={guide} /></li>)}
        </ul>
      </div>
    </section>
  );
}
