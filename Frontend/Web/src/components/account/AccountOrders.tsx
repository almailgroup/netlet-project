/**
 * Orders and returns, on the shopper's own account page.
 *
 * One section rather than two, because a return is something you do *to* an
 * order — not a separate pile of things. Splitting them means finding the same
 * order twice, once to look at it and once to send it back, and a "Returns"
 * tab that is empty for everybody who has never returned anything is a tab
 * that teaches people not to look.
 *
 * Three states, never two. `QueryGate` is the same gate the admin portal uses
 * and for the same reason: a refused or broken query rendering as "no orders
 * yet" is the worst of the three answers, because it reads as working and
 * quietly tells somebody their purchase history is gone.
 *
 * **What a return is allowed to be is not decided here.** `returnStateFor` is
 * pure and shared, the server resolves it with the server's own clock, and
 * this file only draws the answer. The page cannot offer a return the API
 * would refuse, which is the same arrangement as the password floor.
 *
 * **It carries every tool a shopper needs for their orders, on the owner's
 * word** ("add these filter options at the top of the my order page … all the
 * tools that the user needs"; `OrderTools`): a row of views with how many each
 * holds — All, Processing, On the way, Delivered, Cancelled — then Returns and
 * Reviews, which moved here from the account's home (`AccountReturns`,
 * `AccountReviews`, drawn in place); a search by the order's number or what is
 * in it; and how far back to look. All of it is in the address (`?view=`,
 * `?q=`, `?period=`), the browse pages' rule, and decided by the server over
 * every order (`Shared/commerce/orderFilters.ts`), never over one page.
 */
import { QueryGate } from "@/components/admin/QueryGate";
import { Pager } from "@/components/admin/Pager";
import { Thumb } from "@/components/product/Thumb";
import { ParcelCare } from "@/components/account/ParcelCare";
import { LineReturnStatus } from "@/components/account/LineReturn";
import { useFeature } from "@/hooks/useFeature";
import { formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useReturnWindow } from "@/hooks/useReturnWindow";
import type { OrderProgress } from "@shared/commerce/orderProgress";
import type { MessageKey } from "@shared/i18n/dictionary";
import { ChevronDown, ChevronLeft, CircleCheck, CircleX, Clock, FileText, Package, PackageSearch, RotateCcw, Search, Star, Truck, X, type LucideIcon } from "lucide-react";
import { cameFrom, goBack } from "@/lib/inAppBack";
import { Link, useLocation, useSearch } from "wouter";
import { useEffect, useId, useRef, useState } from "react";
import { Select } from "@/components/ui/Select";
import { AccountReturns } from "@/components/account/AccountReturns";
import { AccountReviews } from "@/components/account/AccountReviews";
import {
  isOrderPeriod, isOrderTab, isOrderView, ORDER_PERIODS, ORDER_SEARCH_MAX, ORDER_TABS,
  type OrderCounts, type OrderPeriod, type OrderTab,
} from "@shared/commerce/orderFilters";
import { ReviewDialog, type MyReview, type ReviewTarget } from "@/components/reviews/ReviewDialog";
import { ReviewStatePill } from "@/components/reviews/ReviewStatePill";
import { StarRow } from "@/components/product/ProductReviews";
import { OrderAfterSales, OrderLineMenu, OrderLinePanel } from "@/components/account/OrderActions";

/**
 * The words for each state, and its colour.
 *
 * Text first and colour second — never colour alone. A row of coloured dots
 * tells somebody with any degree of colour blindness nothing at all, and tells
 * a screen reader less than that. Every pill below carries its own label.
 */
export const PAYMENT: Record<string, { label: MessageKey; className: string }> = {
  pending_payment: { label: "orders.statusPendingPayment", className: "bg-[#fff0ab] text-[#705523]" },
  paid: { label: "orders.statusPaid", className: "bg-[#d8ead8] text-[#2f5d33]" },
  cancelled: { label: "orders.statusCancelled", className: "bg-[#e7edf5] text-[#536b8c]" },
  refunded: { label: "orders.statusRefunded", className: "bg-[#e7edf5] text-[#536b8c]" },
};

export const FULFILMENT: Record<string, { label: MessageKey; className: string }> = {
  pending: { label: "orders.linePending", className: "bg-[#e7edf5] text-[#536b8c]" },
  preparing: { label: "orders.linePreparing", className: "bg-[#fff0ab] text-[#705523]" },
  shipped: { label: "orders.lineShipped", className: "bg-[#dbe7fb] text-[#274b86]" },
  delivered: { label: "orders.lineDelivered", className: "bg-[#d8ead8] text-[#2f5d33]" },
  cancelled: { label: "orders.lineCancelled", className: "bg-[#fdeceb] text-[#8c2f22]" },
  returned: { label: "orders.lineReturned", className: "bg-[#e7edf5] text-[#536b8c]" },
};

export function Pill({ label, className, icon: Icon }: { label: string; className: string; icon?: LucideIcon }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-extrabold ${className}`}>
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      {label}
    </span>
  );
}

/**
 * Where the order is, which is what the list leads with.
 *
 * Payment used to be the badge, and for a cash order that read "awaiting
 * payment" on every row until a driver had been to the door — true, and not
 * the question. The colours are the line states' own, so an order and its
 * lines say "on the way" in one colour.
 */
const PROGRESS: Record<OrderProgress["kind"], { icon: LucideIcon; className: string }> = {
  received: { icon: Clock, className: FULFILMENT.pending.className },
  preparing: { icon: Package, className: FULFILMENT.preparing.className },
  onTheWay: { icon: Truck, className: FULFILMENT.shipped.className },
  partlyDelivered: { icon: Truck, className: FULFILMENT.shipped.className },
  delivered: { icon: CircleCheck, className: FULFILMENT.delivered.className },
  cancelled: { icon: CircleX, className: FULFILMENT.cancelled.className },
  returned: { icon: RotateCcw, className: FULFILMENT.returned.className },
};

function ProgressPill({ progress }: { progress: OrderProgress }) {
  const { t } = useTranslation();
  const formatDate = useDateFormat();
  const label = (() => {
    switch (progress.kind) {
      case "received": return t(progress.preordered ? "orders.progressPreordered" : "orders.progressReceived");
      case "preparing": return t("orders.progressPreparing");
      case "onTheWay": return t("orders.progressOnTheWay");
      case "partlyDelivered": return t("orders.progressPartly", { delivered: progress.delivered, of: progress.of });
      case "delivered": return progress.at ? t("orders.progressDeliveredOn", { date: formatDate(progress.at) }) : t("orders.progressDelivered");
      case "cancelled": return t("orders.progressCancelled");
      case "returned": return t("orders.progressReturned");
    }
  })();
  const look = PROGRESS[progress.kind];
  return <Pill label={label} className={look.className} icon={look.icon} />;
}

/**
 * The picture an order is recognised by: its first product's photograph, with
 * how many more things are in it. Decorative to a screen reader, which hears
 * the names beside it.
 */
function OrderPhoto({ photo, more }: { photo: string | null; more: number }) {
  return (
    <span className="relative shrink-0" aria-hidden>
      <Thumb src={photo} alt="" className="size-16 rounded-2xl border border-[#e7edf5] bg-white object-contain" icon={<PackageSearch className="size-6" />} />
      {more > 0 ? (
        <span className="absolute -bottom-1.5 -end-1.5 rounded-full bg-[#0a285a] px-1.5 py-0.5 text-[12px] font-bold leading-none text-white ring-2 ring-white">
          +{more}
        </span>
      ) : null}
    </span>
  );
}

/** Each tab's words. */
const TAB_LABEL: Record<OrderTab, MessageKey> = {
  all: "orders.viewAll",
  processing: "orders.viewProcessing",
  onTheWay: "orders.viewOnTheWay",
  delivered: "orders.viewDelivered",
  returns: "orders.viewReturns",
  cancelled: "orders.viewCancelled",
  reviews: "orders.viewReviews",
};

const PERIOD_LABEL: Record<OrderPeriod, MessageKey> = {
  all: "orders.periodAll",
  "30": "orders.period30",
  "90": "orders.period90",
  "180": "orders.period180",
  "365": "orders.period365",
};

/**
 * The top of the page, drawn to the owner's reference (a shop's "Your
 * orders"): a bar with the way back at its start, "Your orders" in its middle
 * and a search at its end; then the tabs as plain words in one row that
 * scrolls sideways — All orders, Processing, Shipped, Delivered, Returns,
 * Cancelled, Reviews — the chosen one dark with a short rounded line under
 * it, the rest muted, a hairline under the row. The tabs are `aria-pressed`
 * buttons in a named group (they narrow a list, the portal's `Segmented`
 * rule, not a tablist). The search icon opens the search and the period under
 * the tabs, on the orders' own views; closing it clears both, so nothing
 * narrows the list out of sight.
 */
function OrdersTop({ tab, onTab, q, onSearch, period, onPeriod }: {
  tab: OrderTab;
  onTab: (tab: OrderTab) => void;
  q: string;
  onSearch: (q: string) => void;
  period: OrderPeriod;
  onPeriod: (period: OrderPeriod) => void;
}) {
  const { t } = useTranslation();
  const viewing = isOrderView(tab);
  /* The way back says where it goes, the account sections' rule. */
  const from = cameFrom();
  const backLabel = !from || from.split("?")[0] === "/account" ? t("account.backToAccount") : t("nav.back");
  const panelId = useId();
  const box = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState(Boolean(q) || period !== "all");
  const searching = viewing && (opened || Boolean(q) || period !== "all");

  /* What is typed, sent to the address once typing pauses. The box follows
     the address only when something else changed it (Clear filters), never
     its own search coming back — which would eat a letter typed meanwhile. */
  const [typed, setTyped] = useState(q);
  const sent = useRef(q);
  const send = (value: string) => { sent.current = value; onSearch(value); };
  useEffect(() => {
    if (q !== sent.current) { sent.current = q; setTyped(q); }
  }, [q]);
  useEffect(() => {
    if (typed.trim() === sent.current) return;
    const timer = window.setTimeout(() => send(typed.trim()), 350);
    return () => window.clearTimeout(timer);
  });

  /* The chosen tab in view — Reviews, opened from its old address, is off the
     end of a phone's row. */
  useEffect(() => {
    row.current?.querySelector<HTMLElement>("[aria-pressed=true]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  const toggle = () => {
    if (searching) {
      setOpened(false);
      setTyped("");
      sent.current = "";
      onPeriod("all");
      onSearch("");
    } else {
      setOpened(true);
      window.setTimeout(() => box.current?.focus(), 0);
    }
  };

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <Link
          href="/account"
          onClick={goBack}
          aria-label={backLabel}
          title={backLabel}
          className="-ms-2.5 grid size-11 shrink-0 place-items-center rounded-full text-[#0a285a]"
        >
          <ChevronLeft className="size-7 rtl:-scale-x-100" strokeWidth={1.8} aria-hidden />
        </Link>
        <h2 className="min-w-0 flex-1 truncate text-center text-[20px] font-bold text-[#0a285a]">{t("orders.pageTitle")}</h2>
        {viewing ? (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={searching}
            aria-controls={panelId}
            aria-label={t("orders.searchPlaceholder")}
            title={t("orders.searchPlaceholder")}
            className="-me-2.5 grid size-11 shrink-0 place-items-center rounded-full text-[#0a285a]"
          >
            <Search className="size-6" strokeWidth={1.9} aria-hidden />
          </button>
        ) : (
          <span className="-me-2.5 size-11 shrink-0" aria-hidden />
        )}
      </div>

      <div className="-mx-4 mt-2 border-b border-[#e3e6ec] sm:mx-0">
        <div
          ref={row}
          role="group"
          aria-label={t("orders.viewsLabel")}
          className="flex gap-6 overflow-x-auto px-4 [scrollbar-width:none] sm:px-0"
        >
          {ORDER_TABS.map(entry => {
            const on = tab === entry;
            return (
              <button
                key={entry}
                type="button"
                aria-pressed={on}
                onClick={() => onTab(entry)}
                className={`relative min-h-11 shrink-0 whitespace-nowrap pb-3 pt-1 text-[16px] transition-colors ${on ? "font-semibold text-[#0a285a]" : "font-medium ink-muted hover:text-[#0a285a]"}`}
              >
                {t(TAB_LABEL[entry])}
                <span
                  aria-hidden
                  className={`absolute bottom-0 left-1/2 h-1 w-7 -translate-x-1/2 rounded-full bg-[#0a285a] transition-opacity duration-200 ${on ? "opacity-100" : "opacity-0"}`}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div id={panelId} role="search" hidden={!searching} className="mt-3">
        <div className="flex flex-wrap gap-2">
          <label className="relative flex min-w-[12rem] flex-1 items-center">
            <span className="sr-only">{t("orders.searchLabel")}</span>
            <Search className="pointer-events-none absolute start-3 size-[18px] text-[#5d6b82]" aria-hidden />
            <input
              ref={box}
              type="search"
              value={typed}
              maxLength={ORDER_SEARCH_MAX}
              onChange={event => setTyped(event.target.value)}
              onKeyDown={event => { if (event.key === "Enter") send(typed.trim()); }}
              placeholder={t("orders.searchPlaceholder")}
              enterKeyHint="search"
              autoComplete="off"
              className={`h-11 w-full rounded-xl border border-[#d5dfeb] bg-white ps-10 ${typed ? "pe-11" : "pe-3"} text-[15px] text-[#0a285a] placeholder:text-[#6b7a90] focus:border-[#0a285a] focus:outline-none focus:ring-2 focus:ring-[#0a285a]/15 [&::-webkit-search-cancel-button]:hidden`}
            />
            {typed ? (
              <button
                type="button"
                onClick={() => { setTyped(""); send(""); box.current?.focus(); }}
                aria-label={t("orders.searchClear")}
                className="absolute end-1 grid size-9 place-items-center rounded-full text-[#5d6b82] hover:bg-[#f0f2f5]"
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
          </label>
          <Select
            value={period}
            onChange={event => onPeriod(isOrderPeriod(event.target.value) ? event.target.value : "all")}
            aria-label={t("orders.periodLabel")}
            className="h-11 w-auto min-w-[9.5rem] shrink-0 rounded-xl border border-[#d5dfeb] bg-white px-3 text-[14px] font-semibold text-[#0a285a]"
          >
            {ORDER_PERIODS.map(entry => <option key={entry} value={entry}>{t(PERIOD_LABEL[entry])}</option>)}
          </Select>
        </div>
      </div>
    </div>
  );
}

/** When the filters leave nothing: said so, with the way back to everything. */
function NoMatch({ onClear }: { onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-[1.35rem] border border-dashed border-[#c3ccda] bg-white p-6 text-center">
      <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-[#e7edf5] text-[#0a285a]">
        <Search className="size-5" aria-hidden />
      </span>
      <h3 className="mt-3 text-[16px] font-bold text-[#0a285a]">{t("orders.noMatchTitle")}</h3>
      <p className="mx-auto mt-1 max-w-sm text-[14px] leading-6 ink-muted">{t("orders.noMatchBody")}</p>
      <button type="button" onClick={onClear} className="mt-4 inline-flex min-h-11 items-center rounded-full border border-[#0a285a]/25 bg-white px-4 text-[14px] font-bold text-[#0a285a] hover:bg-[#f0f2f5]">
        {t("orders.clearFilters")}
      </button>
    </div>
  );
}

export function AccountOrders() {
  const { t, locale } = useTranslation();
  const [page, setPage] = useState(1);
  /* Checkout lands here with `?order=` on the order it just placed, open. */
  const search = useSearch();
  const [, navigate] = useLocation();
  /* The filters, read from the address and written back to it. */
  const query = new URLSearchParams(search);
  const rawTab = query.get("view");
  const tab: OrderTab = isOrderTab(rawTab) ? rawTab : "all";
  const rawPeriod = query.get("period");
  const period: OrderPeriod = isOrderPeriod(rawPeriod) ? rawPeriod : "all";
  const q = (query.get("q") ?? "").slice(0, ORDER_SEARCH_MAX);
  const setFilters = (changes: Partial<Record<"view" | "q" | "period", string | null>>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (!value || (key === "view" && value === "all") || (key === "period" && value === "all")) next.delete(key);
      else next.set(key, value);
    }
    /* A filter is a new list: no order left open from the old one. */
    for (const key of ["order", "track", "refund"]) next.delete(key);
    const text = next.toString();
    setPage(1);
    setOpenRef(null);
    navigate(`/account/orders${text ? `?${text}` : ""}`, { replace: true });
  };
  const onSearch = (text: string) => setFilters({ q: text || null });
  const [openRef, setOpenRef] = useState<string | null>(() => new URLSearchParams(search).get("order"));
  /* `&track=1` opens the order on its tracking — where a link about a parcel
     on its way should land. */
  const [trackRef] = useState<string | null>(() => (new URLSearchParams(search).get("track") === "1" ? new URLSearchParams(search).get("order") : null));
  const formatDate = useDateFormat();

  /* `&refund=1`, or the row's "Request a refund": the order opens on its refund form. */
  const [refundRef, setRefundRef] = useState<string | null>(() => (new URLSearchParams(search).get("refund") === "1" ? new URLSearchParams(search).get("order") : null));
  const returnsOn = useFeature("returns");
  /* The row's "Rate your items": the order opens with its first "Rate this item" focused. */
  const [rateRef, setRateRef] = useState<string | null>(null);

  const viewing = isOrderView(tab);
  const list = trpc.orders.list.useQuery(
    { page, view: viewing ? tab : "all", q: q || undefined, period: period === "all" ? undefined : period },
    /* The last answer stays drawn while the next filter is asked, so the
       chips and the list never blink to an outline under the press. */
    { placeholderData: previous => previous },
  );
  const filtered = Boolean(q) || period !== "all" || tab !== "all";

  const tools = (
    <OrdersTop
      tab={tab}
      onTab={next => setFilters({ view: next })}
      q={q}
      onSearch={onSearch}
      period={period}
      onPeriod={next => setFilters({ period: next })}
    />
  );

  if (tab === "returns") return <>{tools}<AccountReturns /></>;
  if (tab === "reviews") return <>{tools}<AccountReviews /></>;

  return (
    <>
    {tools}
    <QueryGate audience="shopper" queries={[list]}>
      {() => {
        const data = list.data;
        /* A link names an order this page does not show — older than the
           first page, or placed from another account (an email opened while
           signed in as somebody else). It is drawn on its own above the list,
           where it says whether it is this account's, rather than the list
           opening on nothing. */
        const linked = openRef && !data?.rows.some(order => order.reference === openRef) ? (
          <section aria-labelledby="linked-order" className="mb-3 rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5">
            <h3 id="linked-order" className="mb-3 text-[15px] font-bold text-[#0a285a]">
              {t("orders.orderHeading", { reference: openRef })}
            </h3>
            <OrderLines reference={openRef} trackFirst={trackRef === openRef} refundFirst={refundRef === openRef} />
          </section>
        ) : null;
        if (!data || data.total === 0) {
          /* Nothing under these filters is not the same as no orders at all. */
          return filtered && ((data?.counts.all ?? 0) > 0 || Boolean(q) || period !== "all")
            ? <>{linked}<NoMatch onClear={() => setFilters({ view: null, q: null, period: null })} /></>
            : <>{linked}<EmptyOrders /></>;
        }

        return (
          <>
            {linked}
            {/*
              A real list, so assistive tech announces "list, 3 items" before
              reading them. A stack of <article>s in a <div> is three unrelated
              things that happen to be near each other.
            */}
            <ul className="space-y-3">
              {data.rows.map(order => {
                const payment = PAYMENT[order.status] ?? PAYMENT.pending_payment;
                const open = openRef === order.reference;
                const summary = order.summary;
                return (
                  <li key={order.id} className="rounded-[1.35rem] border border-[#d5dfeb] bg-white">
                    <h3 className="sr-only">
                      {t("orders.orderHeading", { reference: order.reference })}
                    </h3>
                    <button
                      type="button"
                      onClick={() => { setRefundRef(null); setRateRef(null); setOpenRef(open ? null : order.reference); }}
                      aria-expanded={open}
                      aria-controls={`order-${order.id}-lines`}
                      className="pressable flex w-full items-start gap-4 rounded-[1.35rem] p-4 text-start sm:p-5"
                    >
                      <OrderPhoto photo={summary?.photos[0] ?? null} more={Math.max(0, (summary?.lineCount ?? 1) - 1)} />
                      <span className="min-w-0 flex-1">
                        {summary ? <ProgressPill progress={summary.progress} /> : <Pill label={t(payment.label)} className={payment.className} />}
                        {/* What it is, by the first thing in it — nobody knows
                            their own order by its number. The title is the
                            seller's words, isolated so a Latin name sits
                            right on the Arabic page. */}
                        {summary?.first ? (
                          <span className="mt-2 block truncate text-[15px] font-bold text-[#0a285a]">
                            <bdi>{summary.first.title}</bdi>
                            {summary.lineCount > 1 ? <span className="font-semibold text-[#3d5170]"> {t("orders.andMore", { count: summary.lineCount - 1 })}</span> : null}
                          </span>
                        ) : null}
                        {/* The reference stays on one line: it is read down a
                            phone, and "NL-20261012-" over "3NJA9" is two numbers. */}
                        <span className="mt-1 flex flex-col text-[12px] ink-muted sm:flex-row sm:items-center sm:gap-x-2">
                          <span className="whitespace-nowrap"><span className="sr-only">{t("orders.reference")} </span><bdi dir="ltr">{order.reference}</bdi></span>
                          <span className="hidden sm:inline" aria-hidden>·</span>
                          <span>{formatDate(order.placedAt)}</span>
                        </span>
                        <span className="mt-2 flex flex-wrap items-baseline gap-x-2 sm:hidden">
                          <OrderTotal order={order} />
                        </span>
                      </span>
                      <span className="hidden shrink-0 flex-col items-end gap-1 pt-0.5 sm:flex">
                        <OrderTotal order={order} />
                      </span>
                      <ChevronDown className={`mt-1 size-5 shrink-0 ink-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                    </button>

                    {/* Request a refund from the list, on the owner's word: on an
                        order with something that can still go back — delivered,
                        in the window, nothing asked on it (`summary.refundable`,
                        the server's count by the opened order's own rule). It
                        opens the order on its refund form; open, the order's
                        own button is the one. */}
                    {/* Rate what arrived, from the list (the owner's "rate and
                        review from My Orders"): drawn while the order has an
                        item delivered, paid for and not yet rated
                        (`summary.reviewable`, `eligibilityFor`'s count). */}
                    {!open && ((returnsOn && (summary?.refundable ?? 0) > 0) || (summary?.reviewable ?? 0) > 0) ? (
                      <div className="-mt-1 flex flex-wrap justify-end gap-2 px-4 pb-4 sm:px-5">
                        {(summary?.reviewable ?? 0) > 0 ? (
                          <button
                            type="button"
                            onClick={() => { setRefundRef(null); setRateRef(order.reference); setOpenRef(order.reference); }}
                            className="glass type-control pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 py-1.5 pointer-fine:min-h-9"
                          >
                            <Star className="size-4" aria-hidden />
                            {t("orders.rateItems")}
                            <span className="sr-only">: <bdi>{summary?.first?.title ?? order.reference}</bdi></span>
                          </button>
                        ) : null}
                        {returnsOn && (summary?.refundable ?? 0) > 0 ? (
                          <button
                            type="button"
                            onClick={() => { setRateRef(null); setRefundRef(order.reference); setOpenRef(order.reference); }}
                            className="glass type-control pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 py-1.5 pointer-fine:min-h-9"
                          >
                            <RotateCcw className="size-4 rtl:-scale-x-100" aria-hidden />
                            {t("orders.requestRefund")}
                            <span className="sr-only">: <bdi>{summary?.first?.title ?? order.reference}</bdi></span>
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    <div id={`order-${order.id}-lines`} hidden={!open} className="border-t border-[#e7edf5] px-5 py-4">
                      {open ? (
                        <OrderLines
                          key={refundRef === order.reference ? "refund" : rateRef === order.reference ? "rate" : "plain"}
                          reference={order.reference}
                          trackFirst={trackRef === order.reference}
                          refundFirst={refundRef === order.reference}
                          rateFirst={rateRef === order.reference}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            <Pager page={data} onPage={setPage} />
            {data.atCeiling ? <p className="mt-3 text-[13px] ink-muted">{t("orders.atCeiling")}</p> : null}
          </>
        );
      }}
    </QueryGate>
    </>
  );
}

/**
 * What the order costs now — the figure the driver asks for — and how it is
 * paid. "Pay on delivery" rather than "awaiting payment": the second is the
 * shop's bookkeeping, the first is what the shopper does. A sentence when it
 * differs from what was placed, never a strikethrough: that is how this shop
 * advertises a permitted saving, and a cancelled sofa is not one.
 */
function OrderTotal({ order }: {
  order: { status: string; currency: string; grandTotal: string; owed?: { owed: string; reduced: boolean } | null };
}) {
  const { t, locale } = useTranslation();
  /* An order that is over — refunded or cancelled — shows what it came to,
     beside the word for what became of it. What it "owes" then is nothing,
     and "KWD 0" over a refund reads as an order that cost nothing. */
  const over = order.status === "refunded" || order.status === "cancelled";
  const owes = over ? order.grandTotal : order.owed?.owed ?? order.grandTotal;
  const how: { label: MessageKey; className: string } | null =
    order.status === "paid" ? { label: "orders.statusPaid", className: "text-[#2f5d33]" }
    : order.status === "refunded" ? { label: "orders.statusRefunded", className: "ink-muted" }
    : order.status === "pending_payment" && Number(owes) > 0 ? { label: "orders.payOnDelivery", className: "ink-muted" }
    : null;
  return (
    <>
      <span className="text-[15px] font-extrabold text-[#0a285a]">{formatMoney(owes, { currencyCode: order.currency, locale })}</span>
      {how ? <span className={`text-[12px] font-semibold ${how.className}`}>{t(how.label)}</span> : null}
      {!over && order.owed?.reduced ? <span className="text-[12px] font-semibold ink-muted">{t("orders.cancelledNotCharged")}</span> : null}
    </>
  );
}

/**
 * The lines of one order, fetched only when it is opened.
 *
 * Per order rather than with the list, because the return state is computed
 * per line against the server's clock and a list of fifty orders would resolve
 * fifty windows nobody has asked to see.
 */
function OrderLines({ reference, trackFirst = false, refundFirst = false, rateFirst = false }: { reference: string; trackFirst?: boolean; refundFirst?: boolean; rateFirst?: boolean }) {
  const { t, locale } = useTranslation();
  const returnsOn = useFeature("returns");
  const detail = trpc.orders.get.useQuery({ reference });
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const [rating, setRating] = useState<ReviewTarget | null>(null);
  const rate = (lineId: number) => {
    const line = detail.data?.lines.find(entry => entry.id === lineId);
    if (line) setRating({ orderItemId: line.id, productTitle: line.productTitle, photo: line.photo ?? null, review: line.review });
  };
  /* Opened from the row's "Rate your items": the first item to rate, its
     review form open — the press that asked for it is on the list above. */
  const rated = useRef(false);
  useEffect(() => {
    if (!rateFirst || rated.current || !detail.data) return;
    rated.current = true;
    const first = detail.data.lines.find(line => !line.review && line.reviewEligibility.allowed);
    if (first) rate(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateFirst, detail.data]);

  return (
    <QueryGate audience="shopper" queries={[detail]}>
      {() => {
        const data = detail.data;
        if (!data) return <p className="text-sm ink-muted">{t("orders.detailMissing")}</p>;

        return (
          <OrderAfterSales reference={reference} detail={data} trackFirst={trackFirst} refundFirst={refundFirst} onRate={rate}>
          <ul className="space-y-4">
            {data.lines.map(line => {
              const fulfilment = FULFILMENT[line.fulfilment] ?? FULFILMENT.pending;
              return (
                <li key={line.id}>
                  <div className="flex gap-3">
                  <Thumb src={line.photo ?? null} alt="" className="size-14 shrink-0 rounded-xl border border-[#e7edf5] bg-white object-contain" icon={<PackageSearch className="size-5" />} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <p dir="auto" className="type-product line-clamp-2 min-w-0 flex-1 pt-1.5 text-sm text-[#0a285a]">{line.productTitle}</p>
                      {/* Everything that can be done with this item, on the owner's word. */}
                      <OrderLineMenu line={line} />
                    </div>
                    {line.variantTitle ? <p dir="auto" className="truncate text-xs ink-muted">{line.variantTitle}</p> : null}
                    {/* Where this one went (3.2.6), when it did not go where
                        the rest of the order went — read off the line's own
                        frozen copy, so it still says so after the address has
                        been edited or deleted. */}
                    {line.destination ? <p dir="auto" className="truncate text-xs ink-accent">{t("address.lineWent", { label: line.destination.label })}</p> : null}
                    <p className="mt-1 text-xs ink-muted">
                      {t("orders.quantityAndPrice", {
                        quantity: String(line.quantity),
                        price: formatMoney(line.unitPrice, { currencyCode: data.order.currency, locale }),
                      })}
                    </p>
                    {/* The product's own code (0074), as frozen at the sale. */}
                    {line.discountCode && Number(line.discountAmount) > 0 ? (
                      <p className="mt-0.5 text-xs font-bold text-[#2f5d33]">
                        {t("orders.lineCode", { code: line.discountCode, amount: formatMoney(line.discountAmount, { currencyCode: data.order.currency, locale }) })}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Pill label={t(fulfilment.label)} className={fulfilment.className} />
                      {/*
                        The return affordance draws only where a return is
                        actually open. Everywhere else it says why, which is the
                        useful half: "delivered 20 days ago" and "not paid for"
                        are different problems and a greyed-out button is
                        neither of them.
                      */}
                      {line.returnState.returnable ? (
                        <span className="inline-flex items-start gap-1.5 text-[12px] font-extrabold text-[#2f5d33]">
                          <RotateCcw className="mt-px size-3.5 shrink-0 rtl:-scale-x-100" aria-hidden />
                          {t("returns.openUntil", {
                            date: formatDate(line.returnState.closesAt),
                            days: String(line.returnState.daysLeft),
                          })}
                        </span>
                      ) : (
                        <span className="text-[12px] font-semibold ink-muted">{t(line.returnState.reason)}</span>
                      )}
                    </div>
                    {line.review ? <LineReview review={line.review} /> : null}
                    <LineReturnStatus reference={reference} currency={data.order.currency} line={line} requests={data.returns} />
                  </div>
                  </div>
                  {/* What the item's ⋯ opened, the item's full width. */}
                  <OrderLinePanel line={line} />
                </li>
              );
            })}

            {/* How a return works, said once at the foot. Each item's ⋯ offers
                the return where one is open; this is the policy behind it. */}
            <li className="rounded-xl bg-[#e7edf5] p-4">
              <p className="text-xs leading-5 ink-muted">{t(returnsOn ? "returns.howTo" : "returns.howToPaused", { days: String(data.windowDays) })}</p>
            </li>
          </ul>
          {/* The invoice and any credit notes (3.6.6), once the money has
              been collected — the moment the sale completes. */}
          {data.documents.length > 0 ? (
            <section aria-labelledby={`docs-${reference}`} className="mt-5 border-t border-[#e7edf5] pt-4">
              <h4 id={`docs-${reference}`} className="type-label ink-muted">{t("invoice.documents")}</h4>
              <ul className="mt-2 flex flex-wrap gap-2">
                {data.documents.map(document => (
                  <li key={document.number}>
                    <Link href={`/invoices/${document.number}`} className="glass type-control pressable inline-flex items-center gap-1.5 rounded-full px-3 py-1.5">
                      <FileText className="size-3.5" aria-hidden />
                      {t(document.kind === "credit_note" ? "invoice.creditNoteNumber" : "invoice.invoiceNumber", { number: document.number })}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <ParcelCare reference={reference} currency={data.order.currency} parcels={data.parcels} />
          {rating ? (
            <ReviewDialog
              target={rating}
              onClose={() => setRating(null)}
              onDone={() => { setRating(null); void detail.refetch(); void utils.orders.list.invalidate(); void utils.reviews.mine.invalidate(); }}
            />
          ) : null}
          </OrderAfterSales>
        );
      }}
    </QueryGate>
  );
}

/**
 * No orders.
 *
 * It names the reason rather than leaving a blank panel to imply the history
 * failed to load or that NetLet forgot them. Nothing can be bought yet —
 * payments are the next phase — and saying so is the same honesty the
 * order-tracking card and the search panels already carry.
 */
function EmptyOrders() {
  const { t } = useTranslation();
  const days = useReturnWindow();
  return (
    <div className="rounded-[1.35rem] border border-[#d5dfeb] bg-white p-6 sm:p-8">
      <span className="grid size-12 place-items-center rounded-2xl bg-[#e7edf5] text-[#0a285a]">
        <PackageSearch className="size-6" />
      </span>
      <h3 className="type-product mt-4 text-lg text-[#0a285a]">{t("orders.emptyTitle")}</h3>
      <p className="mt-2 max-w-prose text-sm leading-6 ink-muted">{t("orders.emptyBody")}</p>
      <p className="mt-4 max-w-prose text-xs leading-5 ink-muted">{t("returns.emptyNote", { days: String(days) })}</p>
    </div>
  );
}

/**
 * An item's review, once written: its stars and where it stands. Writing one
 * and changing it are the item's ⋯ ("Rate this item", "Edit your review"),
 * on the owner's word — the rule is `reviewEligibility`, which `reviews.write`
 * refuses with.
 */
function LineReview({ review }: { review: MyReview }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <StarRow value={review.rating} />
      <ReviewStatePill state={review.state} />
    </div>
  );
}
