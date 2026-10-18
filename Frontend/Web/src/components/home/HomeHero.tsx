/**
 * The front door: a navy band the width of the screen with NetLet's pictures
 * on it, one line saying what the shop is, and two ways in.
 *
 * The home page opened on a slogan once ("Small upgrades. A brighter
 * everyday.") over blurred colour blobs, and it went because it was words where
 * a shopper looks for something to tap. This is the opposite arrangement: the
 * line is short and both buttons go somewhere with something in it — today's
 * deals only while the home page
 * draws a Deals shelf (`shelvesFor`), the new arrivals otherwise, so the first
 * press never lands on a half-empty page. The three facts every order carries
 * (every governorate, cash at the door, the return window) sat under the line
 * as a list for a while; the owner asked for them gone, and they are still
 * said at checkout and on the sign-in page.
 *
 * **The pictures are a slideshow, on the owner's word** (`heroSlides`: the
 * street, then `Frontend/Web/src/assets/hero/` in name order). Only the pictures
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
 * read as the same surface continuing. The words sit above the fade. It is
 * eased (`.hero-foot` in `index.css`), on the owner's word: a straight
 * gradient starts at a visible line and lingers in a slate grey halfway, and
 * an eased one leaves the navy and arrives at the page without either.
 */
import { ALL_DEPARTMENTS } from "@shared/commerce/departments";
import { categorySlug } from "@shared/commerce/browse";
import { ArrowRight } from "lucide-react";
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
            <span className="hero-shade absolute inset-0 z-[3]" />
          </div>

        </div>
      ) : null}

      <div className="container relative z-10 pb-32 pt-1 sm:pb-36 lg:flex lg:min-h-[480px] lg:items-center lg:pb-40 lg:pt-12">
        <div className="max-w-[600px]">
          {/* The page's heading: the shop's name for a screen reader's outline,
              then the line everybody reads. */}
          <h1 id="home-hero-title" className="max-w-[15ch] text-[30px] font-extrabold leading-[1.08] tracking-[-.02em] sm:text-[40px] lg:text-[48px]">
            <span className="sr-only">{t("home.heading")}: </span>
            {t("home.heroTitle")} <span className="text-[#f2683a]">{t("home.heroTitleAccent")}</span>
          </h1>
          <p className="mt-3 max-w-[46ch] text-[15px] leading-6 text-[#c9d4e2] sm:mt-4 sm:text-[17px] sm:leading-7">{t("home.heroNote")}</p>
          {/* Side by side while both fit on one line, each the whole width
              once they do not — the words never wrap inside a button. */}
          <div className="mt-5 flex flex-wrap gap-3 sm:mt-6">
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
          pictures as well, so the band ends without an edge. Taller than the
          room under the buttons, because its first fifth is all but clear. */}
      <span aria-hidden className="hero-foot pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-36 sm:h-40 lg:h-48" />
    </section>
  );
}
