/**
 * A guide as a card — its first picture, its title, its summary and how many
 * steps — for `/guides`, the home page and Help, one copy for all three.
 *
 * A guide is written in both languages; `pickGuideText` shows the page's and
 * falls back to the other rather than to nothing, and a fallback is marked
 * with its own `lang` and direction so it reads the right way round.
 */
import { BookOpen } from "lucide-react";
import { Link } from "wouter";
import { Thumb } from "@/components/product/Thumb";
import { useTranslation } from "@/hooks/useTranslation";

export type GuideCardData = {
  slug: string;
  audience: "shopper" | "seller";
  title: string;
  titleAr: string;
  summary: string;
  summaryAr: string;
  imageUrl: string | null;
  stepCount: number;
};

/** The page's language when the guide has it, else the other; and which one it was. */
export function pickGuideText(isArabic: boolean, en: string, ar: string): { text: string; lang: "en" | "ar" } {
  if (isArabic) return ar.trim() ? { text: ar, lang: "ar" } : { text: en, lang: "en" };
  return en.trim() ? { text: en, lang: "en" } : { text: ar, lang: "ar" };
}

export function GuideCard({ guide, eager = false }: { guide: GuideCardData; eager?: boolean }) {
  const { t, isArabic } = useTranslation();
  const title = pickGuideText(isArabic, guide.title, guide.titleAr);
  const summary = pickGuideText(isArabic, guide.summary, guide.summaryAr);
  return (
    <Link href={`/guides/${guide.slug}`} className="group flex h-full flex-col overflow-hidden rounded-2xl border border-[#e6e9ef] bg-white hover:bg-[#f0f2f5]">
      <span className="block aspect-[4/3] overflow-hidden bg-[#eef2f8]">
        <Thumb
          src={guide.imageUrl}
          alt=""
          eager={eager}
          className="size-full object-cover"
          fallbackClassName="bg-[#eef2f8] text-[#0a285a]"
          icon={<BookOpen className="size-8" aria-hidden />}
        />
      </span>
      <span className="flex flex-1 flex-col p-4 sm:p-5">
        <span className="text-[12px] font-semibold ink-accent">
          {t(guide.audience === "seller" ? "guides.forSellers" : "guides.forShoppers")} · {t("guides.stepCount", { count: guide.stepCount })}
        </span>
        <span lang={title.lang} dir={title.lang === "ar" ? "rtl" : "ltr"} className="mt-2 block text-[17px] leading-6 font-extrabold text-[#0a285a]">{title.text}</span>
        {summary.text ? <span lang={summary.lang} dir={summary.lang === "ar" ? "rtl" : "ltr"} className="mt-1.5 line-clamp-3 block text-[14px] leading-6 text-[#404553]">{summary.text}</span> : null}
      </span>
    </Link>
  );
}
