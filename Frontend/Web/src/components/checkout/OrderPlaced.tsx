/**
 * The moment an order exists — on the owner's word ("for the order
 * confirmation, add a sound and animation for it"). It is drawn over checkout
 * rather than being a page of its own, so the shopper is still where they
 * confirmed, and leaves by their own press: View your order, or Continue
 * shopping. Escape views the order, which is where checkout used to land.
 *
 * A navy disc springs in, a ring spreads from it and fades, the tick draws
 * itself and a burst of the brand's colours flies out and falls away; the
 * words rise in after. The sound (`playOrderChime`) is struck as it opens, its
 * bells timed to the tick. Every piece is a transform, an opacity or a
 * stroke's dash, so nothing beside it moves, and under reduced motion all of
 * it is drawn finished — the tick, the words and the buttons, no burst.
 *
 * The whole screen on a phone, on the page's pearl; a card over the dim from
 * `sm`. Focus goes to View your order as it opens.
 */
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { ArrowRight } from "lucide-react";
import { useEffect, useId, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";

/* The burst: where each piece flies to, how it turns, its shape and colour.
   Fixed rather than random, so every order looks the same and a picture of
   it can be compared with the last. */
const BITS: { angle: number; reach: number; turn: number; shape: "dot" | "bar"; colour: string }[] = [
  { angle: -90, reach: 96, turn: 160, shape: "bar", colour: "#f2683a" },
  { angle: -62, reach: 84, turn: -120, shape: "dot", colour: "#0a285a" },
  { angle: -35, reach: 104, turn: 200, shape: "bar", colour: "#f5b83d" },
  { angle: -8, reach: 88, turn: -180, shape: "dot", colour: "#f2683a" },
  { angle: 18, reach: 100, turn: 140, shape: "bar", colour: "#9db3d6" },
  { angle: 44, reach: 86, turn: -150, shape: "dot", colour: "#0a285a" },
  { angle: 70, reach: 98, turn: 220, shape: "bar", colour: "#f2683a" },
  { angle: 96, reach: 82, turn: -100, shape: "dot", colour: "#f5b83d" },
  { angle: 122, reach: 102, turn: 180, shape: "bar", colour: "#0a285a" },
  { angle: 148, reach: 88, turn: -210, shape: "dot", colour: "#9db3d6" },
  { angle: 174, reach: 100, turn: 130, shape: "bar", colour: "#f2683a" },
  { angle: 200, reach: 84, turn: -160, shape: "dot", colour: "#0a285a" },
  { angle: 226, reach: 104, turn: 190, shape: "bar", colour: "#f5b83d" },
  { angle: 252, reach: 90, turn: -140, shape: "dot", colour: "#f2683a" },
];

export function OrderPlaced({ reference, total, onView, onShop }: {
  reference: string;
  /** What the driver collects, formatted. */
  total: string;
  onView: () => void;
  onShop: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const bodyId = useId();
  const viewRef = useRef<HTMLButtonElement>(null);
  useOverlay(true, onView);
  useEffect(() => {
    const timer = window.setTimeout(() => viewRef.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(timer);
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-[#f3f2ed] sm:bg-[#061b3b]/55 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="flex h-full w-full flex-col items-center justify-center overflow-y-auto bg-[#f3f2ed] px-6 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-10 text-center text-[#0a285a] sm:h-auto sm:max-w-[440px] sm:rounded-3xl sm:bg-[#fffdf9] sm:px-8 sm:py-9 sm:shadow-[0_24px_60px_rgba(10,40,90,.28)]"
      >
        <div aria-hidden className="relative grid size-28 place-items-center">
          {BITS.map((bit, index) => {
            const radians = (bit.angle * Math.PI) / 180;
            const style = {
              "--dx": `${Math.round(Math.cos(radians) * bit.reach)}px`,
              "--dy": `${Math.round(Math.sin(radians) * bit.reach)}px`,
              "--rot": `${bit.turn}deg`,
              backgroundColor: bit.colour,
            } as CSSProperties;
            return (
              <span
                key={index}
                style={style}
                className={`order-done-bit absolute left-1/2 top-1/2 ${bit.shape === "bar" ? "-ml-[3px] -mt-[6px] h-3 w-1.5 rounded-[2px]" : "-ml-1 -mt-1 size-2 rounded-full"}`}
              />
            );
          })}
          <span className="order-done-ring absolute inset-0 rounded-full border-[3px] border-[#f2683a]" />
          <span className="order-done-disc grid size-24 place-items-center rounded-full bg-[#0a285a] shadow-[0_14px_30px_-12px_rgba(10,40,90,.6)]">
            <svg viewBox="0 0 24 24" className="size-12" fill="none">
              <path d="M6.5 12.5 L10.5 16.5 L17.5 8.5" pathLength={1} className="order-done-tick" stroke="#ffffff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>

        <h2 id={titleId} className="order-done-rise mt-7 text-[26px] font-extrabold leading-8" style={{ "--delay": "380ms" } as CSSProperties}>
          {t("checkout.doneTitle")}
        </h2>
        <p id={bodyId} className="order-done-rise mt-2 max-w-[22rem] text-[15px] leading-6 text-[#404553]" style={{ "--delay": "460ms" } as CSSProperties}>
          {t("checkout.doneBody")}
        </p>
        <div className="order-done-rise mt-5 w-full max-w-[22rem] rounded-2xl border border-[#e6e9ef] bg-white px-4 py-3.5" style={{ "--delay": "540ms" } as CSSProperties}>
          <p className="text-[12px] font-semibold leading-4 text-[#536b8c]">{t("checkout.doneNumber")}</p>
          <p className="mt-1 select-all text-[20px] font-extrabold tracking-wide"><bdi dir="ltr">{reference}</bdi></p>
          <p className="mt-2 border-t border-[#eef1f5] pt-2 text-[14px] leading-5 text-[#404553]">{t("checkout.donePay", { amount: total })}</p>
        </div>
        <div className="order-done-rise mt-6 grid w-full max-w-[22rem] gap-2.5" style={{ "--delay": "620ms" } as CSSProperties}>
          <button
            ref={viewRef}
            type="button"
            onClick={onView}
            className="pressable flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#0a285a] px-5 text-[15px] font-bold text-white hover:bg-[#0d3372]"
          >
            {t("checkout.doneView")}
            <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onShop}
            className="glass pressable flex h-12 w-full items-center justify-center rounded-2xl border border-[#d5dfeb] text-[15px] font-bold text-[#0a285a]"
          >
            {t("header.continueShopping")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
