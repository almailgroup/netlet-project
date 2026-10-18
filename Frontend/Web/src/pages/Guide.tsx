/**
 * `/guides/:slug`: one guide (3.5.3) — its steps in order, each with its
 * picture, in the page's language.
 *
 * Written by NetLet in both languages and published by a person, so the words
 * are NetLet's own and are not labelled as a model's: a model drafted them and
 * somebody at NetLet read, changed and published them, which is the line every
 * other draft here crosses on its way to a shopper. A draft, or an address
 * nobody has, is the same "not found", with the way to every other guide.
 */
import { ArrowRight, BookOpen, LifeBuoy } from "lucide-react";
import { Link, useRoute } from "wouter";
import { pickGuideText } from "@/components/guides/GuideCard";
import { BUTTON_PRIMARY, Breadcrumbs, CARD, EmptyState, PageBody, PageHeading } from "@/components/layout/Page";
import { usePageChrome } from "@/components/layout/StorefrontShell";
import { Thumb } from "@/components/product/Thumb";
import { SITE_URL, usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { guideMeta, privatePageMeta } from "@shared/seo";

function Paragraphs({ text, lang }: { text: string; lang: "en" | "ar" }) {
  return (
    <div lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className="mt-2 space-y-2 text-[15px] leading-7 text-[#404553]">
      {text.split(/\n{2,}|\n/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
    </div>
  );
}

export default function Guide() {
  const { t, isArabic } = useTranslation();
  const [, params] = useRoute("/guides/:slug");
  const slug = params?.slug ?? "";
  usePageChrome({ activeDepartment: null });
  const guide = trpc.guides.bySlug.useQuery({ slug }, { enabled: slug.length > 0, staleTime: 5 * 60 * 1000 });
  const found = guide.data;
  usePageMeta(found ? guideMeta(found, SITE_URL) : privatePageMeta("Guide"));

  if (guide.isLoading) {
    return (
      <PageBody width="reading">
        <div className="h-8 w-2/3 animate-pulse rounded-lg bg-[#e6e9ef]" aria-hidden />
        <div className="mt-6 h-[360px] animate-pulse rounded-2xl border border-[#e6e9ef] bg-white/60" aria-hidden />
      </PageBody>
    );
  }
  if (!found) {
    return (
      <PageBody width="reading">
        <EmptyState icon={<BookOpen className="size-6" />} title={t(guide.error ? "home.catalogSlow" : "guides.notFound")} note={t(guide.error ? "home.refreshNote" : "guides.notFoundNote")} heading="h1">
          <Link href="/guides" className={BUTTON_PRIMARY}>{t("guides.all")}</Link>
        </EmptyState>
      </PageBody>
    );
  }

  const title = pickGuideText(isArabic, found.title, found.titleAr);
  const summary = pickGuideText(isArabic, found.summary, found.summaryAr);

  return (
    <PageBody width="reading">
      <Breadcrumbs trail={[{ label: t("guides.title"), href: "/guides" }, { label: title.text }]} />
      <PageHeading
        title={<span lang={title.lang} dir={title.lang === "ar" ? "rtl" : "ltr"}>{title.text}</span>}
        note={(
          <>
            <span className="block text-[13px] font-semibold ink-accent">
              {t(found.audience === "seller" ? "guides.forSellers" : "guides.forShoppers")} · {t("guides.stepCount", { count: found.steps.length })}
            </span>
            {summary.text ? <span lang={summary.lang} dir={summary.lang === "ar" ? "rtl" : "ltr"} className="mt-1 block">{summary.text}</span> : null}
          </>
        )}
      />

      <ol className="grid gap-5">
        {found.steps.map((step, index) => {
          const stepTitle = pickGuideText(isArabic, step.title, step.titleAr);
          const body = pickGuideText(isArabic, step.body, step.bodyAr);
          return (
            <li key={index} className={`${CARD} overflow-hidden`}>
              {step.imageUrl ? (
                <span className="block aspect-[4/3] overflow-hidden border-b border-[#e6e9ef] bg-[#eef2f8]">
                  <Thumb src={step.imageUrl} alt={stepTitle.text} priority={index === 0} className="size-full object-cover" />
                </span>
              ) : null}
              <div className="p-5 sm:p-6">
                <h2 className="flex items-start gap-3 text-[17px] leading-6 font-extrabold text-[#0a285a]">
                  <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-[#0a285a] text-[13px] text-white">{index + 1}</span>
                  <span className="sr-only">{t("guides.stepN", { n: index + 1 })}: </span>
                  <span lang={stepTitle.lang} dir={stepTitle.lang === "ar" ? "rtl" : "ltr"} className="pt-0.5">{stepTitle.text}</span>
                </h2>
                <Paragraphs text={body.text} lang={body.lang} />
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <Link href="/guides" className="flex items-center gap-3 rounded-2xl border border-[#e6e9ef] bg-white p-4 hover:bg-[#f0f2f5]">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#eef2f8]"><BookOpen className="size-4" aria-hidden /></span>
          <span className="text-sm font-bold">{t("guides.all")}</span>
          <ArrowRight className="ms-auto size-4 text-[#536b8c] rtl:-scale-x-100" aria-hidden />
        </Link>
        <Link href="/help" className="flex items-center gap-3 rounded-2xl border border-[#e6e9ef] bg-white p-4 hover:bg-[#f0f2f5]">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#eef2f8]"><LifeBuoy className="size-4" aria-hidden /></span>
          <span className="text-sm font-bold">{t("guides.stillStuck")}</span>
          <ArrowRight className="ms-auto size-4 text-[#536b8c] rtl:-scale-x-100" aria-hidden />
        </Link>
      </div>
    </PageBody>
  );
}
