/**
 * Where each item of an opened order is, drawn under its photo, on the
 * owner's word ("delivery status should shown here — once it shown
 * delivered, then review icon will appear out here"): **a row the photo's
 * width, the small picture at its start and the word after it**, also on the
 * owner's word ("the delivery details down picture left and status right as
 * my drawing", with the photo made larger) — it was a plate with the word
 * under it.
 *
 * - **Being got ready** (received, being prepared, pre-ordered), NetLet's
 *   store with an amber disc turning on its corner.
 * - **On the way**, NetLet's van with its wheels turning, riding the bumps,
 *   speed lines behind it — facing the page's end, so the left on the Arabic
 *   page.
 * - **Delivered**, a star to press and rate it, once it may be rated; the
 *   stars given and "Edit" once it has been; the house with a green tick when
 *   it can be neither.
 * - **Cancelled** or **returned**, its word on a plate of its own.
 *
 * It was a little street drawn under each order on My orders, then under
 * each item, and the owner moved it here: an order's items arrive on
 * different days, and the row's empty corner under the photo is where a
 * shopper looks. The pictures are still the street's own, drawn for NetLet
 * rather than taken from an icon set, so the van can turn its wheels.
 * Transforms and opacities alone (`.item-status` in `index.css`), still for
 * somebody who asked for less motion. `journeyStage`
 * (`Shared/commerce/orderReceipt.ts`) is the rule, and the app's
 * `ItemStatusTile` the same drawing.
 */
import type { OrderProgress } from "@shared/commerce/orderProgress";
import { journeyStage } from "@shared/commerce/orderReceipt";
import { Check, CircleX, RotateCcw, Star } from "lucide-react";
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

/** What the plate shows: where the item is, or, once it has arrived, its review. */
type Look = "processing" | "onTheWay" | "delivered" | "rate" | "rated" | "cancelled" | "returned";

/** The whole stars a rating of one to five fills. */
const STARS = [1, 2, 3, 4, 5];

export function ItemStatus({ progress, rating, mayRate, title, onRate }: {
  /** The item's own progress (`orderProgress` over its one line). */
  progress: OrderProgress;
  /** The shopper's stars on it, once rated. */
  rating: number | null;
  /** Whether it may be rated now (`reviewEligibility`, the rule `reviews.write` refuses with). */
  mayRate: boolean;
  title: string;
  /** Opens the review: a new one, or the one written to change it. */
  onRate: () => void;
}) {
  const { t } = useTranslation();
  const phrase = useProgressPhrase()(progress);
  const stage = journeyStage(progress);
  const look: Look = stage === "delivered" ? (rating !== null ? "rated" : mayRate ? "rate" : "delivered") : stage;

  const word = look === "rate" ? t("orders.pickRate")
    : look === "rated" ? t("profile.edit")
    : look === "delivered" ? t("orders.journeyDelivered")
    : phrase;

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
        return (
          <span className="item-status-place">
            <HouseArt />
            <span className="item-status-badge" data-kind="arrived"><Check className="size-2" strokeWidth={3.5} /></span>
          </span>
        );
      case "rate":
        return <Star className="item-status-star size-4" strokeWidth={2.2} />;
      case "rated":
        return (
          <span className="item-status-stars">
            {STARS.map(star => (
              <Star key={star} className="size-[7px]" strokeWidth={2.6} fill={star <= (rating ?? 0) ? "currentColor" : "none"} />
            ))}
          </span>
        );
      case "cancelled":
        return <CircleX className="size-4" strokeWidth={2.2} />;
      case "returned":
        return <RotateCcw className="size-3.5 rtl:-scale-x-100" strokeWidth={2.4} />;
    }
  })();

  const inside = (
    <>
      <span aria-hidden className="item-status-plate">{picture}</span>
      <span className="item-status-word">{word}</span>
    </>
  );

  // Delivered: the plate is the review's button, its name starting with the word drawn.
  if (look === "rate" || look === "rated") {
    return (
      <button
        type="button"
        onClick={onRate}
        data-look={look}
        aria-label={look === "rate" ? t("review.dialogTitle", { name: title }) : t("review.edit")}
        className="item-status rounded-[10px]"
      >
        {inside}
      </button>
    );
  }
  return <span className="item-status" data-look={look}>{inside}</span>;
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
