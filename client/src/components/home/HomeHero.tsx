/**
 * The front door: a navy panel with NetLet's own street on it, one line saying
 * what the shop is, the three facts every order carries, and two ways in.
 *
 * The home page opened on a slogan once ("Small upgrades. A brighter
 * everyday.") over blurred colour blobs, and it went because it was words where
 * a shopper looks for something to tap. This is the opposite arrangement: the
 * line is short, the facts beside it are the shop's own rules (delivery to
 * every governorate, cash at the door, `RETURN_WINDOW_DAYS`), and both buttons
 * go somewhere with something in it — today's deals only while the home page
 * draws a Deals shelf (`shelvesFor`), the new arrivals otherwise, so the first
 * press never lands on a half-empty page.
 *
 * Nothing moves. The picture is the sign-in panel's (`streetImage`), so the
 * shop's door looks the same wherever a shopper meets it; its edges are the
 * panel's navy, and a gradient on the words' side fades it in, mirrored on the
 * Arabic page so the words always sit on the dark side. With no picture the
 * panel is its words alone.
 */
import { ALL_DEPARTMENTS } from "@shared/commerce/departments";
import { categorySlug } from "@shared/commerce/browse";
import { RETURN_WINDOW_DAYS } from "@shared/commerce/returns";
import { ArrowRight, RotateCcw, Truck, Wallet } from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "@/hooks/useTranslation";
import { streetImage } from "@/lib/brandAssets";

export function HomeHero({ dealsDrawn }: { dealsDrawn: boolean }) {
  const { t } = useTranslation();
  const facts = [
    { icon: Truck, label: t("checkout.builtForKuwait") },
    { icon: Wallet, label: t("home.payOnDelivery") },
    { icon: RotateCcw, label: t("home.returnsWithin", { days: RETURN_WINDOW_DAYS }) },
  ];
  return (
    <section aria-labelledby="home-hero-title" className="container pt-4 sm:pt-6">
      <div className="relative grid overflow-hidden rounded-[22px] bg-[#0a285a] text-white sm:rounded-[28px] lg:min-h-[420px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="relative z-10 flex flex-col justify-center px-5 pb-7 pt-1 sm:px-10 sm:pb-10 lg:px-14 lg:py-12">
          {/* The page's heading: the shop's name for a screen reader's outline,
              then the line everybody reads. */}
          <h1 id="home-hero-title" className="max-w-[15ch] text-[30px] font-extrabold leading-[1.08] tracking-[-.02em] sm:text-[40px] lg:text-[46px]">
            <span className="sr-only">{t("home.heading")}: </span>
            {t("home.heroTitle")} <span className="text-[#f2683a]">{t("home.heroTitleAccent")}</span>
          </h1>
          <p className="mt-3 max-w-[46ch] text-[15px] leading-6 text-[#c9d4e2] sm:mt-4 sm:text-[17px] sm:leading-7">{t("home.heroNote")}</p>
          {/* A short list on a phone, where three pills wrapped to three
              lines anyway; pills from `sm` up, where they sit in a row. */}
          <ul className="mt-4 grid gap-1.5 sm:mt-6 sm:flex sm:flex-wrap sm:gap-2">
            {facts.map(fact => (
              <li key={fact.label} className="inline-flex items-center gap-2 text-[13px] font-semibold sm:gap-1.5 sm:rounded-full sm:border sm:border-white/15 sm:bg-white/[.08] sm:px-3 sm:py-1.5">
                <fact.icon className="size-3.5 shrink-0 text-[#ffab85]" aria-hidden />{fact.label}
              </li>
            ))}
          </ul>
          {/* Side by side while both fit on one line, each the whole width
              once they do not — the words never wrap inside a button. */}
          <div className="mt-5 flex flex-wrap gap-3 sm:mt-7">
            <Link
              href={dealsDrawn ? "/category/all?offer=1&sort=discount" : "/category/all?sort=newest"}
              className="inline-flex h-12 flex-[1_0_auto] items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#f2683a] px-5 tint-on-hover text-[15px] font-bold text-[#0a285a] sm:flex-none sm:px-6"
            >
              {t(dealsDrawn ? "home.heroDeals" : "home.heroNew")}
              <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </Link>
            <Link
              href={`/category/${categorySlug(ALL_DEPARTMENTS.query)}`}
              className="inline-flex h-12 flex-[1_0_auto] items-center justify-center whitespace-nowrap rounded-full border-[1.5px] border-white/40 px-5 text-[15px] font-bold text-white transition-colors hover:bg-white/[.12] sm:flex-none sm:px-6"
            >
              {t(ALL_DEPARTMENTS.label)}
            </Link>
          </div>
        </div>

        {streetImage ? (
          <div className="relative order-first h-[200px] sm:h-[280px] lg:order-none lg:h-auto">
            {/* The page's largest paint, so it is fetched first. Decorative: the
                words beside it say what the shop is. */}
            <img
              src={streetImage}
              alt=""
              loading="eager"
              fetchPriority="high"
              decoding="async"
              className="absolute inset-0 size-full object-cover object-[center_60%]"
            />
            {/* Fades the picture into the navy on the words' side: below it on
                a phone, beside it from `lg`, from the start edge in either
                direction. */}
            <span aria-hidden className="absolute inset-0 bg-[linear-gradient(0deg,#0a285a_0%,rgba(10,40,90,0)_45%)] lg:bg-[linear-gradient(90deg,#0a285a_0%,rgba(10,40,90,0)_30%)] lg:rtl:bg-[linear-gradient(270deg,#0a285a_0%,rgba(10,40,90,0)_30%)]" />
          </div>
        ) : null}
        {/* The orange of the logo's roof, as the panel's foot. */}
        <span aria-hidden className="absolute inset-x-0 bottom-0 z-10 h-1.5 bg-[#f2683a]" />
      </div>
    </section>
  );
}
