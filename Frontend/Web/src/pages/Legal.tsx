/**
 * The terms of use (`/terms`), the privacy policy (`/privacy`) and the seller
 * agreement (`/seller-agreement`): one page, three documents, all drawn from
 * `content/legal.ts`. The seller agreement carries its version, the one an
 * application freezes when it is accepted, so a seller can see which text the
 * version they ticked names.
 *
 * The operator is named from the company the invoices name
 * (`INVOICE_ISSUER_*`, through `support.channels`), in the page's language;
 * with none recorded the introduction says what NetLet is without naming a
 * company, rather than calling it "run by NetLet". A paragraph about a service
 * the deployment does not run — the analytics tool — is left out, so the
 * policy never describes something that is not happening.
 *
 * On a wide screen the sections are listed beside the text, sticky, so a
 * shopper looking for cookies or returns does not read the page to find it.
 */
import { ArrowRight } from "lucide-react";
import { Link, useLocation } from "wouter";
import { BUTTON_PLAIN, Breadcrumbs, PageBody, PageHeading } from "@/components/layout/Page";
import { usePageChrome } from "@/components/layout/StorefrontShell";
import { LEGAL_UPDATED, PRIVACY, SELLER_TERMS, TERMS, type LegalParagraph } from "@/content/legal";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useFeature } from "@/hooks/useFeature";
import { SITE_URL, usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { nameInSentence } from "@shared/commerce/contact";
import { SETTLEMENT_DAYS } from "@shared/commerce/payoutSchedule";
import { ASK_WINDOW_DAYS, OFFER_WINDOW_DAYS } from "@shared/commerce/priceOffers";
import { RETURN_WINDOW_DAYS } from "@shared/commerce/returns";
import { DEFAULT_COMMISSION_PERCENT } from "@shared/inventory/commission";
import { AGREEMENT_VERSION } from "@shared/inventory/sellerApplication";
import { legalMeta } from "@shared/seo";

/* Built with an analytics tool configured, the policy says it counts visits. */
const ANALYTICS = Boolean(import.meta.env.VITE_ANALYTICS_ENDPOINT?.trim() && import.meta.env.VITE_ANALYTICS_WEBSITE_ID?.trim());

type Running = { email: boolean; tryOn: boolean; drivingTimes: boolean };

const shown = (running: Running) => (paragraph: LegalParagraph) =>
  paragraph.only === undefined
  || (paragraph.only === "analytics" && ANALYTICS)
  || (paragraph.only === "email" && running.email)
  || (paragraph.only === "tryOn" && running.tryOn)
  || (paragraph.only === "drivingTimes" && running.drivingTimes);

/* The figures the documents state, from the constants the code runs on. */
const FIGURES = {
  days: RETURN_WINDOW_DAYS,
  commission: Number(DEFAULT_COMMISSION_PERCENT),
  codDays: SETTLEMENT_DAYS.cod.min,
  askDays: ASK_WINDOW_DAYS,
  offerDays: OFFER_WINDOW_DAYS,
  version: AGREEMENT_VERSION,
};

type Document = "terms" | "privacy" | "sellers";

const DOCUMENTS = {
  terms: { sections: TERMS, title: "terms.title", intro: "terms.intro", plain: "terms.introPlain" },
  privacy: { sections: PRIVACY, title: "privacy.title", intro: "privacy.intro", plain: "privacy.introPlain" },
  sellers: { sections: SELLER_TERMS, title: "sellerTerms.title", intro: "sellerTerms.intro", plain: "sellerTerms.introPlain" },
} as const;

export default function Legal() {
  const { t, isArabic } = useTranslation();
  const formatDate = useDateFormat();
  const [location] = useLocation();
  const page: Document = location.startsWith("/privacy") ? "privacy" : location.startsWith("/seller-agreement") ? "sellers" : "terms";
  usePageMeta(legalMeta(page, SITE_URL));
  usePageChrome({ activeDepartment: null });
  const channels = trpc.support.channels.useQuery(undefined, { staleTime: 300_000 });
  const mail = trpc.notifications.channels.useQuery(undefined, { staleTime: 300_000 });
  const maps = trpc.maps.providers.useQuery(undefined, { staleTime: Infinity, retry: false });
  const tryOnOn = useFeature("tryOn");
  const running: Running = { email: mail.data?.email === true, tryOn: tryOnOn, drivingTimes: maps.data?.drivingTimes === true };
  const company = channels.data?.company ?? null;
  const operator = company ? nameInSentence(isArabic && company.nameAr ? company.nameAr : company.name) : null;

  const document = DOCUMENTS[page];
  const sections = document.sections;
  const title = t(document.title);
  const intro = operator ? t(document.intro, { operator, version: AGREEMENT_VERSION }) : t(document.plain, { version: AGREEMENT_VERSION });

  return (
    <PageBody>
      <Breadcrumbs trail={[{ label: title }]} />
      <PageHeading
        title={title}
        note={<>
          <p>{intro}</p>
          <p className="mt-1 text-[13px] ink-muted">{t("legal.updated", { date: formatDate(`${LEGAL_UPDATED}T12:00:00+03:00`) })}</p>
        </>}
      />
      <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
        <nav aria-label={t("legal.onThisPage")} className="hidden lg:block">
          <div className="sticky top-28">
            <p className="text-[13px] font-bold text-[#0a285a]">{t("legal.onThisPage")}</p>
            <ol className="mt-3 space-y-1 border-s border-[#e6e9ef]">
              {sections.map(section => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className="-ms-px block border-s-2 border-transparent py-1.5 ps-4 text-[14px] text-[#404553] hover:border-[#0a285a] hover:text-[#0a285a]">
                    {t(section.title)}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>
        <div className="max-w-[72ch]">
          {sections.map(section => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-32 border-t border-[#e6e9ef] py-6 first:border-t-0 first:pt-0">
              <h2 id={`${section.id}-title`} className="text-[18px] font-extrabold text-[#0a285a]">{t(section.title)}</h2>
              {section.body.filter(shown(running)).map(paragraph => (
                <p key={paragraph.key} className="mt-3 text-[15px] leading-7 text-[#404553]">
                  {t(paragraph.key, FIGURES)}
                </p>
              ))}
            </section>
          ))}
          <div className="mt-4 rounded-2xl bg-[#eef2f8] p-5">
            <p className="text-[15px] leading-7 text-[#0a285a]">{t("legal.questions")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/help" className="glass glass-navy pressable inline-flex h-11 items-center gap-2 rounded-full px-5">
                {t("legal.goToHelp")}<ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
              </Link>
              {page === "sellers" ? (
                <>
                  <Link href="/sell" className={BUTTON_PLAIN}>{t("footer.sellWithUs")}</Link>
                  <Link href="/terms" className={BUTTON_PLAIN}>{t("footer.terms")}</Link>
                </>
              ) : (
                <>
                  <Link href={page === "terms" ? "/privacy" : "/terms"} className={BUTTON_PLAIN}>
                    {t(page === "terms" ? "footer.privacy" : "footer.terms")}
                  </Link>
                  <Link href="/returns" className={BUTTON_PLAIN}>{t("footer.returns")}</Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageBody>
  );
}
