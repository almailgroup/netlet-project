import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Pause, Play } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { readStored, writeStored } from "../storage.js";
import { countFor, parcelLoop, phasesFor, speedFor } from "../parcelLoop.js";
import type { Box, Loop } from "../parcelLoop.js";

/** Remembered on the device: somebody who paused the parcels finds them paused next time. */
const PAUSED_KEY = "shiplee:motion";
/** Everything in the band a parcel must keep clear of. */
const CONTENT = "h1, .hero-lead, .hero-card, .hero-ask, .hero-parcel";
const LESS_MOTION = "(prefers-reduced-motion: reduce)";

interface Layout {
  key: string;
  loop: Loop;
  width: number;
  height: number;
  count: number;
  duration: number;
}

/**
 * Parcels going round the home band, on the owner's word ("a smooth animation
 * of parcels going around"): a dotted road loops round the headline and the
 * tracking box, and parcels ride it, out along the bottom in the reading
 * direction and back along the top. The road is worked out from where the
 * words are (`parcelLoop`), so no parcel ever passes behind a word, and again
 * whenever the band changes size.
 *
 * Each parcel is moved by the browser's own animation of `transform`, which
 * runs off the page's main thread, so a busy page does not make it stutter.
 * It stops while the band is scrolled out of sight, never moves for somebody
 * who asked for less motion (the parcels stand still on the road instead),
 * and the button at the band's start corner pauses it for anybody (WCAG 2.2.2),
 * remembered on the device. All of it is for the eye alone.
 */
export function ParcelLoop({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const art = useRef<HTMLDivElement>(null);
  const parcels = useRef<(HTMLSpanElement | null)[]>([]);
  const animations = useRef<Animation[]>([]);
  /*
   * How far the whole set has turned, kept when the road is redrawn. One figure
   * rather than one per parcel: they all go at one speed, so each is its own
   * starting place plus this, and a redrawn road with one parcel more or fewer
   * spaces them evenly again rather than dropping the new one on an old one.
   */
  const turned = useRef(0);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [paused, setPaused] = useState(() => readStored(PAUSED_KEY) === "paused");
  const [inView, setInView] = useState(true);
  const lessMotion = useLessMotion();

  /* Measure the band and its words, and draw the road round them. */
  useLayoutEffect(() => {
    const band = art.current?.parentElement;
    if (!band) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const next = layoutFor(band);
      setLayout(previous => (previous?.key === next?.key ? previous : next));
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const resized = new ResizeObserver(soon);
    resized.observe(band);
    band.querySelectorAll(CONTENT).forEach(element => resized.observe(element));
    /* The language changing moves the words to the other side without resizing anything. */
    const switched = new MutationObserver(soon);
    switched.observe(document.documentElement, { attributes: true, attributeFilter: ["dir", "lang"] });
    void document.fonts?.ready.then(soon);
    return () => {
      resized.disconnect();
      switched.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  /* Nothing moves while the band is off the screen. */
  useEffect(() => {
    const band = art.current?.parentElement;
    if (!band || typeof IntersectionObserver === "undefined") return;
    const watcher = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? true));
    watcher.observe(band);
    return () => watcher.disconnect();
  }, []);

  /* Set each parcel on the road, where it had got to or at its starting place. */
  useEffect(() => {
    if (!layout) return;
    const phases = phasesFor(layout.count);
    const keyframes = layout.loop.points.map(point => ({ offset: point.at, transform: `translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px)` }));
    const started: Animation[] = [];
    parcels.current.slice(0, layout.count).forEach((parcel, index) => {
      if (!parcel || typeof parcel.animate !== "function") return;
      const animation = parcel.animate(keyframes, { duration: layout.duration, iterations: Infinity, easing: "linear" });
      animation.currentTime = ((((phases[index] ?? 0) + turned.current) % 1) + 1) % 1 * layout.duration;
      started.push(animation);
    });
    animations.current = started;
    return () => {
      const first = started[0];
      if (first) turned.current = (((Number(first.currentTime ?? 0) / layout.duration - (phases[0] ?? 0)) % 1) + 1) % 1;
      started.forEach(animation => animation.cancel());
      animations.current = [];
    };
  }, [layout]);

  const moving = !lessMotion && !paused && inView;
  useEffect(() => {
    for (const animation of animations.current) {
      if (moving) animation.play();
      else animation.pause();
    }
  }, [moving, layout]);

  const toggle = () => {
    const next = !paused;
    setPaused(next);
    writeStored(PAUSED_KEY, next ? "paused" : "moving");
  };
  const label = paused ? t("home.motionPlay") : t("home.motionPause");

  return (
    <>
      <div ref={art} className="loop-art" data-still={moving ? undefined : ""} aria-hidden="true">
        {layout ? (
          <>
            <svg className="loop-road" viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none" focusable="false">
              <path d={layout.loop.d} />
            </svg>
            {Array.from({ length: layout.count }, (_, index) => (
              <span key={index} className="loop-parcel" data-look={index % 3} data-beat={index % 4} ref={element => { parcels.current[index] = element; }}>
                <SmallParcel look={index % 3} />
              </span>
            ))}
          </>
        ) : null}
      </div>
      {children}
      {layout && !lessMotion ? (
        <button type="button" className="loop-toggle" aria-label={label} title={label} onClick={toggle}>
          {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
        </button>
      ) : null}
    </>
  );
}

/** The band's size, where its words are, and the road round them; null when no road fits. */
function layoutFor(band: HTMLElement): Layout | null {
  const frame = band.getBoundingClientRect();
  const boxes = [...band.querySelectorAll(CONTENT)].map(element => element.getBoundingClientRect()).filter(box => box.width > 0 && box.height > 0);
  if (!boxes.length || frame.width <= 0 || frame.height <= 0) return null;
  const content: Box = {
    left: Math.min(...boxes.map(box => box.left)) - frame.left,
    top: Math.min(...boxes.map(box => box.top)) - frame.top,
    right: Math.max(...boxes.map(box => box.right)) - frame.left,
    bottom: Math.max(...boxes.map(box => box.bottom)) - frame.top,
  };
  const style = getComputedStyle(band);
  const parcel = Number.parseFloat(style.getPropertyValue("--loop-parcel")) || 22;
  const rtl = style.direction === "rtl";
  const width = Math.round(frame.width);
  const height = Math.round(frame.height);
  const loop = parcelLoop({ width, height, content, parcel, rtl });
  if (!loop) return null;
  const key = [width, height, Math.round(content.left), Math.round(content.top), Math.round(content.right), Math.round(content.bottom), parcel, rtl].join(" ");
  return { key, loop, width, height, count: countFor(loop.length, width), duration: (loop.length / speedFor(width)) * 1000 };
}

function useLessMotion(): boolean {
  const [less, setLess] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(LESS_MOTION).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(LESS_MOTION);
    const changed = () => setLess(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  return less;
}

/**
 * One parcel, in the drawing's own language: the band's large parcel at a
 * tenth of its size, three faces and a white edge, with tape (look 0), an
 * address label (look 1) or both (look 2, a smaller box), so the road carries
 * a mix rather than one box repeated. The shade stays on the road while the
 * box sways above it.
 */
function SmallParcel({ look }: { look: number }) {
  return (
    <>
      {/* Each drawing in a span: the sway animates the span, which the browser can hand to the compositor; an SVG element it cannot. */}
      <span className="loop-shade">
        <svg viewBox="0 0 32 32" focusable="false">
          <ellipse cx="16" cy="26.5" rx="10.5" ry="2.6" />
        </svg>
      </span>
      <span className="loop-box">
        <svg viewBox="0 0 32 32" focusable="false">
          <path d="M16 2 L28 8 L16 14 L4 8 Z" fill="currentColor" fillOpacity="0.26" />
          <path d="M4 8 L16 14 L16 25 L4 19 Z" fill="currentColor" fillOpacity="0.1" />
          <path d="M16 14 L28 8 L28 19 L16 25 Z" fill="currentColor" fillOpacity="0.17" />
          {look !== 1 ? (
            <path d="M9.9 4.9 L21.9 10.8 L24 9.8 L12 3.9 Z M21.9 10.8 L24 9.8 L24 21.3 L21.9 22.3 Z" fill="currentColor" fillOpacity="0.55" />
          ) : null}
          {look !== 0 ? <path d="M6.4 14 L12.7 17.2 L12.7 20.7 L6.4 17.5 Z" fill="currentColor" fillOpacity="0.85" /> : null}
          <path d="M16 2 L28 8 L28 19 L16 25 L4 19 L4 8 Z M4 8 L16 14 L28 8 M16 14 L16 25" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </span>
    </>
  );
}
