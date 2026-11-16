import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { Bell, CalendarClock, Camera, Check, ChevronDown, CircleAlert, Copy, MapPin, MessageSquareWarning, PackageSearch, RefreshCw, SearchX, Share2, Truck } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { useConfig, usePageTitle } from "../hooks.js";
import { api } from "../api.js";
import { TrackForm } from "../components/TrackForm.js";
import { STATUS_ICONS, StatusPill } from "../components/Status.js";
import { Progress } from "../components/Progress.js";
import { Timeline } from "../components/Timeline.js";
import { Destination } from "../components/Destination.js";
import { ShipLeeAI } from "../components/ShipLeeAI.js";
import { ContactActions } from "../components/ContactActions.js";
import { RecentlyTracked } from "../components/RecentlyTracked.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { ActionButton, RequestDialog, canRequest } from "../components/RequestDialogs.js";
import type { RequestKind } from "../components/RequestDialogs.js";
import { PreviewTag, usePreview } from "../preview.js";
import { rememberTracked, readRecent } from "../recent.js";
import type { PublicShipment } from "../../shared/shipment.js";
import type { Status } from "../../shared/status.js";
import { isFinal, progressOf, toneOf } from "../../shared/status.js";
import { MAX_PARCELS, parseTrackingList, parseTrackingNumber } from "../../shared/tracking.js";
import { dayAfter, dayBefore, dayOf, formatDate, formatDateTime, formatDay, formatMoney, formatTime } from "../../shared/format.js";
import { kuwaitDay } from "../../shared/kuwait.js";

/** While a parcel is moving, an open page asks again this often. */
const REFRESH_MS = 60_000;

type Lookup =
  | { state: "loading" }
  | { state: "found"; shipment: PublicShipment; checkedAt: Date }
  | { state: "notFound" }
  | { state: "bad" }
  | { state: "error" };

/**
 * How the page looks for where a parcel is: on its way, with a driver,
 * delivered, needing attention, stopped, or only booked. Each look is its own
 * treatment of the same parts, never colour alone.
 */
type Look = "waiting" | "transit" | "out" | "delivered" | "attention" | "stopped";
function lookOf(status: Status): Look {
  if (status === "out_for_delivery") return "out";
  if (status === "delivered") return "delivered";
  const tone = toneOf(status);
  return tone === "moving" ? "transit" : tone === "done" ? "delivered" : tone;
}

async function lookUp(number: string): Promise<Lookup> {
  const answer = await api<PublicShipment>("GET", `/api/track/${number}`);
  if (answer.ok) return { state: "found", shipment: answer.body, checkedAt: new Date() };
  if (answer.status === 404) return { state: "notFound" };
  if (answer.status === 400) return { state: "bad" };
  return { state: "error" };
}

/**
 * /track/:number — one parcel, or several when the numbers are separated by
 * commas, as the tracking box sends them.
 */
export function TrackRoute({ number: typed }: { number: string }) {
  const decoded = decodeURIComponent(typed);
  if (decoded.includes(",")) {
    const list = parseTrackingList(decoded);
    if (list.numbers.length > 1 || list.problems.length) return <MultiTrack numbers={list.numbers.slice(0, MAX_PARCELS)} problems={list.problems} />;
    if (list.numbers.length === 1) return <Track number={list.numbers[0]!} />;
  }
  return <Track number={decoded} />;
}

export function Track({ number: typed }: { number: string }) {
  const { t } = useLanguage();
  const parsed = parseTrackingNumber(typed);
  const number = parsed.ok ? parsed.number : typed;
  const [lookup, setLookup] = useState<Lookup>(parsed.ok ? { state: "loading" } : { state: "bad" });
  usePageTitle(t("title.track", { number }));

  const [checking, setChecking] = useState(false);
  const load = useCallback(async (quiet = false) => {
    if (!parsed.ok) return setLookup({ state: "bad" });
    if (!quiet) setLookup({ state: "loading" });
    setChecking(true);
    const answer = await lookUp(parsed.number);
    setChecking(false);
    if (answer.state === "found") rememberTracked(answer.shipment.trackingNumber, answer.shipment.status);
    /* A quiet check that fails keeps the page as it was rather than replacing it with an error. */
    if (answer.state === "error" && quiet) return;
    setLookup(answer);
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

  /* A parcel still moving is asked about again every minute while the page is in view; one that has arrived is not. */
  const moving = lookup.state === "found" && !isFinal(lookup.shipment.status);
  useEffect(() => {
    if (!moving) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [moving, load]);

  return (
    <div className="container track-page">
      <div className="track-search">
        <TrackForm key={number} initial={parsed.ok ? parsed.number : typed} labelHidden />
      </div>
      {lookup.state === "loading" ? <Loading /> : null}
      {lookup.state === "found" ? <Found shipment={lookup.shipment} checkedAt={lookup.checkedAt} checking={checking} onRefresh={() => void load(true)} /> : null}
      {lookup.state === "notFound" ? (
        <StateCard tone="attention" icon={<SearchX size={26} aria-hidden="true" />} title={t("result.notFoundTitle")} body={t("result.notFoundBody")} number={number} />
      ) : null}
      {lookup.state === "bad" ? (
        <StateCard tone="attention" icon={<CircleAlert size={26} aria-hidden="true" />} title={t("result.badTitle")} body={t("track.shape")} number={typed} />
      ) : null}
      {lookup.state === "error" ? (
        <StateCard
          tone="stopped"
          icon={<CircleAlert size={26} aria-hidden="true" />}
          title={t("result.errorTitle")}
          body={t("result.errorBody")}
          action={<button type="button" className="button button-primary" onClick={() => void load()}><RefreshCw size={16} aria-hidden="true" />{t("result.tryAgain")}</button>}
        />
      ) : null}
    </div>
  );
}

/** The shape of the page that is coming, so nothing jumps when it arrives. */
function Loading() {
  const { t } = useLanguage();
  return (
    <div className="track-loading" aria-busy="true">
      <p className="sr-only" role="status">{t("result.loading")}</p>
      <div className="card status-hero" aria-hidden="true">
        <div className="hero-main">
          <div className="skeleton" data-size="line-short" />
          <div className="loading-head">
            <div className="skeleton" data-size="disc" />
            <div className="loading-lines">
              <div className="skeleton" data-size="title" />
              <div className="skeleton" data-size="line" />
            </div>
          </div>
          <div className="skeleton" data-size="bar" />
        </div>
        <div className="eta-card skeleton-card">
          <div className="skeleton" data-size="line-short" />
          <div className="skeleton" data-size="title" />
          <div className="skeleton" data-size="line" />
        </div>
      </div>
      <div className="track-layout" aria-hidden="true">
        <div className="card"><div className="skeleton" data-size="block" /></div>
        <div className="card"><div className="skeleton" data-size="block" /></div>
      </div>
    </div>
  );
}

function StateCard({ tone, icon, title, body, number, action }: { tone: "attention" | "stopped"; icon: ReactNode; title: string; body: string; number?: string; action?: ReactNode }) {
  const { t } = useLanguage();
  return (
    <div className={`card state-card tone-${tone}`}>
      <span className="status-disc">{icon}</span>
      <h1>{title}</h1>
      {number ? <p className="number-line"><bdi dir="ltr">{number}</bdi></p> : null}
      <p>{body}</p>
      <div className="actions-row">
        {action}
        <Link href="/help" className="button button-secondary">{t("result.getHelp")}</Link>
      </div>
    </div>
  );
}

function Found({ shipment, checkedAt, checking, onRefresh }: { shipment: PublicShipment; checkedAt: Date; checking: boolean; onRefresh: () => void }) {
  const { t, lang } = useLanguage();
  const config = useConfig();
  const preview = usePreview();
  const [asking, setAsking] = useState<RequestKind | null>(null);
  const close = useCallback(() => setAsking(null), []);
  const look = lookOf(shipment.status);
  const tone = toneOf(shipment.status);
  const Icon = STATUS_ICONS[shipment.status];
  const progress = progressOf(shipment.status, shipment.events.map(event => event.status));
  const delivered = shipment.status === "delivered" ? shipment.events.find(event => event.status === "delivered") : undefined;
  const contact = config?.contact;
  const reachable = canRequest(contact);
  const final = isFinal(shipment.status);
  const actions: { kind: RequestKind; icon: ReactNode; label: string; lead: string; preview?: boolean }[] = [];
  if (reachable && !final) {
    actions.push({ kind: "reschedule", icon: <CalendarClock size={20} />, label: t("act.reschedule"), lead: t("act.rescheduleLead") });
    actions.push({ kind: "address", icon: <MapPin size={20} />, label: t("act.address"), lead: t("act.addressLead") });
  }
  if (preview.on && !final) actions.push({ kind: "notify", icon: <Bell size={20} />, label: t("act.notify"), lead: t("act.notifyLead"), preview: true });
  if (reachable) actions.push({ kind: "problem", icon: <MessageSquareWarning size={20} />, label: t("act.problem"), lead: t("act.problemLead") });

  return (
    <>
      <section className={`card status-hero look-${look}`} aria-labelledby="status-title">
        <div className="hero-main">
          <div className="number-row">
            <span>
              {t("result.number")}{" "}
              <bdi className="number" dir="ltr">{shipment.trackingNumber}</bdi>
            </span>
            <span className="number-tools">
              <CopyNumber number={shipment.trackingNumber} />
              <ShareLink number={shipment.trackingNumber} />
            </span>
          </div>
          <div className="status-head">
            <span className="status-disc"><Icon size={26} aria-hidden="true" /></span>
            <div>
              <h1 id="status-title" className="status-name">{t(`status.${shipment.status}`)}</h1>
              <p className="status-say">{t(`say.${shipment.status}`)}</p>
            </div>
          </div>
          {look === "out" ? <OnTheRoad /> : null}
          {progress.drawn ? <Progress reached={progress.reached} attention={tone === "attention"} /> : null}
        </div>
        {look === "stopped" ? null : <EtaCard shipment={shipment} look={look} delivered={delivered?.happenedAt} canReschedule={reachable} />}
      </section>

      {actions.length ? (
        <section className="card actions-card" aria-labelledby="actions-title">
          <h2 id="actions-title" className="card-title">{t("act.title")}</h2>
          <div className="actions">
            {actions.map(action => (
              <ActionButton key={action.kind} icon={action.icon} label={action.label} lead={action.lead} preview={action.preview} onClick={() => setAsking(action.kind)} />
            ))}
          </div>
          {contact ? <RequestDialog kind={asking} number={shipment.trackingNumber} contact={contact} onClose={close} /> : null}
        </section>
      ) : null}

      <div className="track-layout">
        <div className="track-main">
          {look === "out" && preview.on ? <CourierMap /> : null}
          {delivered ? <ProofOfDelivery at={delivered.happenedAt} where={delivered.location} note={delivered.note} preview={preview.on} /> : null}
          <div className="card">
            <Timeline events={shipment.events} />
            <div className="checked-row">
              <span>{t("result.checked", { time: formatTime(checkedAt, lang) })}</span>
              <button type="button" className="button button-quiet button-small" onClick={onRefresh} disabled={checking} aria-label={t("result.refreshName")}>
                <RefreshCw size={15} aria-hidden="true" className={checking ? "spinning" : undefined} />
                <span aria-hidden="true">{checking ? t("result.refreshing") : t("result.refresh")}</span>
              </button>
            </div>
          </div>
        </div>

        <aside className="side">
          <section className="card" aria-labelledby="details-title">
            <h2 id="details-title" className="card-title">{t("shipment.title")}</h2>
            <dl className="facts details-facts">
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
                <dd><Pieces count={shipment.pieces} /></dd>
              </div>
              <div>
                <dt>{t("shipment.booked")}</dt>
                <dd>{formatDate(shipment.createdAt, lang)}</dd>
              </div>
            </dl>
          </section>
          {config?.ai ? (
            <ShipLeeAI number={shipment.trackingNumber} status={shipment.status} cod={Boolean(shipment.codFils) && !final} contact={config.contact} />
          ) : null}
          <div className="card help-card">
            <h2 className="side-title">{t("result.helpTitle")}</h2>
            {config && (config.contact.whatsapp || config.contact.email) ? <p className="side-lead">{t("result.helpLead")}</p> : null}
            {config ? <ContactActions contact={config.contact} number={shipment.trackingNumber} /> : null}
            <p className="more-link"><Link href="/help">{t("result.allHelp")}</Link></p>
          </div>
        </aside>
      </div>
    </>
  );
}

function Pieces({ count }: { count: number }) {
  const { n } = useLanguage();
  return <>{n("pieces", count)}</>;
}

/**
 * When it arrives, said large: the day and what to know about it, and the
 * cash to have ready. A day already gone is no promise, so it is not shown.
 */
function EtaCard({ shipment, look, delivered, canReschedule }: { shipment: PublicShipment; look: Look; delivered?: string; canReschedule: boolean }) {
  const { t, lang } = useLanguage();
  const today = kuwaitDay();
  const expected = !isFinal(shipment.status) && shipment.expectedOn && shipment.expectedOn >= today ? shipment.expectedOn : null;
  const cod = shipment.codFils && !isFinal(shipment.status) ? shipment.codFils : null;

  let label = t("eta.title");
  let big: string;
  let sub: string | null = null;
  let note: string | null = null;
  if (delivered) {
    const day = dayOf(delivered);
    label = t("eta.delivered");
    big = day === today ? t("result.today") : day === dayBefore(today) ? t("result.yesterday") : formatDay(day, lang);
    sub = formatTime(delivered, lang);
  } else if (expected) {
    if (look === "attention") label = t("eta.nextTry");
    big = expected === today ? t("eta.today") : expected === dayAfter(today) ? t("eta.tomorrow") : formatDay(expected, lang);
    sub = expected === today || expected === dayAfter(today) ? formatDay(expected, lang) : null;
    note = look === "out" ? t("eta.withDriver") : look === "attention" && canReschedule ? t("eta.arrangeOwn") : t("eta.note");
  } else if (look === "attention") {
    label = t("eta.nextTry");
    big = t("eta.notSet");
    note = canReschedule ? `${t("eta.arrange")} ${t("eta.arrangeOwn")}` : t("eta.arrange");
  } else {
    big = t("eta.notSet");
    note = t("eta.notSetNote");
  }

  return (
    <div className="eta-card">
      <p className="eta-label">{label}</p>
      <p className="eta-day">{big}</p>
      {sub ? <p className="eta-sub">{sub}</p> : null}
      {note ? <p className="eta-note">{note}</p> : null}
      {cod ? (
        <div className="eta-cod">
          <p className="eta-label">{t("result.cod")}</p>
          <p className="eta-amount"><bdi>{formatMoney(cod, lang)}</bdi></p>
          <p className="eta-note">{t("result.codNote")}</p>
        </div>
      ) : null}
    </div>
  );
}

/** A line of dots running under the heading while a driver has the parcel, for the eye alone. */
function OnTheRoad() {
  return (
    <div className="on-the-road" aria-hidden="true">
      <span className="road" />
      <Truck size={18} className="flip" />
    </div>
  );
}

/** Where the driver is, once that is connected: a drawn map, marked as a preview. */
function CourierMap() {
  const { t } = useLanguage();
  return (
    <section className="card" aria-labelledby="map-title">
      <div className="card-head">
        <h2 id="map-title" className="card-title">{t("map.title")}</h2>
        <PreviewTag />
      </div>
      <p className="muted small">{t("map.lead")}</p>
      <div className="placeholder map-placeholder">
        <svg className="backdrop" viewBox="0 0 600 220" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <g stroke="currentColor" strokeOpacity="0.12" strokeWidth="10" fill="none" strokeLinecap="round">
            <path d="M-20 50 H620" />
            <path d="M-20 130 H620" />
            <path d="M150 -20 V240" />
            <path d="M450 -20 V240" />
            <path d="M300 -20 C 280 60 330 120 310 240" />
          </g>
          <path className="map-route" d="M150 130 H290 C 312 130 300 50 322 50 H450" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="2 10" strokeLinecap="round" />
          <circle cx="150" cy="130" r="12" fill="currentColor" />
          <circle cx="450" cy="50" r="11" fill="var(--surface)" stroke="currentColor" strokeWidth="4" />
        </svg>
        <div className="placeholder-text map-text">
          <strong>{t("map.preview")}</strong>
          <span className="map-legend"><span className="dot driver" />{t("map.driver")} <span className="dot you" />{t("map.you")}</span>
        </div>
      </div>
    </section>
  );
}

/** What is known about the delivery itself: when, where, and the driver's note. The photo waits on drivers being able to take one. */
function ProofOfDelivery({ at, where, note, preview }: { at: string; where: string | null; note: string | null; preview: boolean }) {
  const { t, lang } = useLanguage();
  return (
    <section className="card proof-card" aria-labelledby="proof-title">
      <div className="card-head">
        <h2 id="proof-title" className="card-title">{t("pod.title")}</h2>
        <span className="pill tone-done"><Check size={14} aria-hidden="true" />{t("status.delivered")}</span>
      </div>
      <dl className="facts two">
        <div>
          <dt>{t("pod.when")}</dt>
          <dd>{formatDateTime(at, lang)}</dd>
        </div>
        {where ? (
          <div>
            <dt>{t("pod.where")}</dt>
            <dd dir="auto">{where}</dd>
          </div>
        ) : null}
        {note ? (
          <div className="wide">
            <dt>{t("pod.note")}</dt>
            <dd dir="auto">{note}</dd>
          </div>
        ) : null}
      </dl>
      {preview ? (
        <div className="placeholder photo-placeholder">
          <div className="placeholder-text">
            <Camera size={26} aria-hidden="true" />
            <strong>{t("pod.photo")}</strong>
            <span>{t("pod.photoPreview")}</span>
            <PreviewTag />
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Several parcels at once: each one's latest update in a row, and the way to
 * its own page. Asked for together, drawn as each answers.
 */
function MultiTrack({ numbers, problems }: { numbers: string[]; problems: string[] }) {
  const { t, n, lang } = useLanguage();
  const [results, setResults] = useState<Record<string, Lookup>>({});
  usePageTitle(t("title.trackSeveral", { parcels: n("parcels", numbers.length) }));
  useEffect(() => {
    let live = true;
    setResults({});
    for (const number of numbers) {
      void lookUp(number).then(result => {
        if (!live) return;
        if (result.state === "found") rememberTracked(result.shipment.trackingNumber, result.shipment.status);
        setResults(current => ({ ...current, [number]: result }));
      });
    }
    return () => {
      live = false;
    };
  }, [numbers.join(",")]);
  const today = kuwaitDay();
  return (
    <div className="container track-page">
      <div className="track-search">
        <TrackForm key={numbers.join(",")} initial={numbers.join(", ")} labelHidden />
      </div>
      <div className="page-head compact">
        <h1 className="page-title">{n("parcels", numbers.length)}</h1>
        <p className="page-lead">{t("multi.lead")}</p>
      </div>
      <ul className="parcel-list">
        {numbers.map(number => {
          const result = results[number] ?? { state: "loading" };
          return (
            <li key={number} className="card parcel-row" aria-busy={result.state === "loading" || undefined}>
              <bdi className="number parcel-number" dir="ltr">{number}</bdi>
              {result.state === "loading" ? (
                <div className="parcel-body" aria-hidden="true">
                  <div className="skeleton" data-size="pill" />
                  <div className="skeleton" data-size="line" />
                </div>
              ) : result.state === "found" ? (
                <div className="parcel-body">
                  <StatusPill status={result.shipment.status} />
                  <p className="muted small">{shortWhen(result.shipment, today, t, lang) ?? t(`say.${result.shipment.status}`)}</p>
                </div>
              ) : (
                <div className="parcel-body">
                  <p className="parcel-problem"><CircleAlert size={16} aria-hidden="true" />{t(result.state === "notFound" ? "multi.notFound" : result.state === "bad" ? "multi.bad" : "multi.error")}</p>
                </div>
              )}
              {result.state === "found" ? (
                <Link href={`/track/${number}`} className="button button-secondary button-small" aria-label={t("multi.openName", { number })}>
                  <span aria-hidden="true">{t("multi.open")}</span>
                </Link>
              ) : null}
            </li>
          );
        })}
        {problems.map(text => (
          <li key={text} className="card parcel-row">
            <bdi className="number parcel-number" dir="ltr">{text.slice(0, 24)}</bdi>
            <div className="parcel-body">
              <p className="parcel-problem"><CircleAlert size={16} aria-hidden="true" />{t("multi.bad")}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function shortWhen(shipment: PublicShipment, today: string, t: ReturnType<typeof useLanguage>["t"], lang: ReturnType<typeof useLanguage>["lang"]): string | null {
  if (shipment.status === "delivered") {
    const at = shipment.events.find(event => event.status === "delivered")?.happenedAt;
    return at ? t("result.deliveredAt", { when: formatDateTime(at, lang) }) : null;
  }
  const expected = !isFinal(shipment.status) && shipment.expectedOn && shipment.expectedOn >= today ? shipment.expectedOn : null;
  if (!expected) return null;
  return expected === today ? t("result.expectedToday") : expected === dayAfter(today) ? t("result.expectedTomorrow") : t("result.expected", { day: formatDay(expected, lang) });
}

/** /track with no number: the box, what this device tracked, and where to find a number. */
export function TrackEmpty() {
  const { t } = useLanguage();
  usePageTitle(t("title.trackEmpty"));
  const [hasRecent] = useState(() => readRecent().length > 0);
  return (
    <div className="container narrow">
      <div className="page-head">
        <h1 className="page-title">{t("nav.trackParcel")}</h1>
        <p className="page-lead">{t("empty.lead")}</p>
      </div>
      <div className="card">
        <TrackForm autoFocus />
        {hasRecent ? (
          <RecentlyTracked />
        ) : (
          <EmptyState headingLevel={2} icon={<PackageSearch size={26} />} title={t("recent.emptyTitle")} body={t("recent.emptyBody")} />
        )}
      </div>
      <div className="faq questions">
        <details>
          <summary>{t("faq.number.q")}<ChevronDown size={18} aria-hidden="true" /></summary>
          <p>{t("faq.number.a")}</p>
        </details>
        <details>
          <summary>{t("faq.notFound.q")}<ChevronDown size={18} aria-hidden="true" /></summary>
          <p>{t("faq.notFound.a")}</p>
        </details>
      </div>
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

/**
 * The page's own address, to send to whoever else is waiting for the parcel:
 * the phone's share sheet where there is one, the clipboard otherwise.
 */
function ShareLink({ number }: { number: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const share = async () => {
    const url = `${window.location.origin}/track/${number}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: t("result.shareTitle", { number }), url });
        return;
      } catch (error) {
        /* Closing the sheet is a choice, not a failure: nothing more to do. */
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* Nothing to do: the address is in the address bar. */
    }
  };
  return (
    <button type="button" className="button button-quiet button-small" onClick={() => void share()} aria-label={t("result.shareName")}>
      {copied ? <Check size={16} aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />}
      <span aria-hidden="true">{copied ? t("result.linkCopied") : t("result.share")}</span>
      <span className="sr-only" role="status">{copied ? t("result.linkCopied") : ""}</span>
    </button>
  );
}

