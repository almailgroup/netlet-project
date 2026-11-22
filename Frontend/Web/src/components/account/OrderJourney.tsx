/**
 * Where an order is, drawn under it on My orders, on the owner's word ("for
 * the products shown in the orders page, a design for their status of
 * delivery below them — if it's on the way, a delivery icon animation to the
 * house; if it's still processing, a processing animation — simple for the
 * user to understand").
 *
 * A little street drawn under each order, and made richer on the owner's
 * word ("high quality animations and icons … an animation for its tires
 * running, going to its destination"): NetLet's store at the road's start,
 * the shopper's house at its end, the van on the road between, and three
 * words under it — Processing, On the way, Delivered.
 *
 * - **Being got ready**, the van waits outside the store with its engine
 *   running — a shiver in its body, puffs from its exhaust — and parcels hop
 *   from the store's door into its back, the van dipping as each lands; a
 *   small amber disc turns on the store's corner.
 * - **On the way**, it drives the road to the house: its wheels turning, its
 *   body riding the bumps, puffs and speed lines behind it and the road
 *   filling navy, while a pin bobs over the house and its window is lit.
 * - **Delivered**, the van has gone and the parcel is at the door; the road
 *   and the house's tick are green, and a burst goes off round the house
 *   once.
 *
 * The word under the stage it is at is the order's own phrase ("Being
 * prepared", "2 of 3 delivered", "Delivered 12 Oct"). An order that left the
 * road — cancelled, returned — has no road, only its word.
 *
 * The stages are an ordered list with the current one marked
 * (`aria-current="step"`), so a screen reader hears where it is among the
 * three; the road and the van are pictures and hidden from it. Nothing moves
 * for somebody who asked for less motion: the van then stands half-way.
 * `journeyStage` (`Shared/commerce/orderReceipt.ts`) is the rule, and the
 * app's `OrderJourney` the same drawing.
 */
import type { OrderProgress } from "@shared/commerce/orderProgress";
import { journeyStage } from "@shared/commerce/orderReceipt";
import type { MessageKey } from "@shared/i18n/dictionary";
import { Check, CircleX, RotateCcw } from "lucide-react";
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

const STAGES: { key: "processing" | "onTheWay" | "delivered"; label: MessageKey }[] = [
  { key: "processing", label: "orders.journeyProcessing" },
  { key: "onTheWay", label: "orders.journeyOnTheWay" },
  { key: "delivered", label: "orders.journeyDelivered" },
];

export function OrderJourney({ progress }: { progress: OrderProgress }) {
  const { t } = useTranslation();
  const phrase = useProgressPhrase()(progress);
  const stage = journeyStage(progress);

  if (stage === "cancelled" || stage === "returned") {
    const Icon = stage === "cancelled" ? CircleX : RotateCcw;
    return (
      <p className={`journey-ended inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-bold ${stage === "cancelled" ? "bg-[#fdeceb] text-[#8c2f22]" : "bg-[#e7edf5] text-[#3d5170]"}`}>
        <Icon className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden />
        {phrase}
      </p>
    );
  }

  const at = STAGES.findIndex(entry => entry.key === stage);
  return (
    <div className="order-journey" data-stage={stage}>
      {/* The street: drawn left to right, mirrored whole on the Arabic page. */}
      <div aria-hidden className="journey-scene">
        <span className="journey-place journey-store">
          <StoreArt />
          {stage === "processing" ? (
            <span className="journey-badge journey-working"><span className="journey-spinner" /></span>
          ) : (
            <span className="journey-badge"><Check className="size-2.5" strokeWidth={3.5} /></span>
          )}
        </span>
        <span className="journey-road">
          <span className="journey-lane" />
          <span className="journey-fill" />
          {stage === "processing" ? (
            <>
              <span className="journey-parcel journey-hop"><ParcelArt /></span>
              <span className="journey-parcel journey-hop journey-hop-late"><ParcelArt /></span>
            </>
          ) : null}
          {stage !== "delivered" ? (
            <span className="journey-van">
              <span className="journey-speed journey-speed-one" />
              <span className="journey-speed journey-speed-two" />
              <span className="journey-puff" />
              <span className="journey-puff journey-puff-two" />
              <span className="journey-puff journey-puff-three" />
              <VanArt />
            </span>
          ) : null}
        </span>
        <span className="journey-place journey-house">
          {stage === "onTheWay" ? <span className="journey-pin"><PinArt /></span> : null}
          <HouseArt />
          {stage === "delivered" ? (
            <>
              <span className="journey-doorstep"><ParcelArt /></span>
              <span className="journey-burst">
                {Array.from({ length: 8 }, (_, index) => <span key={index} style={{ rotate: `${index * 45}deg` }} />)}
              </span>
              <span className="journey-badge journey-arrived"><Check className="size-2.5" strokeWidth={3.5} /></span>
            </>
          ) : null}
        </span>
      </div>
      {/* The three words, the current one the order's own phrase. */}
      <ol className="mt-1.5 grid grid-cols-3 gap-2 text-[12px] leading-4" aria-label={t("orders.journeyLabel")}>
        {STAGES.map((entry, index) => (
          <li
            key={entry.key}
            aria-current={index === at ? "step" : undefined}
            className={`${index === 0 ? "text-start" : index === 2 ? "text-end" : "text-center"} ${index === at ? "font-extrabold text-[#0a285a]" : index < at ? "font-semibold text-[#3d5170]" : "font-semibold ink-muted"}`}
          >
            {index === at ? phrase : t(entry.label)}
          </li>
        ))}
      </ol>
    </div>
  );
}

/*
 * The pictures, drawn for this street rather than taken from an icon set, so
 * the van can turn its wheels and the store can be NetLet's. All decorative:
 * the words under the road say the same thing.
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
      <rect className="journey-window" x="13" y="25" width="7" height="6.5" rx="1.2" fill="#dbe7fb" />
      <rect x="24.5" y="28" width="7" height="13" rx="1.4" fill="#0a285a" />
      <circle cx="30" cy="35" r="0.9" fill="#fff" />
      <path d="M5.5 23.5 22 8.5l16.5 15" stroke="#f2683a" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** NetLet's van, facing the house: navy with the brand's orange stripe, and wheels that turn. */
function VanArt() {
  return (
    <svg viewBox="0 0 52 30" fill="none">
      <g className="journey-body">
        <rect x="2" y="3" width="32" height="19" rx="3.5" fill="#0a285a" />
        <rect x="2" y="13.5" width="32" height="3" fill="#f2683a" />
        <path d="M34.5 8.5h8.2a4 4 0 0 1 3.5 2.1l3.3 6.1a3 3 0 0 1 .5 1.6V21a2 2 0 0 1-2 2H34.5Z" fill="#0a285a" />
        <path d="M37 10.8h5.6a1.6 1.6 0 0 1 1.4.8l2.6 5.2H37Z" fill="#cfe0f5" />
        <rect x="47.3" y="18.3" width="2.4" height="2.2" rx="1" fill="#ffd66b" />
        <rect x="0.5" y="19" width="3" height="2" rx="0.8" fill="#3d5170" />
      </g>
      {[12, 40].map(cx => (
        <g key={cx} className="journey-wheel">
          <circle cx={cx} cy="23.5" r="5.2" fill="#16181d" />
          <circle cx={cx} cy="23.5" r="2.6" fill="#dfe6f0" />
          <path d={`M${cx} 21.1v4.8M${cx - 2.1} 22.3l4.2 2.4M${cx - 2.1} 24.7l4.2-2.4`} stroke="#16181d" strokeWidth="0.9" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}

/** A parcel in kraft card with its tape. */
function ParcelArt() {
  return (
    <svg viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2.5" width="12" height="10.5" rx="1.6" fill="#d9a066" stroke="#8a5a2b" strokeWidth="1" />
      <path d="M1 6h12" stroke="#8a5a2b" strokeWidth="0.8" />
      <rect x="5.6" y="2.5" width="2.8" height="10.5" fill="#f2683a" />
    </svg>
  );
}

/** Where it is going: a pin in the brand's orange. */
function PinArt() {
  return (
    <svg viewBox="0 0 16 20" fill="none">
      <path d="M8 19s6.5-6.2 6.5-11A6.5 6.5 0 0 0 1.5 8c0 4.8 6.5 11 6.5 11Z" fill="#f2683a" stroke="#0a285a" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="2.4" fill="#fff" />
    </svg>
  );
}
