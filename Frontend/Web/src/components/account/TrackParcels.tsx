/**
 * Where the parcels on the road are (3.4.3), inside an open order.
 *
 * Asked again every twenty seconds while the order is open, which is what makes
 * the estimate move; it stops when the order is closed or the tab is hidden,
 * because React Query does not refetch an unmounted or background query.
 *
 * Every answer is said in words as well as drawn: the band and where it came
 * from (Apple's driving time, or the distance), when the position was
 * reported, and — when there is no position — that the driver is not sharing,
 * rather than an empty map that reads as broken.
 */
import { Truck } from "lucide-react";
import { TrackMap } from "@/components/map/TrackMap";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";

const POLL_MS = 20_000;

export function TrackParcels({ reference }: { reference: string }) {
  const { t } = useTranslation();
  const tracking = trpc.orders.tracking.useQuery({ reference }, { refetchInterval: POLL_MS, refetchIntervalInBackground: false, retry: false });
  const parcels = tracking.data ?? [];
  if (parcels.length === 0) return null;

  return (
    <section aria-label={t("tracking.title")} className="mt-4 space-y-3">
      {parcels.map((parcel, index) => {
        const minutesAgo = parcel.recordedAt ? Math.max(0, Math.round((Date.now() - new Date(parcel.recordedAt).getTime()) / 60_000)) : null;
        return (
          <div key={index} className="rounded-2xl border border-[#d5dfeb] bg-white p-4 text-[12px] text-[#0a285a]">
            <p className="flex items-center gap-2 text-[13px] font-extrabold">
              <Truck className="size-4" aria-hidden />
              {t("tracking.onTheWay", { courier: parcel.courierName || t("tracking.theDriver") })}
            </p>
            <p className="mt-0.5 ink-muted">
              <bdi>{parcel.sellers.join(" · ")}</bdi>
              {parcel.doorLabel ? <> · <bdi>{parcel.doorLabel}</bdi></> : null}
            </p>
            {parcel.driver ? (
              <>
                <p aria-live="polite" className="mt-2 text-[14px] font-extrabold">
                  {parcel.eta === null
                    ? t("tracking.noPin")
                    : parcel.eta.kind === "arriving"
                      ? t("tracking.arriving")
                      : t("tracking.band", { low: String(parcel.eta.low), high: String(parcel.eta.high) })}
                </p>
                <p className="mt-0.5 ink-muted">
                  {minutesAgo !== null && minutesAgo < 1 ? t("tracking.updatedNow") : t("tracking.updated", { minutes: String(minutesAgo ?? 0) })}
                  {parcel.eta?.kind === "band" ? <> · {t(parcel.eta.source === "traffic" ? "tracking.estimateTraffic" : "tracking.estimate")}</> : null}
                </p>
                <div className="mt-3"><TrackMap driver={parcel.driver} door={parcel.door} /></div>
              </>
            ) : (
              <p className="mt-2 ink-muted">{t("tracking.notSharing")}</p>
            )}
          </div>
        );
      })}
    </section>
  );
}
