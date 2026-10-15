/**
 * A card's photographs, browsable where the card is — on the owner's word.
 *
 * Seeing a product's second photo used to mean opening the product. Now the
 * card's photo is a row of them: a finger swipes it, a mouse gets an arrow at
 * each side while it rests on the card, and a row of dots says how many there
 * are and which one is showing. Nothing moves on its own — the photographs
 * cycled by themselves once, and that is what the card stopped doing.
 *
 * It is the browser's own sideways scroll with snap points, so a swipe has the
 * phone's own feel and momentum, Arabic runs it the other way with no code of
 * its own, and a swipe that ends in a scroll is never taken for a tap on the
 * link around it. Each photo is clipped in its own frame, or the hover zoom on
 * one would spill over the next.
 *
 * **Only the first photo is fetched with the page.** A card in a grid is seen
 * far more often than it is browsed, so the next photo is drawn once a pointer
 * or a finger reaches the card, and each one after it once the one before is
 * showing — eager rather than lazy, because a photo off to the side of a
 * scroller is one the browser's lazy loading may never think is near.
 *
 * **The arrows are for a mouse, and not for the keyboard or a screen reader.**
 * The photo link they sit beside is already hidden from both (the title is the
 * card's one link), and two more stops on every card would double the stops in
 * a grid; somebody on a keyboard reaches every photo, a press away, in the
 * preview and on the product page. So the arrows take no focus — not even from
 * the click that presses them — and the dots are drawn for the eye alone.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "wouter";
import { Thumb } from "@/components/product/Thumb";
import { useTranslation } from "@/hooks/useTranslation";
import type { Image } from "@shared/commerce/types";

/** The most a card offers; a product with more shows the rest on its page. */
export const CARD_PHOTOS = 5;

export function CardGallery({ images, href, title, frameClassName, photoClassName }: {
  images: Image[];
  href: string;
  title: string;
  /** The frame's shape and ground: the card's square, or the feature's 2:1. */
  frameClassName: string;
  /** How a photo fills the frame: cropped, or contained on white. */
  photoClassName: string;
}) {
  const { t } = useTranslation();
  const photos = images.slice(0, CARD_PHOTOS);
  const many = photos.length > 1;
  const scroller = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const [index, setIndex] = useState(0);
  /* The furthest photo shown so far; the one after it is drawn too. */
  const [reached, setReached] = useState(0);
  const [warm, setWarm] = useState(false);

  const showing = (next: number) => {
    setIndex(next);
    setReached(previous => Math.max(previous, next));
  };

  /* Which photo is in the frame, read off the scroll once a frame. The
     magnitude, because an Arabic page scrolls the other way, below zero. */
  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const box = scroller.current;
      if (!box || !box.clientWidth) return;
      showing(Math.min(photos.length - 1, Math.round(Math.abs(box.scrollLeft) / box.clientWidth)));
    });
  };

  const go = (step: number) => {
    const box = scroller.current;
    if (!box) return;
    const target = Math.max(0, Math.min(photos.length - 1, index + step));
    setWarm(true);
    setReached(previous => Math.max(previous, target));
    const backwards = getComputedStyle(box).direction === "rtl" ? -1 : 1;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ left: backwards * target * box.clientWidth, behavior: still ? "instant" : "smooth" });
  };

  const drawn = (at: number) => at === 0 || (warm && at <= reached + 1);

  return (
    <div className="relative" onPointerEnter={many ? () => setWarm(true) : undefined}>
      <Link href={href} tabIndex={-1} aria-hidden="true" className={`block overflow-hidden rounded-xl ${frameClassName}`}>
        <div
          ref={scroller}
          tabIndex={-1}
          onScroll={many ? onScroll : undefined}
          className={many ? "hide-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain" : undefined}
        >
          {photos.length ? photos.map((photo, at) => (
            <div key={`${photo.url}-${at}`} className="w-full shrink-0 snap-start snap-always overflow-hidden">
              {drawn(at)
                /* Named, though the link around it is hidden from a screen
                   reader: the alt is what image search reads, and what a
                   checker counts. */
                ? <Thumb src={photo.url} alt={photo.altText || title} eager={at > 0} className={`product-card-photo w-full ${photoClassName}`} />
                : <div className={`w-full ${photoClassName}`} />}
            </div>
          )) : (
            <div className={`grid place-items-center px-3 text-center text-[12px] font-semibold ink-muted ${photoClassName}`}>{t("product.imageProcessing")}</div>
          )}
        </div>
      </Link>

      {many ? (
        <>
          {index > 0 ? (
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              onMouseDown={event => event.preventDefault()}
              onClick={() => go(-1)}
              className="glass glass-white reveal-control absolute start-1.5 top-1/2 size-8 -translate-y-1/2 place-items-center rounded-full"
            >
              <ChevronLeft className="size-4 rtl:-scale-x-100" />
            </button>
          ) : null}
          {index < photos.length - 1 ? (
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              onMouseDown={event => event.preventDefault()}
              onClick={() => go(1)}
              className="glass glass-white reveal-control absolute end-1.5 top-1/2 size-8 -translate-y-1/2 place-items-center rounded-full"
            >
              <ChevronRight className="size-4 rtl:-scale-x-100" />
            </button>
          ) : null}
          <div aria-hidden="true" className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-white/85 px-1.5 py-1">
            {photos.map((photo, at) => (
              <span
                key={`${photo.url}-${at}`}
                className={`h-1.5 rounded-full transition-[width,background-color] duration-200 ${at === index ? "w-3 bg-[#0a285a]" : "w-1.5 bg-[#0a285a]/30"}`}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
