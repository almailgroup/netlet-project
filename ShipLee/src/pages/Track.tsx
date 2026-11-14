import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { CalendarDays, Check, CircleAlert, Copy, SearchX } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { usePageTitle } from "../hooks.js";
import { api } from "../api.js";
import { TrackForm } from "../components/TrackForm.js";
import { STATUS_ICONS } from "../components/Status.js";
import { Progress } from "../components/Progress.js";
import { Timeline } from "../components/Timeline.js";
import type { PublicShipment } from "../../shared/shipment.js";
import { isFinal, progressOf, toneOf } from "../../shared/status.js";
import { parseTrackingNumber } from "../../shared/tracking.js";
import { dayAfter, formatDateTime, formatDay, formatMoney } from "../../shared/format.js";
import { kuwaitDay } from "../../shared/kuwait.js";
import { Destination } from "../components/Destination.js";

type Lookup =
  | { state: "loading" }
  | { state: "found"; shipment: PublicShipment }
  | { state: "notFound" }
  | { state: "bad" }
  | { state: "error" };

export function Track({ number: typed }: { number: string }) {
  const { t } = useLanguage();
  const parsed = parseTrackingNumber(typed);
  const number = parsed.ok ? parsed.number : typed;
  const [lookup, setLookup] = useState<Lookup>(parsed.ok ? { state: "loading" } : { state: "bad" });
  usePageTitle(t("title.track", { number }));

  const load = useCallback(async (quiet = false) => {
    if (!parsed.ok) return setLookup({ state: "bad" });
    if (!quiet) setLookup({ state: "loading" });
    const answer = await api<PublicShipment>("GET", `/api/track/${parsed.number}`);
    if (answer.ok) setLookup({ state: "found", shipment: answer.body });
    else if (answer.status === 404) setLookup({ state: "notFound" });
    else if (answer.status === 400) setLookup({ state: "bad" });
    else if (!quiet) setLookup({ state: "error" });
  }, [parsed.ok, parsed.ok ? parsed.number : ""]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Somebody waiting for a driver leaves the tab open; coming back to it asks again. */
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [load]);

  return (
    <div className="container">
      <div className="track-search">
        <TrackForm key={number} initial={parsed.ok ? parsed.number : typed} labelHidden />
      </div>
      {lookup.state === "loading" ? <Loading /> : null}
      {lookup.state === "found" ? <Found shipment={lookup.shipment} /> : null}
      {lookup.state === "notFound" ? (
        <StateCard icon={<SearchX size={24} aria-hidden="true" />} title={t("result.notFoundTitle")} body={t("result.notFoundBody")} number={number} />
      ) : null}
      {lookup.state === "bad" ? (
        <StateCard icon={<CircleAlert size={24} aria-hidden="true" />} title={t("result.badTitle")} body={t("track.shape")} number={typed} />
      ) : null}
      {lookup.state === "error" ? (
        <StateCard
          icon={<CircleAlert size={24} aria-hidden="true" />}
          title={t("result.errorTitle")}
          body={t("result.errorBody")}
          action={<button type="button" className="button button-primary" onClick={() => void load()}>{t("result.tryAgain")}</button>}
        />
      ) : null}
    </div>
  );
}

function Loading() {
  const { t } = useLanguage();
  return (
    <div className="card" aria-busy="true">
      <p className="sr-only" role="status">{t("result.loading")}</p>
      <div className="skeleton" aria-hidden="true" data-size="line-short" />
      <div className="skeleton" aria-hidden="true" data-size="title" />
      <div className="skeleton" aria-hidden="true" data-size="line" />
      <div className="skeleton" aria-hidden="true" data-size="bar" />
    </div>
  );
}

function StateCard({ icon, title, body, number, action }: { icon: ReactNode; title: string; body: string; number?: string; action?: ReactNode }) {
  const { t } = useLanguage();
  return (
    <div className="card state-card tone-attention">
      <span className="status-disc">{icon}</span>
      <h1>{title}</h1>
      {number ? <p className="number-line"><bdi dir="ltr">{number}</bdi></p> : null}
      <p>{body}</p>
      <div className="actions">
        {action}
        <Link href="/help" className="button button-secondary">{t("result.getHelp")}</Link>
      </div>
    </div>
  );
}

function Found({ shipment }: { shipment: PublicShipment }) {
  const { t, n, lang } = useLanguage();
  const tone = toneOf(shipment.status);
  const Icon = STATUS_ICONS[shipment.status];
  const progress = progressOf(shipment.status, shipment.events.map(event => event.status));
  const delivered = shipment.status === "delivered" ? shipment.events.find(event => event.status === "delivered") : undefined;
  const today = kuwaitDay();
  /* A day already gone is no promise at all, so it is not shown. */
  const expected = !isFinal(shipment.status) && shipment.expectedOn && shipment.expectedOn >= today ? shipment.expectedOn : null;
  const when = delivered
    ? t("result.deliveredAt", { when: formatDateTime(delivered.happenedAt, lang) })
    : expected === today
      ? t("result.expectedToday")
      : expected === dayAfter(today)
        ? t("result.expectedTomorrow")
        : expected
          ? t("result.expected", { day: formatDay(expected, lang) })
          : null;

  return (
    <div className="track-layout">
      <article className={`card tone-${tone}`} aria-labelledby="status-title">
        <div className="number-row">
          <span>
            {t("result.number")}{" "}
            <bdi className="number" dir="ltr">{shipment.trackingNumber}</bdi>
          </span>
          <CopyNumber number={shipment.trackingNumber} />
        </div>
        <div className="status-head">
          <span className="status-disc"><Icon size={26} aria-hidden="true" /></span>
          <div>
            <h1 id="status-title" className="status-name">{t(`status.${shipment.status}`)}</h1>
            <p className="status-say">{t(`say.${shipment.status}`)}</p>
            {when ? (
              <p className="status-when"><CalendarDays size={16} aria-hidden="true" />{when}</p>
            ) : null}
          </div>
        </div>
        {progress.drawn ? <Progress reached={progress.reached} /> : null}
        <Timeline events={shipment.events} />
      </article>

      <aside className="side">
        <div className="card">
          <dl className="facts">
            <div>
              <dt>{t("result.from")}</dt>
              <dd dir="auto">{shipment.senderName}</dd>
            </div>
            {shipment.area || shipment.governorate ? (
              <div>
                <dt>{t("result.to")}</dt>
                <dd><Destination area={shipment.area} governorate={shipment.governorate} /></dd>
              </div>
            ) : null}
            <div>
              <dt>{t("form.parcel")}</dt>
              <dd>{n("pieces", shipment.pieces)}</dd>
            </div>
            {shipment.codFils && !isFinal(shipment.status) ? (
              <div className="cod">
                <dt>{t("result.cod")}</dt>
                <dd>
                  <bdi>{formatMoney(shipment.codFils, lang)}</bdi>
                  <p>{t("result.codNote")}</p>
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
        <div className="card">
          <h2 className="side-title">{t("result.questions")}</h2>
          <p className="more-link"><Link href="/help">{t("result.getHelp")}</Link></p>
        </div>
      </aside>
    </div>
  );
}

function CopyNumber({ number }: { number: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(number);
      setCopied(true);
    } catch {
      /* With the clipboard refused the number is still there to select. */
    }
  };
  return (
    <button type="button" className="button button-quiet button-small" onClick={() => void copy()} aria-label={t("result.copyName")}>
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      <span aria-hidden="true">{copied ? t("result.copied") : t("result.copy")}</span>
      <span className="sr-only" role="status">{copied ? t("result.copied") : ""}</span>
    </button>
  );
}
