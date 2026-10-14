/**
 * "Ships tomorrow — arriving 27–29 September."
 *
 * Requirement 3.2.5. One component for every surface that says it, so the
 * product page, Quick View and the card cannot give three different answers
 * about the same thing — the argument `AvailabilityLine` already makes.
 *
 * **It is attributed.** NetLet has no carrier integration, so the band is the
 * seller's own statement and the line says so. A shop that presents a seller's
 * estimate as its own guarantee owns the complaint when it slips.
 *
 * **Nothing is drawn when nothing was stated.** A default band would be NetLet
 * promising on a seller's behalf, and "Delivery: unknown" is a row that costs
 * a line and answers nothing.
 */
import { Truck } from "lucide-react";
import { arrivalFor, type DeliverySpeed } from "@shared/commerce/deliverySpeed";
import type { MessageKey } from "@shared/i18n/dictionary";
import { SHOP_TIME_ZONE, useDateFormat } from "@/hooks/useDateFormat";
import { useTranslation } from "@/hooks/useTranslation";

export function DeliverySpeedLine({ speed, provider = null, area = null, className = "" }: {
  speed: DeliverySpeed | null;
  /** Who the seller ships with (3.4.13), when they named somebody. */
  provider?: string | null;
  /** The delivery area chosen in the header, named in the "get it by" line. */
  area?: string | null;
  className?: string;
}) {
  const { t, isArabic } = useTranslation();
  const formatDate = useDateFormat();
  /* "Wed 14 Oct": the weekday is the part somebody plans around. */
  const shortDay = (value: Date) => value.toLocaleDateString(isArabic ? "ar-KW-u-nu-latn" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: SHOP_TIME_ZONE });
  /* Nothing stated and nobody named is nothing to draw — a row reading
     "Delivery: unknown" costs a line and answers no question. */
  if (!speed && !provider) return null;

  const arrival = speed ? arrivalFor(speed) : null;
  const dates = arrival?.from && arrival.to
    /* One date when the window is a single day, rather than "27 – 27": a range
       with the same end twice reads as a mistake. */
    ? arrival.from.getTime() === arrival.to.getTime()
      ? t("speed.arrivesOne", { from: formatDate(arrival.from) })
      : t("speed.arrives", { from: formatDate(arrival.from), to: formatDate(arrival.to) })
    : null;

  /* The latest day of the seller's band, said as a date a shopper can plan on
     and to the area the header says they are in. */
  const getBy = arrival?.to
    ? area ? t("speed.getByTo", { date: shortDay(arrival.to), area }) : t("speed.getBy", { date: shortDay(arrival.to) })
    : null;

  return (
    <div className={className}>
    {getBy ? <p className="mb-1 text-[15px] font-bold text-[#2f5d33]">{getBy}</p> : null}
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="inline-flex items-center gap-1.5 font-bold text-[#0a285a]">
        <Truck className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden />
        {speed ? t(`speed.${speed}` as MessageKey) : t("product.shippedBy", { name: provider! })}
      </span>
      {/* The range only when there is no "get it by" above saying it already. */}
      {dates && !getBy ? <span className="ink-muted">{dates}</span> : null}
      {/* The carrier the seller named, when there is also a band to sit
          beside — never a tracking promise, which NetLet cannot keep. */}
      {speed && provider ? <span dir="auto" className="ink-muted">{t("product.shippedBy", { name: provider })}</span> : null}
      {speed ? <span className="text-[12px] ink-muted">{t("speed.bySeller")}</span> : null}
    </p>
    </div>
  );
}
