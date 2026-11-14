import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { LogOut, Plus, Search } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { useDesk } from "./Staff.js";
import { StatusPill } from "../components/Status.js";
import type { ShipmentRow } from "../../shared/shipment.js";
import { Destination } from "../components/Destination.js";
import { formatDateTime } from "../../shared/format.js";

type List = { rows: ShipmentRow[]; total: number; page: number; pages: number };

/**
 * Every shipment, the most recently changed first, searched by number,
 * sender, recipient, area or phone. The search and the page live in the
 * address, so a refresh or Back keeps them.
 */
export function ShipmentList() {
  const { t, n, lang } = useLanguage();
  const { call, signOut } = useDesk();
  const search = new URLSearchParams(useSearch());
  const [, navigate] = useLocation();
  const q = search.get("q") ?? "";
  const page = Number(search.get("page") ?? "1") || 1;
  const [typed, setTyped] = useState(q);
  const [list, setList] = useState<List | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    void call<List>("GET", `/api/staff/shipments?q=${encodeURIComponent(q)}&page=${page}`).then(answer => {
      if (!live) return;
      if (answer.ok) setList(answer.body);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [call, q, page]);

  const go = (nextQ: string, nextPage: number) => {
    const params = new URLSearchParams();
    if (nextQ.trim()) params.set("q", nextQ.trim());
    if (nextPage > 1) params.set("page", String(nextPage));
    navigate(`/staff${params.size ? `?${params}` : ""}`, { replace: true });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    go(typed, 1);
  };

  return (
    <>
      <div className="staff-bar">
        <h1>{t("staff.shipments")}</h1>
        <div className="staff-actions">
          <Link href="/staff/new" className="button button-primary button-small"><Plus size={16} aria-hidden="true" />{t("staff.new")}</Link>
          <button type="button" className="button button-secondary button-small" onClick={signOut}><LogOut size={16} aria-hidden="true" className="flip" />{t("staff.signOut")}</button>
        </div>
      </div>
      <form className="search-row" role="search" onSubmit={submit}>
        <label htmlFor="staff-search" className="sr-only">{t("staff.searchLabel")}</label>
        <input id="staff-search" className="input" type="search" value={typed} onChange={event => setTyped(event.target.value)} placeholder={t("staff.searchLabel")} maxLength={80} />
        <button type="submit" className="button button-secondary"><Search size={16} aria-hidden="true" /><span className="only-wide">{t("staff.search")}</span><span className="sr-only only-narrow">{t("staff.search")}</span></button>
      </form>

      {failed ? <p className="notice notice-stopped" role="alert">{t("error.generic")}</p> : null}
      {!list && !failed ? <div className="card" aria-busy="true"><div className="skeleton" data-size="bar" /></div> : null}
      {list ? (
        list.total === 0 ? (
          <div className="card">
            <p>{q ? t("staff.noMatch", { q }) : t("staff.none")}</p>
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
