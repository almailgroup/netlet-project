/**
 * The front door: NetLet's pictures the width of the screen, fading into the
 * page.
 *
 * **It carries no words, on the owner's word** ("remove the Kuwait's stores,
 * one cart text with the text below it"): it had that line, the shop's name
 * before it for a screen reader, and a sentence under it; the line and the
 * sentence went, and the band is the pictures alone — on a wide screen the
 * whole width, no longer a half beside the words. The page's `h1` is still
 * here, the shop's name, for a screen reader's outline and nobody's eye.
 *
 * The home page opened on a slogan once ("Small upgrades. A brighter
 * everyday.") over blurred colour blobs, and it went because it was words where
 * a shopper looks for something to tap. This is the opposite arrangement: the
 * line is short, and what is tapped is directly under it — the departments.
 * **It carries no buttons, on the owner's word**: it had two ("See what's new"
 * or "Today's deals", and "All departments"), which said again what the rows
 * under the band already offer. The three facts every order carries (every
 * governorate, cash at the door, the return window) sat under the line as a
 * list for a while; the owner asked for them gone, and they are still said at
 * checkout and on the sign-in page.
 *
 * **The pictures are a slideshow, on the owner's word** (`heroSlides`: the
 * street, then `Frontend/Web/src/assets/hero/` in name order). A picture stays `SLIDE_MS` — three seconds, the owner's figure
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
 * read as the same surface continuing. **On a wide screen the fade is under
 * the pictures, not on them, and the pictures are a rounded frame on the
 * page's column** — both on the owner's word: the band was the whole window
 * wide and 460px tall, so a 1600px picture was stretched and cut to a strip. It is eased (`.hero-foot` in `index.css`), on the owner's word: a straight
 * gradient starts at a visible line and lingers in a slate grey halfway, and
 * an eased one leaves the navy and arrives at the page without either.
 */
import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useTranslation } from "@/hooks/useTranslation";
import { heroSlides } from "@/lib/brandAssets";

/** How long each picture stays before the next fades in. */
export const SLIDE_MS = 3000;

export function HomeHero() {
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
      {/* The page's heading, for a screen reader's outline: the band shows
          pictures and no words. */}
      <h1 id="home-hero-title" className="sr-only">{t("home.heading")}</h1>
      {slides.length ? (
        /* On a wide screen the pictures sit in a rounded frame on the page's
           own column, 3:1 and at most 500px tall, rather than across the whole
           window: a 1600px picture stretched to a 1900px screen and cropped to
           a strip was blurred and lost most of its height. The frame is at most
           the column's 1616px, so a 16:9 picture is drawn at its own size or
           smaller. */
        <div className="lg:mx-auto lg:max-w-[1680px] lg:px-8 lg:pt-6">
        <div className="relative h-[240px] sm:h-[340px] lg:aspect-[3/1] lg:h-auto lg:max-h-[500px] lg:w-full lg:overflow-hidden lg:rounded-[28px] lg:shadow-[0_22px_48px_-28px_rgba(0,0,0,.65)]">
          {/* Decorative: the shop's name is the heading above. */}
          <div aria-hidden className="absolute inset-0">
            {slides.map(({ src, phone, wide }, slide) => fetched.has(slide) ? (
              <picture key={src}>
                {/* A phone's band is 390px wide; its copy is half the bytes. */}
                {phone ? <source media="(max-width: 640px)" srcSet={phone} /> : null}
                {/* A wide screen's frame is up to 1616px across; a large copy
                    keeps it sharp there, on a Retina screen too. */}
                {wide ? <source media="(min-width: 1024px)" srcSet={wide} /> : null}
                <img
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
              </picture>
            ) : null)}
          </div>

        </div>
        </div>
      ) : null}

      {/* The foot: the band into the page's own background, so it ends without
          an edge. On a phone and a tablet it lies over the pictures' foot, its
          first fifth all but clear; on a wide screen it is under the frame,
          on the owner's word ("make the fade below the banner, not on it"),
          so nothing is drawn over a picture. */}
      <span aria-hidden className="hero-foot pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-24 sm:h-28 lg:hidden" />
      <span aria-hidden className="hero-foot pointer-events-none hidden h-24 lg:block" />
    </section>
  );
}
