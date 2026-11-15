import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { CircleAlert, CircleCheckBig, Download, LogOut, PackagePlus, Plus, Search, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { useDesk } from "./Staff.js";
import { StatusPill } from "../components/Status.js";
import type { ShipmentRow } from "../../shared/shipment.js";
import { Destination } from "../components/Destination.js";
import { formatDateTime, formatMoney } from "../../shared/format.js";
import type { StatusGroup } from "../../shared/status.js";
import { GROUP_ORDER, isStatusGroup } from "../../shared/status.js";
import { formatCount } from "../../shared/i18n.js";

type List = { rows: ShipmentRow[]; total: number; page: number; pages: number; counts: Record<StatusGroup | "all", number> };
type Summary = { waiting: number; bookedToday: number; outNow: number; cashOutFils: number; deliveredToday: number; attention: number };

/**
 * Every shipment, the most recently changed first, searched by number,
 * sender, recipient, area or phone, and narrowed by where it stands — each
 * filter saying how many it holds before it is pressed. The day's figures
 * sit above it, each a way into the shipments it counts. The search, the
 * filter and the page live in the address, so a refresh or Back keeps them,
 * and Export downloads exactly what the list shows.
 */
export function ShipmentList() {
  const { t, n, lang } = useLanguage();
  const { call, signOut } = useDesk();
  const search = new URLSearchParams(useSearch());
  const [, navigate] = useLocation();
  const q = search.get("q") ?? "";
  const page = Number(search.get("page") ?? "1") || 1;
  const groupParam = search.get("group");
  const group: StatusGroup | null = isStatusGroup(groupParam) ? groupParam : null;
  const [typed, setTyped] = useState(q);
  const [list, setList] = useState<List | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    void call<List>("GET", `/api/staff/shipments?q=${encodeURIComponent(q)}&page=${page}${group ? `&group=${group}` : ""}`).then(answer => {
      if (!live) return;
      if (answer.ok) setList(answer.body);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [call, q, page, group]);

  const go = (nextQ: string, nextPage: number, nextGroup: StatusGroup | null = group) => {
    const params = new URLSearchParams();
    if (nextQ.trim()) params.set("q", nextQ.trim());
    if (nextGroup) params.set("group", nextGroup);
    if (nextPage > 1) params.set("page", String(nextPage));
    navigate(`/staff${params.size ? `?${params}` : ""}`, { replace: true });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    go(typed, 1);
  };
  const exportHref = `/api/staff/export?${new URLSearchParams({ ...(q ? { q } : {}), ...(group ? { group } : {}), lang }).toString()}`;

  return (
    <>
      <div className="staff-bar">
        <h1>{t("staff.shipments")}</h1>
        <div className="staff-actions">
          <Link href="/staff/new" className="button button-primary button-small"><Plus size={16} aria-hidden="true" />{t("staff.new")}</Link>
          <a href={exportHref} download className="button button-secondary button-small" aria-label={t("staff.exportName")}><Download size={16} aria-hidden="true" /><span aria-hidden="true">{t("staff.export")}</span></a>
          <button type="button" className="button button-secondary button-small" onClick={signOut}><LogOut size={16} aria-hidden="true" className="flip" />{t("staff.signOut")}</button>
        </div>
      </div>
      <Today onShow={next => { setTyped(""); go("", 1, next); }} />
      <form className="search-row" role="search" onSubmit={submit}>
        <label htmlFor="staff-search" className="sr-only">{t("staff.searchLabel")}</label>
        <input id="staff-search" className="input" type="search" value={typed} onChange={event => setTyped(event.target.value)} placeholder={t("staff.searchLabel")} maxLength={80} />
        <button type="submit" className="button button-secondary"><Search size={16} aria-hidden="true" /><span className="only-wide">{t("staff.search")}</span><span className="sr-only only-narrow">{t("staff.search")}</span></button>
      </form>
      {list ? (
        <div className="filters" role="group" aria-label={t("staff.filterName")}>
          {([null, ...GROUP_ORDER] as (StatusGroup | null)[]).map(key => (
            <button
              key={key ?? "all"}
              type="button"
              className="chip filter"
              aria-pressed={group === key}
              onClick={() => go(q, 1, key)}
            >
              {t(`group.${key ?? "all"}`)}
              <span className="count">{formatCount(list.counts[key ?? "all"])}</span>
            </button>
          ))}
        </div>
      ) : null}

      {failed ? <p className="notice notice-stopped" role="alert">{t("error.generic")}</p> : null}
      {!list && !failed ? <div className="card" aria-busy="true"><div className="skeleton" data-size="bar" /></div> : null}
      {list ? (
        list.total === 0 ? (
          <div className="card">
            <p>{q ? t("staff.noMatch", { q }) : list.counts.all ? t("staff.noneInGroup") : t("staff.none")}</p>
            {q ? <p className="more-link"><button type="button" className="button button-secondary button-small" onClick={() => { setTyped(""); go("", 1); }}>{t("staff.clear")}</button></p> : null}
          </div>
        ) : (
          <>
            <p className="list-count" aria-live="polite">{n("shipments", list.total)}</p>
            <div className="table-wrap only-wide" role="region" aria-label={t("staff.listName")} tabIndex={0}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t("staff.colNumber")}</th>
                    <th scope="col">{t("staff.colSender")}</th>
                    <th scope="col">{t("staff.colTo")}</th>
                    <th scope="col">{t("staff.colStatus")}</th>
                    <th scope="col">{t("staff.colUpdated")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map(row => (
                    <tr key={row.id}>
                      <td className="number-cell"><Link href={`/staff/shipments/${row.id}`}><bdi dir="ltr">{row.trackingNumber}</bdi></Link></td>
                      <td dir="auto">{row.senderName}</td>
                      <td><Destination area={row.area} governorate={row.governorate} /></td>
                      <td><StatusPill status={row.status} /></td>
                      <td>{formatDateTime(row.updatedAt, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="cards only-narrow">
              {list.rows.map(row => (
                <li key={row.id}>
                  <Link href={`/staff/shipments/${row.id}`} className="ship-card">
                    <span className="top"><bdi className="number" dir="ltr">{row.trackingNumber}</bdi><StatusPill status={row.status} /></span>
                    <span className="meta" dir="auto">{row.senderName}</span>
                    {row.area || row.governorate ? <span className="meta"><Destination area={row.area} governorate={row.governorate} /></span> : null}
                    <span className="meta">{formatDateTime(row.updatedAt, lang)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {list.pages > 1 ? (
              <nav className="pager" aria-label={t("staff.page", { page: list.page, pages: list.pages })}>
                <span>{t("staff.page", { page: list.page, pages: list.pages })}</span>
                <span className="buttons">
                  <button type="button" className="button button-secondary button-small" disabled={list.page <= 1} onClick={() => go(q, list.page - 1)}>{t("staff.prev")}</button>
                  <button type="button" className="button button-secondary button-small" disabled={list.page >= list.pages} onClick={() => go(q, list.page + 1)}>{t("staff.next")}</button>
                </span>
              </nav>
            ) : null}
          </>
        )
      ) : null}
    </>
  );
}

/**
 * The day at a glance, on Kuwait's day: what waits for pickup and how much
 * was booked today, what is with drivers and the cash they carry, what
 * arrived, and what needs somebody. Each figure opens the shipments it counts.
 */
function Today({ onShow }: { onShow: (group: StatusGroup | null) => void }) {
  const { t, n, lang } = useLanguage();
  const { call } = useDesk();
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => {
    let live = true;
    void call<Summary>("GET", "/api/staff/summary").then(answer => {
      if (live && answer.ok) setSummary(answer.body);
    });
    return () => {
      live = false;
    };
  }, [call]);
  if (!summary) return null;
  const tiles: { key: string; label: string; value: number; note?: string; group: StatusGroup | null; icon: LucideIcon; tone?: string }[] = [
    { key: "waiting", label: t("group.waiting"), value: summary.waiting, note: summary.bookedToday ? n("booked", summary.bookedToday) : undefined, group: "waiting", icon: PackagePlus },
    { key: "out", label: t("desk.out"), value: summary.outNow, note: summary.cashOutFils ? t("desk.cashOut", { amount: formatMoney(summary.cashOutFils, lang) }) : undefined, group: "out", icon: Truck },
    { key: "delivered", label: t("desk.delivered"), value: summary.deliveredToday, group: "delivered", icon: CircleCheckBig },
    { key: "attention", label: t("desk.attention"), value: summary.attention, group: "attention", icon: CircleAlert, tone: summary.attention ? "attention" : undefined },
  ];
  return (
    <section className="today" aria-labelledby="today-title">
      <h2 id="today-title" className="sr-only">{t("desk.today")}</h2>
      <ul className="tiles">
        {tiles.map(tile => {
          const Icon = tile.icon;
          return (
            <li key={tile.key}>
              <button type="button" className={`tile${tile.tone ? ` tone-${tile.tone}` : ""}`} onClick={() => onShow(tile.group)} aria-describedby={`tile-${tile.key}-show`}>
                <span className="tile-icon"><Icon size={18} aria-hidden="true" /></span>
                <span className="tile-value">{formatCount(tile.value)}</span>
                <span className="tile-label">{tile.label}</span>
                {tile.note ? <span className="tile-note"><bdi>{tile.note}</bdi></span> : null}
                <span id={`tile-${tile.key}-show`} className="sr-only">{t("desk.show")}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
