/**
 * Where each item of an opened order is, as a band under the item the width
 * of its row, on the owner's word ("it should be clear, showing status also
 * track order click to be understandable by clients", over a picture of the
 * small tile that sat under the photo, circled): **the picture, where it is
 * in bold, the four steps as a strip, when it comes, and at the band's end a
 * button saying what a press does** — Track order while a parcel holds it,
 * Rate once it has arrived and may be rated, Edit your review once it has
 * been. The
 * whole band is that button, so a thumb need not find the pill; with nothing
 * to do (cancelled, returned, an arrival that can be neither tracked nor
 * rated) it is the status alone.
 *
 * - **Being got ready** (received, being prepared, pre-ordered), NetLet's
 *   store with an amber disc turning on its corner, on a pale amber band.
 * - **On the way**, NetLet's van with its wheels turning, riding the bumps,
 *   speed lines behind it — facing the page's end, so the left on the Arabic
 *   page — on a pale sky band.
 * - **Delivered**, the house with a green tick, on a pale green band, the
 *   strip all green; Rate (a gold star) or the stars given and Edit.
 * - **Cancelled** or **returned**, its word on a pale red or slate band.
 *
 * It was a little street under each order on My orders, then a tile the
 * photo's width under the photo (a 36 by 30 plate and an 11px word), which
 * the owner found unclear. The strip is the tracker's own four steps, the
 * one the item is at in the brand's orange. The pictures are NetLet's own
 * drawing, so the van can turn its wheels. Transforms and opacities alone
 * (`.item-status` in `index.css`), still for somebody who asked for less
 * motion. `journeyStage` and `journeyStep` (`Shared/commerce/orderReceipt.ts`)
 * are the rule, and the app's `ItemStatusBar` the same band.
 */
import type { OrderProgress } from "@shared/commerce/orderProgress";
import { journeyStage, journeyStep } from "@shared/commerce/orderReceipt";
import { Check, ChevronDown, CircleX, RotateCcw, Star } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { useDateFormat } from "@/hooks/useDateFormat";

/** The order's own phrase for where it is, the row's words. */
export function useProgressPhrase() {
  const { t } = useTranslation();
  const formatDate = useDateFormat();
  return (progress: OrderProgress): string => {
    switch (progress.kind) {
      case "received": return t(progress.preordered ? "orders.progressPreordered" : "orders.progressReceived");
      case "preparing": return t("orders.progressPreparing");
      case "onTheWay": return t("orders.progressOnTheWay");
      case "partlyDelivered": return t("orders.progressPartly", { delivered: progress.delivered, of: progress.of });
      case "delivered": return progress.at ? t("orders.progressDeliveredOn", { date: formatDate(progress.at) }) : t("orders.progressDelivered");
      case "cancelled": return t("orders.progressCancelled");
      case "returned": return t("orders.progressReturned");
    }
  };
}

/** What the band shows: where the item is, or, once it has arrived, its review. */
type Look = "processing" | "onTheWay" | "delivered" | "rate" | "rated" | "cancelled" | "returned";

/** The whole stars a rating of one to five fills. */
const STARS = [1, 2, 3, 4, 5];
/** The strip's four steps: the order, being got ready, on the way, at the door. */
const STEPS = [0, 1, 2, 3];

export function ItemStatus({ progress, expected, rating, mayRate, title, track, onRate }: {
  /** The item's own progress (`orderProgress` over its one line). */
  progress: OrderProgress;
  /** When it comes, while it is still coming: the store's own words (the tracker's). */
  expected: { text: string; late: boolean } | null;
  /** The shopper's stars on it, once rated. */
  rating: number | null;
  /** Whether it may be rated now (`reviewEligibility`, the rule `reviews.write` refuses with). */
  mayRate: boolean;
  title: string;
  /** Where the item is, while a parcel holds it: the panel it opens under the item, and whether it is open. */
  track: { open: boolean; controls: string; onPress: () => void } | null;
  /** Opens the review: a new one, or the one written to change it. */
  onRate: () => void;
}) {
  const { t } = useTranslation();
  const phrase = useProgressPhrase()(progress);
  const stage = journeyStage(progress);
  const step = journeyStep(progress);
  const look: Look = stage === "delivered" ? (rating !== null ? "rated" : mayRate ? "rate" : "delivered") : stage;
  const act = look === "rate" ? "rate" : look === "rated" ? "edit" : track ? "track" : null;

  const picture = (() => {
    switch (look) {
      case "processing":
        return (
          <span className="item-status-place">
            <StoreArt />
            <span className="item-status-badge" data-kind="working"><span className="item-status-spinner" /></span>
          </span>
        );
      case "onTheWay":
        return (
          <span className="item-status-van">
            <span className="item-status-speed" />
            <span className="item-status-speed item-status-speed-late" />
            <VanArt />
          </span>
        );
      case "delivered":
      case "rate":
      case "rated":
        return (
          <span className="item-status-place">
            <HouseArt />
            <span className="item-status-badge" data-kind="arrived"><Check className="size-2.5" strokeWidth={3.5} /></span>
          </span>
        );
      case "cancelled":
        return <CircleX className="size-5" strokeWidth={2.2} />;
      case "returned":
        return <RotateCcw className="size-[18px] rtl:-scale-x-100" strokeWidth={2.4} />;
    }
  })();

  const inside = (
    <>
      <span className="flex min-w-0 flex-1 basis-40 items-center gap-3">
        <span aria-hidden className="item-status-plate">{picture}</span>
        <span className="min-w-0 flex-1">
          <span className="item-status-word">{phrase}</span>
          {step !== null ? (
            <span aria-hidden className="item-status-steps">
              {STEPS.map(index => (
                <span
                  key={index}
                  data-step={step === 3 ? "arrived" : index < step ? "done" : index === step ? "now" : "ahead"}
                />
              ))}
            </span>
          ) : null}
          {look === "rated" ? (
            <span aria-hidden className="item-status-stars">
              {STARS.map(star => (
                <Star key={star} className="size-3" strokeWidth={2.4} fill={star <= (rating ?? 0) ? "currentColor" : "none"} />
              ))}
            </span>
          ) : null}
          {expected && stage !== "delivered" ? <span className="item-status-when" data-late={expected.late ? "" : undefined}>{expected.text}</span> : null}
        </span>
      </span>
      {act === "track" ? (
        <span className="item-status-pill">
          {t("orders.track")}
          <ChevronDown aria-hidden className="item-status-chevron size-4" strokeWidth={2.6} data-open={track?.open ? "" : undefined} />
        </span>
      ) : act === "rate" ? (
        <span className="item-status-pill">
          <Star aria-hidden className="item-status-star size-4" strokeWidth={2.4} fill="currentColor" />
          {t("orders.pickRate")}
        </span>
      ) : act === "edit" ? (
        <span className="item-status-pill" data-quiet="">{t("review.edit")}</span>
      ) : null}
    </>
  );

  if (act === null) return <div className="item-status" data-look={look}>{inside}</div>;
  /* The whole band is the press; its name is what it says, then which item —
     several items' "Track order" are told apart by it. */
  return (
    <button
      type="button"
      data-look={look}
      onClick={act === "track" ? track?.onPress : onRate}
      aria-expanded={act === "track" ? track?.open ?? false : undefined}
      aria-controls={act === "track" ? track?.controls : undefined}
      className="item-status tint-on-hover"
    >
      {inside}
      <span className="sr-only">: {title}</span>
    </button>
  );
}

/*
 * The pictures, drawn for NetLet rather than taken from an icon set, so the
 * van can turn its wheels and the store can be NetLet's. All decorative: the
 * word under the plate says the same thing.
 */

/** NetLet's store: a navy roof line, an awning in the brand's orange, two windows and a door. */
function StoreArt() {
  return (
    <svg viewBox="0 0 44 44" fill="none">
      <rect x="7" y="16" width="30" height="25" rx="2.5" fill="#fff" stroke="#0a285a" strokeWidth="2" />
      <rect x="10" y="22" width="6" height="6" rx="1.2" fill="#dbe7fb" />
      <rect x="28" y="22" width="6" height="6" rx="1.2" fill="#dbe7fb" />
      <rect x="18" y="26" width="8" height="15" rx="1.5" fill="#dbe7fb" stroke="#0a285a" strokeWidth="1.6" />
      <circle cx="24" cy="34" r="0.9" fill="#0a285a" />
      <rect x="4" y="5" width="36" height="5" rx="2" fill="#0a285a" />
      {[0, 1, 2, 3, 4, 5].map(index => (
        <path key={index} d={`M${4 + index * 6} 10h6v6a3 3 0 0 1-6 0Z`} fill={index % 2 ? "#fff" : "#f2683a"} />
      ))}
      <path d="M4 10h36" stroke="#0a285a" strokeWidth="1" />
    </svg>
  );
}

/** The shopper's house, under the brand's own roof — the two bars of the logo. */
function HouseArt() {
  return (
    <svg viewBox="0 0 44 44" fill="none">
      <path d="M10 22v17.5a1.5 1.5 0 0 0 1.5 1.5h21a1.5 1.5 0 0 0 1.5-1.5V22" fill="#fff" stroke="#0a285a" strokeWidth="2" />
      <rect x="13" y="25" width="7" height="6.5" rx="1.2" fill="#dbe7fb" />
      <rect x="24.5" y="28" width="7" height="13" rx="1.4" fill="#0a285a" />
      <circle cx="30" cy="35" r="0.9" fill="#fff" />
      <path d="M5.5 23.5 22 8.5l16.5 15" stroke="#f2683a" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** NetLet's van, facing the page's end: navy with the brand's orange stripe, and wheels that turn. */
function VanArt() {
  return (
    <svg viewBox="0 0 52 30" fill="none">
      <g className="item-status-body">
        <rect x="2" y="3" width="32" height="19" rx="3.5" fill="#0a285a" />
        <rect x="2" y="13.5" width="32" height="3" fill="#f2683a" />
        <path d="M34.5 8.5h8.2a4 4 0 0 1 3.5 2.1l3.3 6.1a3 3 0 0 1 .5 1.6V21a2 2 0 0 1-2 2H34.5Z" fill="#0a285a" />
        <path d="M37 10.8h5.6a1.6 1.6 0 0 1 1.4.8l2.6 5.2H37Z" fill="#cfe0f5" />
        <rect x="47.3" y="18.3" width="2.4" height="2.2" rx="1" fill="#ffd66b" />
        <rect x="0.5" y="19" width="3" height="2" rx="0.8" fill="#3d5170" />
      </g>
      {[12, 40].map(cx => (
        <g key={cx} className="item-status-wheel">
          <circle cx={cx} cy="23.5" r="5.2" fill="#16181d" />
          <circle cx={cx} cy="23.5" r="2.6" fill="#dfe6f0" />
          <path d={`M${cx} 21.1v4.8M${cx - 2.1} 22.3l4.2 2.4M${cx - 2.1} 24.7l4.2-2.4`} stroke="#16181d" strokeWidth="0.9" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}
