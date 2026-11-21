/**
 * Where an order is, drawn under it on My orders, on the owner's word ("for
 * the products shown in the orders page, a design for their status of
 * delivery below them — if it's on the way, a delivery icon animation to the
 * house; if it's still processing, a processing animation — simple for the
 * user to understand").
 *
 * One road from the store's box to the shopper's house, with three words
 * under it — Processing, On the way, Delivered — and the stage it is at
 * moving: the box turns over while it is got ready, the van drives the road
 * toward the house while it is on the way (the road filling behind it), and
 * the house takes a tick once it has arrived. The word under the stage it is
 * at is the order's own phrase ("Being prepared", "2 of 3 delivered",
 * "Delivered 12 Oct"). An order that left the road — cancelled, returned —
 * has no road, only its word.
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
import { Check, CircleX, House, Package, RotateCcw, Truck } from "lucide-react";
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
      {/* The road: the box at its start, the house at its end, the van on it. */}
      <div aria-hidden className="relative flex h-11 items-center">
        <span className="journey-stop journey-box">
          <span className="journey-ring" />
          <Package className="journey-box-icon size-[18px]" strokeWidth={2.2} />
          {at > 0 ? <span className="journey-tick"><Check className="size-2.5" strokeWidth={3.5} /></span> : null}
        </span>
        <span className="journey-road">
          <span className="journey-fill" />
          {stage !== "delivered" ? (
            <span className="journey-van">
              <Truck className="size-[18px] rtl:-scale-x-100" strokeWidth={2.2} />
            </span>
          ) : null}
        </span>
        <span className="journey-stop journey-house">
          <House className="size-[18px]" strokeWidth={2.2} />
          {stage === "delivered" ? <span className="journey-tick"><Check className="size-2.5" strokeWidth={3.5} /></span> : null}
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
