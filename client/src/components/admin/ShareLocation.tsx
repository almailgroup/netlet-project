/**
 * "Share my location while delivering" — the driver's half of live tracking
 * (3.4.3), on the dispatch board.
 *
 * Off until the driver presses it, every time the page is opened: a location
 * that starts being shared because somebody once pressed a button last week is
 * not a choice anybody made today. While on, the browser reports the position
 * and the page sends at most one in fifteen seconds; the server keeps only the
 * latest. Stopping deletes it at once. Closing the page stops the reports, and
 * the last position stops being shown ten minutes later on its own.
 *
 * The panel says exactly who sees it, because a driver deciding whether to
 * share is deciding about their own whereabouts.
 */
import { smallButtonClass } from "@/components/admin/ui";
import { useEffect, useRef, useState } from "react";
import { LocateFixed } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import type { MessageKey } from "@shared/i18n/dictionary";

const SEND_EVERY_MS = 15_000;

export function ShareLocation() {
  const { t, tError, isArabic } = useTranslation();
  const utils = trpc.useUtils();
  const server = trpc.dispatch.mySharing.useQuery();
  const share = trpc.dispatch.sharePosition.useMutation();
  const stop = trpc.dispatch.stopSharing.useMutation({ onSuccess: () => void utils.dispatch.mySharing.invalidate() });
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState<{ key: MessageKey; tone: "ok" | "problem" } | null>(null);
  const [lastSent, setLastSent] = useState<Date | null>(null);
  const [problem, alertProblem] = useState<string | null>(null);
  const watch = useRef<number | null>(null);
  const sentAt = useRef(0);
  const supported = typeof navigator !== "undefined" && "geolocation" in navigator;

  useEffect(() => {
    if (!on) return;
    setStatus({ key: "tracking.locating", tone: "ok" });
    watch.current = navigator.geolocation.watchPosition(
      position => {
        if (Date.now() - sentAt.current < SEND_EVERY_MS) return;
        sentAt.current = Date.now();
        share.mutate(
          { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy },
          {
            onSuccess: () => { setLastSent(new Date()); setStatus({ key: "tracking.sharing", tone: "ok" }); },
            onError: error => { setStatus(null); setOn(false); alertProblem(tError(error.message)); },
          },
        );
      },
      error => {
        setOn(false);
        setStatus({ key: error.code === error.PERMISSION_DENIED ? "tracking.denied" : "tracking.unavailable", tone: "problem" });
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => {
      if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
      watch.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  if (!supported) return null;
  const visible = on || server.data?.sharing;

  return (
    <section aria-labelledby="share-location" className="mb-5 max-w-2xl rounded-2xl border border-[#e1e7ef] bg-white p-4 text-[13px] text-[#0a285a] sm:p-5">
      <h2 id="share-location" className="flex items-center gap-2 text-[16px] font-bold">
        <LocateFixed className="size-4" aria-hidden />{t("tracking.shareTitle")}
      </h2>
      <p className="mt-1 leading-5 ink-muted">{t("tracking.shareNote")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {on ? (
          <button type="button" onClick={() => { setOn(false); stop.mutate(); setStatus(null); }} className={smallButtonClass.secondary}>{t("tracking.stop")}</button>
        ) : (
          <button type="button" onClick={() => { alertProblem(null); setOn(true); }} className={smallButtonClass.primary}>{t("tracking.start")}</button>
        )}
        {!on && server.data?.sharing ? (
          <button type="button" onClick={() => stop.mutate()} className={smallButtonClass.secondary}>{t("tracking.clear")}</button>
        ) : null}
      </div>
      <p role="status" className={`mt-2 ${status?.tone === "problem" ? "font-bold text-[#8c2f22]" : "ink-muted"}`}>
        {status ? t(status.key) : visible ? t("tracking.stillVisible") : null}
        {on && lastSent ? <> · {t("tracking.lastSent", { time: lastSent.toLocaleTimeString(isArabic ? "ar-KW-u-nu-latn" : "en-GB") })}</> : null}
      </p>
      {problem ? <p role="alert" className="mt-1 font-bold text-[#8c2f22]">{problem}</p> : null}
    </section>
  );
}
