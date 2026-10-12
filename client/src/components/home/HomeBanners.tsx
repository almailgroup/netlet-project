/**
 * The home page's paid banners (3.3.15): a store's picture and headline,
 * booked by the day on `/admin/ads` and approved by NetLet before it runs.
 *
 * **It never moves on its own.** Arrows and a swipe, nothing on a timer — the
 * reason the header stopped folding and the cards stopped cycling their
 * photographs: motion in the corner of the eye while somebody reads, and a
 * slide that leaves before it has been read. One banner at a time, 3:1, the
 * shape every banner is cropped to when it is booked.
 *
 * **Disclosed on every slide.** "Sponsored" and the store's name under each
 * picture, for the reason the sponsored shelf repeats it on every card: a
 * slide is screenshotted on its own.
 *
 * **Absent rather than empty.** With nothing approved and running today the
 * read is empty and nothing is drawn — there is no house banner standing in
 * for one, and a failed read draws nothing either.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";

export function HomeBanners() {
  const { t, locale } = useTranslation();
  const query = trpc.ads.banners.useQuery({ locale }, { staleTime: 60_000, retry: false });
  const banners = query.data ?? [];
  const track = useRef<HTMLUListElement>(null);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const list = track.current;
    if (!list) return;
    /* scrollLeft runs negative in a right-to-left page; the slide is how far along, whichever way. */
    const measure = () => setShown(Math.round(Math.abs(list.scrollLeft) / Math.max(1, list.clientWidth)));
    measure();
    list.addEventListener("scroll", measure, { passive: true });
    return () => list.removeEventListener("scroll", measure);
  }, [banners.length]);

  if (banners.length === 0) return null;

  const go = (index: number) => {
    const list = track.current;
    if (!list) return;
    const rtl = getComputedStyle(list).direction === "rtl";
    list.scrollTo({ left: (rtl ? -1 : 1) * index * list.clientWidth, behavior: "smooth" });
  };
  const several = banners.length > 1;
  const arrowClass = "glass-white pressable absolute top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-[#0a285a] disabled:opacity-0";

  return (
    <section className="container pt-2 sm:pt-4" aria-roledescription={t("ads.carousel")} aria-labelledby="home-banners-title">
      <h2 id="home-banners-title" className="sr-only">{t("ads.bannersTitle")}</h2>
      <div className="relative">
        <ul ref={track} className="hide-scrollbar flex snap-x snap-mandatory overflow-x-auto rounded-2xl border border-[#e1e7ef] bg-white">
          {banners.map((banner, index) => (
            <li
              key={banner.id}
              className="w-full shrink-0 snap-start"
              aria-roledescription={t("ads.slide")}
              aria-label={several ? t("ads.slideOf", { index: index + 1, total: banners.length }) : undefined}
            >
              <Link href={`/products/${banner.productHandle}`} className="block">
                <img src={banner.imageUrl} alt={banner.headline} loading="lazy" decoding="async" className="aspect-[3/1] w-full bg-[#f3f2ed] object-cover" />
                <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 sm:px-5">
                  <span dir="auto" className="min-w-0 text-[14px] font-bold text-[#0a285a] sm:text-[15px]">{banner.headline}</span>
                  <span className="text-[12px] ink-muted">{t("ads.sponsored")}{banner.storeName ? <> · <bdi>{banner.storeName}</bdi></> : null}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {several ? (
          <>
            {/* Over the picture, never the caption: the arrows sit in the 3:1 box. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 aspect-[3/1]">
              <button type="button" onClick={() => go(shown - 1)} disabled={shown === 0} aria-label={t("ads.previousBanner")} title={t("ads.previousBanner")} className={`${arrowClass} pointer-events-auto start-2 sm:start-3`}>
                <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden />
              </button>
              <button type="button" onClick={() => go(shown + 1)} disabled={shown >= banners.length - 1} aria-label={t("ads.nextBanner")} title={t("ads.nextBanner")} className={`${arrowClass} pointer-events-auto end-2 sm:end-3`}>
                <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
              </button>
            </div>
            <p className="mt-1.5 text-center text-[12px] ink-muted" aria-live="polite">{t("ads.slideOf", { index: shown + 1, total: banners.length })}</p>
          </>
        ) : null}
      </div>
    </section>
  );
}
