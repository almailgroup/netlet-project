/**
 * One product photo, full screen, to zoom into — on the owner's word.
 *
 * On a phone a press on the product's photo opens all of them in a list, and a
 * press on one there opens it here: the whole screen and nothing else. White,
 * not a photo app's black, because product photographs are shot on white —
 * on black each one was a white box with the product in it. Two fingers pinch it closer or further, a double
 * tap goes to 2.5× at the spot tapped and back, one finger moves it about once
 * it is bigger than the screen, and a sideways swipe at its own size goes to
 * the next photo. The buttons do the same for anybody who cannot pinch, and
 * the keyboard does too: arrows step or pan, + and − zoom, Escape closes.
 *
 * **The zoom is about the fingers, not the middle.** A pinch keeps the point
 * of the photo that was under the fingers under them while it grows, the way
 * every phone's photo viewer behaves; zooming about the centre made a pinch
 * on a label's corner push that corner off the screen. The photo moves only
 * as far as it hangs over the screen (`clamp`), so a drag never ends on an
 * empty black square.
 *
 * It sits over the list it was opened from (`useOverlay` closes only the top
 * one), and Escape or Close goes back to that list with focus on the photo it
 * came from. The stage owns its gestures (`touch-action: none`), so a pinch
 * never zooms the page behind instead.
 */
import { Thumb } from "@/components/product/Thumb";
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import type { ProductMedia } from "@shared/commerce/types";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from "lucide-react";
import { clampPan, panAbout, type Point } from "@/lib/zoomMath";
import { useEffect, useRef, useState } from "react";

export const MAX_ZOOM = 4;
/** Where a double tap or the first press of + takes the photo. */
export const TAP_ZOOM = 2.5;
/** Horizontal travel, in px, that is a swipe rather than a tap. */
const SWIPE = 45;
/** Two taps this close in time and place are one double tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
const PAN_STEP = 60;

export function ZoomViewer({ items, index, title, onIndex, onClose }: {
  items: ProductMedia[];
  index: number;
  title: string;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const { t, direction } = useTranslation();
  useOverlay(true, onClose);
  const closeButton = useRef<HTMLButtonElement>(null);
  /* Declared after `useOverlay`, so the opener it records is the photo in the
     list rather than this button. */
  useEffect(() => closeButton.current?.focus(), []);

  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  /*
   * The view is read from a ref as well as drawn from state: a gesture's next
   * move can arrive before React has drawn the last one, and a pinch reading a
   * scale one frame old jumps.
   */
  const [view, setView] = useState<{ scale: number; pan: Point }>({ scale: 1, pan: { x: 0, y: 0 } });
  const live = useRef(view);
  const show = (next: { scale: number; pan: Point }) => { live.current = next; setView(next); };
  const { scale, pan } = view;
  const [moving, setMoving] = useState(false);
  const item = items[index] ?? items[0];
  const many = items.length > 1;

  /* A new photo starts whole and centred. */
  useEffect(() => { show({ scale: 1, pan: { x: 0, y: 0 } }); }, [index]);

  const sizes = () => {
    const box = stage.current;
    const photo = frame.current;
    return {
      stage: { width: box?.clientWidth ?? 0, height: box?.clientHeight ?? 0 },
      photo: { width: photo?.offsetWidth ?? 0, height: photo?.offsetHeight ?? 0 },
    };
  };
  /** A point on the screen, measured from the stage's centre. */
  const fromCentre = (x: number, y: number): Point => {
    const box = stage.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: x - (box.left + box.width / 2), y: y - (box.top + box.height / 2) };
  };
  const settle = (nextScale: number, nextPan: Point) => {
    const bounded = Math.min(MAX_ZOOM, Math.max(1, nextScale));
    const { stage: box, photo } = sizes();
    show({ scale: bounded, pan: bounded === 1 ? { x: 0, y: 0 } : clampPan(nextPan, bounded, photo, box) });
  };
  const zoomAt = (to: number, at: Point = { x: 0, y: 0 }) => {
    const now = live.current;
    settle(to, panAbout(at, now.pan, now.scale, Math.min(MAX_ZOOM, Math.max(1, to))));
  };

  const step = (by: 1 | -1) => {
    if (!many) return;
    onIndex((index + by + items.length) % items.length);
  };

  /*
   * Every finger on the stage, by pointer id, and what the gesture under way
   * started from. Two fingers are a pinch; one is a pan once zoomed, and a
   * swipe or a tap at the photo's own size.
   */
  const fingers = useRef(new Map<number, Point>());
  const gesture = useRef<
    | { kind: "pinch"; distance: number; scale: number; pan: Point; under: Point }
    | { kind: "one"; start: Point; pan: Point; at: number }
    | null
  >(null);
  const lastTap = useRef<{ at: number; point: Point } | null>(null);

  const pinchFrom = () => {
    const [a, b] = [...fingers.current.values()];
    const mid = fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2);
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), mid };
  };

  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button, video")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const now = live.current;
    if (fingers.current.size === 2) {
      const { distance, mid } = pinchFrom();
      /* The photo's own point under the fingers, which the pinch keeps there. */
      gesture.current = { kind: "pinch", distance, scale: now.scale, pan: now.pan, under: { x: (mid.x - now.pan.x) / now.scale, y: (mid.y - now.pan.y) / now.scale } };
      setMoving(true);
    } else if (fingers.current.size === 1) {
      gesture.current = { kind: "one", start: { x: event.clientX, y: event.clientY }, pan: now.pan, at: performance.now() };
      if (now.scale > 1) setMoving(true);
    }
  };

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!fingers.current.has(event.pointerId)) return;
    fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const now = gesture.current;
    if (!now) return;
    const { stage: box, photo } = sizes();
    if (now.kind === "pinch" && fingers.current.size >= 2) {
      const { distance, mid } = pinchFrom();
      const to = Math.min(MAX_ZOOM, Math.max(1, now.scale * (distance / Math.max(1, now.distance))));
      show({ scale: to, pan: clampPan({ x: mid.x - now.under.x * to, y: mid.y - now.under.y * to }, to, photo, box) });
    } else if (now.kind === "one" && live.current.scale > 1) {
      const at = live.current.scale;
      show({ scale: at, pan: clampPan({ x: now.pan.x + event.clientX - now.start.x, y: now.pan.y + event.clientY - now.start.y }, at, photo, box) });
    }
  };

  const up = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!fingers.current.has(event.pointerId)) return;
    fingers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const now = gesture.current;
    if (fingers.current.size === 1 && now?.kind === "pinch") {
      /* One finger lifted from a pinch: the other carries on as a pan from
         where the photo is now, rather than jumping back to where it began. */
      const [rest] = [...fingers.current.values()];
      gesture.current = { kind: "one", start: rest, pan: live.current.pan, at: 0 };
      if (live.current.scale <= 1) settle(1, { x: 0, y: 0 });
      return;
    }
    if (fingers.current.size > 0) return;
    gesture.current = null;
    setMoving(false);
    if (now?.kind !== "one") return;

    const dx = event.clientX - now.start.x;
    const dy = event.clientY - now.start.y;
    const still = Math.hypot(dx, dy) < 10;
    if (live.current.scale <= 1 && !still && Math.abs(dx) >= SWIPE && Math.abs(dx) > Math.abs(dy)) {
      /* Pulling the next photo in: leftwards in English, rightwards in Arabic. */
      const forward = direction === "rtl" ? dx > 0 : dx < 0;
      step(forward ? 1 : -1);
      return;
    }
    if (!still || (now.at && performance.now() - now.at > 400)) return;
    const point = fromCentre(event.clientX, event.clientY);
    const before = lastTap.current;
    if (before && performance.now() - before.at < DOUBLE_TAP_MS && Math.hypot(point.x - before.point.x, point.y - before.point.y) < DOUBLE_TAP_PX) {
      lastTap.current = null;
      if (live.current.scale > 1) settle(1, { x: 0, y: 0 });
      else zoomAt(TAP_ZOOM, point);
      return;
    }
    lastTap.current = { at: performance.now(), point };
  };

  const cancel = (event: React.PointerEvent<HTMLDivElement>) => {
    fingers.current.delete(event.pointerId);
    if (!fingers.current.size) { gesture.current = null; setMoving(false); }
  };

  /*
   * A mouse wheel zooms at the pointer — a tablet with a trackpad reaches this
   * viewer too. A listener of its own rather than React's, which is passive
   * and so cannot keep the wheel from scrolling the list underneath. Safari's
   * own gesture events are refused for the pinch's reason.
   */
  const onWheel = useRef<(event: WheelEvent) => void>(() => {});
  onWheel.current = (event: WheelEvent) => {
    event.preventDefault();
    zoomAt(live.current.scale * Math.exp(-event.deltaY * 0.002), fromCentre(event.clientX, event.clientY));
  };
  useEffect(() => {
    const box = stage.current;
    if (!box) return;
    const wheel = (event: WheelEvent) => onWheel.current(event);
    const refuse = (event: Event) => event.preventDefault();
    box.addEventListener("wheel", wheel, { passive: false });
    box.addEventListener("gesturestart", refuse);
    box.addEventListener("gesturechange", refuse);
    return () => {
      box.removeEventListener("wheel", wheel);
      box.removeEventListener("gesturestart", refuse);
      box.removeEventListener("gesturechange", refuse);
    };
  }, []);

  const keys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomAt(live.current.scale + 0.5); return; }
    if (event.key === "-") { event.preventDefault(); zoomAt(live.current.scale - 0.5); return; }
    const arrows: Record<string, Point> = { ArrowLeft: { x: PAN_STEP, y: 0 }, ArrowRight: { x: -PAN_STEP, y: 0 }, ArrowUp: { x: 0, y: PAN_STEP }, ArrowDown: { x: 0, y: -PAN_STEP } };
    const by = arrows[event.key];
    if (!by) return;
    event.preventDefault();
    const now = live.current;
    if (now.scale > 1) {
      const { stage: box, photo } = sizes();
      show({ scale: now.scale, pan: clampPan({ x: now.pan.x + by.x, y: now.pan.y + by.y }, now.scale, photo, box) });
    } else if (by.x) {
      /* The arrow that points onward on this page: right in English, left in Arabic. */
      const onward = direction === "rtl" ? by.x > 0 : by.x < 0;
      step(onward ? 1 : -1);
    }
  };

  const disc = "tint-on-hover grid size-11 place-items-center rounded-full bg-[#0a285a]/[.06] text-[#0a285a] disabled:opacity-35";
  const arrow = "absolute top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white text-[#0a285a] shadow-[0_2px_12px_rgba(10,40,90,.18)] hover:bg-[#f0f2f5]";

  return (
    <div role="dialog" aria-modal="true" aria-label={t("product.zoomViewer", { name: title })} className="fixed inset-0 z-[95] flex flex-col bg-white text-[#0a285a]">
      <div className="flex items-center justify-between gap-3 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <span className="min-w-11 px-2 text-[14px] font-bold" aria-live="polite">
          {many ? <bdi dir="ltr">{index + 1} / {items.length}</bdi> : null}
        </span>
        <button ref={closeButton} type="button" onClick={onClose} aria-label={t("product.closeZoom")} className={disc}>
          <X className="size-6" aria-hidden />
        </button>
      </div>

      <div
        ref={stage}
        tabIndex={0}
        role="group"
        aria-label={t("product.zoomStage")}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onKeyDown={keys}
        className={`relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden outline-none ${scale > 1 ? (moving ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"}`}
      >
        <div
          ref={frame}
          className="flex max-h-full max-w-full"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            /* Nothing eased under a finger: a picture that lags behind the
               hand moving it reads as a slow phone. A double tap or a button
               glides. */
            transition: moving ? "none" : "transform 200ms ease-out",
          }}
        >
          {item?.kind === "video" ? (
            <video src={item.url} poster={item.posterUrl ?? undefined} controls playsInline preload="metadata" className="max-h-[calc(100dvh-9rem)] max-w-full object-contain" />
          ) : (
            <Thumb key={item?.url} src={item?.url} alt={item?.altText ?? title} priority draggable={false} className="max-h-[calc(100dvh-9rem)] max-w-full object-contain" />
          )}
        </div>
        {/* Only while the photo is whole: zoomed, a finger moves the photo
            rather than the gallery, and two discs over the picture are in
            the way of what is being looked at. Solid, because a tint over a
            photograph disappears into it. */}
        {many && scale <= 1 ? (
          <>
            <button type="button" onClick={() => step(-1)} aria-label={t("product.prevImage")} className={`${arrow} start-2`}>
              <ChevronLeft className="size-6 rtl:-scale-x-100" aria-hidden />
            </button>
            <button type="button" onClick={() => step(1)} aria-label={t("product.nextImage")} className={`${arrow} end-2`}>
              <ChevronRight className="size-6 rtl:-scale-x-100" aria-hidden />
            </button>
          </>
        ) : null}
      </div>

      <div className="flex items-center justify-center gap-3 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={() => zoomAt(scale - 0.5)} disabled={scale <= 1 || item?.kind === "video"} aria-label={t("product.zoomOut")} className={disc}>
          <ZoomOut className="size-5" aria-hidden />
        </button>
        <p className="min-w-0 flex-1 text-center text-[13px] font-semibold ink-muted">
          {t(scale > 1 ? "product.zoomDrag" : "product.zoomHint")}
        </p>
        <button type="button" onClick={() => zoomAt(scale <= 1 ? TAP_ZOOM : scale + 0.5)} disabled={scale >= MAX_ZOOM || item?.kind === "video"} aria-label={t("product.zoomIn")} className={disc}>
          <ZoomIn className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
