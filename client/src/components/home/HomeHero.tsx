/**
 * The front door: a navy band the width of the screen with NetLet's pictures
 * on it, one line saying what the shop is, the three facts every order
 * carries, and two ways in.
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
 * **The pictures are a slideshow, on the owner's word** (`heroSlides`: the
 * street, then `client/src/assets/hero/` in name order). Only the pictures
 * change; the words and the buttons hold still, so nothing a shopper is
 * reading moves. A picture stays `SLIDE_MS` — three seconds, the owner's figure
 * — and the band carries no controls, also on the owner's word: it had dots
 * and a Pause button, and they asked for it to change by itself and nothing
 * else. It still waits while the band is off screen or the tab hidden, and
 * while the keyboard is in it (`:focus-visible`, so a click on a link does
 * not stop it), which is what remains of WCAG 2.2.2's way to stop moving
 * content; a resting mouse no longer holds it, since a pointer left on a big
 * band read as a slideshow that had broken. Nobody who asked for less motion
 * is shown it moving at all. One picture is a still.
 *
 * **The next picture fades in over the last**, which stays whole underneath
 * until it is covered: fading one out while the other fades in let the navy
 * through at the midpoint, a dip in every change. And it is not shown until it
 * has loaded and decoded — a slide that fades in while it is still arriving
 * pops in at the end of the fade, which on a phone on a slow connection was
 * the whole transition.
 *
 * **The band fades into the page** rather than ending on a line: its foot runs
 * from the navy into the page's own background, so the departments below
 * read as the same surface continuing. The words sit above the fade.
 */
import { ALL_DEPARTMENTS } from "@shared/commerce/departments";
import { categorySlug } from "@shared/commerce/browse";
import { RETURN_WINDOW_DAYS } from "@shared/commerce/returns";
import { ArrowRight, RotateCcw, Truck, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useTranslation } from "@/hooks/useTranslation";
import { heroSlides } from "@/lib/brandAssets";

/** How long each picture stays before the next fades in. */
export const SLIDE_MS = 3000;

export function HomeHero({ dealsDrawn }: { dealsDrawn: boolean }) {
  const { t } = useTranslation();
  const slides = heroSlides;
  const many = slides.length > 1;
  const [index, setIndex] = useState(0);
  /* The picture being covered, which stays whole under the one fading in. */
  const [previous, setPrevious] = useState<number | null>(null);
  /* A picture is fetched once it is about to be shown, never all at once. */
  const [fetched, setFetched] = useState(() => new Set([0, 1]));
  /* Loaded and decoded, so its fade has a picture to fade. */
  const [ready, setReady] = useState<ReadonlySet<number>>(() => new Set());
  /* The current picture has had its time; the next waits only on loading. */
  const [due, setDue] = useState(false);
  const [held, setHeld] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const stillWanted = useMediaQuery("(prefers-reduced-motion: reduce)");
  const bandRef = useRef<HTMLElement>(null);

  const show = (next: number) => {
    const wrapped = (next + slides.length) % slides.length;
    setPrevious(index);
    setIndex(wrapped);
    setDue(false);
    setFetched(before => new Set([...before, wrapped, (wrapped + 1) % slides.length]));
  };
  const markReady = (slide: number) => setReady(before => before.has(slide) ? before : new Set(before).add(slide));
  const onLoaded = (slide: number, image: HTMLImageElement) => {
    /* Decoded off the main thread before it is faded in, so the fade does
       not stall on the first frame that draws it. */
    void image.decode().catch(() => undefined).finally(() => markReady(slide));
  };

  /* Off screen or in a hidden tab, nobody is watching it change. */
  useEffect(() => {
    const band = bandRef.current;
    if (!many || !band) return;
    let visible = true;
    let tabShown = document.visibilityState === "visible";
    const apply = () => setOnScreen(visible && tabShown);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; apply(); });
    observer?.observe(band);
    const onTab = () => { tabShown = document.visibilityState === "visible"; apply(); };
    document.addEventListener("visibilitychange", onTab);
    return () => { observer?.disconnect(); document.removeEventListener("visibilitychange", onTab); };
  }, [many]);

  const running = many && !held && onScreen && !stillWanted;
  const upcoming = (index + 1) % slides.length;
  useEffect(() => {
    if (!running) { setDue(false); return; }
    const timer = window.setTimeout(() => setDue(true), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [running, index]);
  useEffect(() => {
    if (running && due && ready.has(upcoming)) show(upcoming);
    /* `show` reads the index, which `upcoming` already follows. */
  }, [running, due, ready, upcoming]);

  const facts = [
    { icon: Truck, label: t("checkout.builtForKuwait") },
    { icon: Wallet, label: t("home.payOnDelivery") },
    { icon: RotateCcw, label: t("home.returnsWithin", { days: RETURN_WINDOW_DAYS }) },
  ];

  return (
    <section
      ref={bandRef}
      aria-labelledby="home-hero-title"
      className="relative isolate overflow-hidden bg-[#0a285a] text-white"
      onFocus={event => { if ((event.target as Element).matches(":focus-visible")) setHeld(true); }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false); }}
    >
      {slides.length ? (
        <div className="relative h-[220px] sm:h-[300px] lg:absolute lg:inset-y-0 lg:end-0 lg:h-auto lg:w-[56%]">
          {/* Decorative: the words beside them say what the shop is. */}
          <div aria-hidden className="absolute inset-0">
            {slides.map((src, slide) => fetched.has(slide) ? (
              <img
                key={src}
                src={src}
                alt=""
                loading="eager"
                fetchPriority={slide === 0 ? "high" : "low"}
                decoding="async"
                ref={image => { if (image?.complete && image.naturalWidth) markReady(slide); }}
                onLoad={event => onLoaded(slide, event.currentTarget)}
                /* The first picture is simply there — fading in the page's
                   largest picture would hold back its largest paint. */
                className={`absolute inset-0 size-full object-cover object-[center_60%] ${
                  slide === index ? `z-[2] opacity-100${previous === null ? "" : " hero-slide-in"}`
                  : slide === previous ? "z-[1] opacity-100"
                  : "opacity-0"
                }`}
              />
            ) : null)}
            {/* Into the navy on the words' side: below the pictures on a
                phone, beside them from `lg`, from the start edge in either
                direction. */}
            <span className="absolute inset-0 z-[3] bg-[linear-gradient(0deg,#0a285a_0%,rgba(10,40,90,0)_45%)] lg:bg-[linear-gradient(90deg,#0a285a_0%,rgba(10,40,90,0)_35%)] lg:rtl:bg-[linear-gradient(270deg,#0a285a_0%,rgba(10,40,90,0)_35%)]" />
          </div>

        </div>
      ) : null}

      <div className="container relative z-10 pb-24 pt-1 sm:pb-28 lg:flex lg:min-h-[480px] lg:items-center lg:pb-36 lg:pt-12">
        <div className="max-w-[600px]">
          {/* The page's heading: the shop's name for a screen reader's outline,
              then the line everybody reads. */}
          <h1 id="home-hero-title" className="max-w-[15ch] text-[30px] font-extrabold leading-[1.08] tracking-[-.02em] sm:text-[40px] lg:text-[48px]">
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
      </div>

      {/* The foot: from the navy into the page's own background, over the
          pictures as well, so the band ends without an edge. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-20 bg-[linear-gradient(180deg,rgba(10,40,90,0)_0%,var(--background)_100%)] sm:h-24 lg:h-32" />
    </section>
  );
}
