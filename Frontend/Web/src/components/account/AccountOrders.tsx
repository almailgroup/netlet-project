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
 * **Its top is a search bar with a filter button beside it, on the owner's
 * word** ("all bar up removed, only add search bar and in the side filter";
 * `OrderSearchAndFilter`): the search finds an order by its number, anything
 * in it or its store, and the filter is a page of its own — the order's
 * status or the returns and refunds asked for (`AccountReturns`, drawn in
 * place), the last 30 days or 3 months or two days of one's own, and a year.
 * The reviews left the page on the owner's word (each item is rated under its
 * photo); an old `?view=reviews` still draws `AccountReviews`. The row of tabs,
 * the sort and the store, payment and total filters went. All of it is in
 * the address (`?view=`, `?q=`, `?period=`, `?from=`, `?to=`), the browse
 * pages' rule, and decided by the server over every order
 * (`Shared/commerce/orderFilters.ts`), never over one page. The list is
 * newest first, each order saying when it was ordered.
 */
import { isOnlineMethod } from "@shared/commerce/onlinePayment";
import { QueryGate } from "@/components/ui/QueryGate";
import { Pager } from "@/components/ui/Pager";
import { Thumb } from "@/components/product/Thumb";
import { ParcelCare } from "@/components/account/ParcelCare";
import { LineReturnStatus } from "@/components/account/LineReturn";
import { useFeature } from "@/hooks/useFeature";
import { formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { useSlotWords } from "@/hooks/useSlotWords";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useReturnWindow } from "@/hooks/useReturnWindow";
import type { MessageKey } from "@shared/i18n/dictionary";
import { rateLabel } from "@shared/commerce/tax";
import { CalendarDays, ChevronDown, ChevronLeft, FileText, PackageSearch, RotateCcw, Search, Truck, type LucideIcon } from "lucide-react";
import { cameFrom, goBack } from "@/lib/inAppBack";
import { Link, useLocation, useSearch } from "wouter";
import { useState, type ReactNode } from "react";
import { AccountReturns } from "@/components/account/AccountReturns";
import { AccountReviews } from "@/components/account/AccountReviews";
import { isCalendarDay, isOrderPeriod, isOrderTab, isOrderView, ORDER_SEARCH_MAX, type OrderTab } from "@shared/commerce/orderFilters";
import { OrderSearchAndFilter, filtersOn, type OrderFacets, type OrderFilterChange, type OrderFilterState } from "@/components/account/OrderFilters";
import { ReviewDialog, type MyReview, type ReviewTarget } from "@/components/reviews/ReviewDialog";
import { ReviewStatePill } from "@/components/reviews/ReviewStatePill";
import { LineExpected, LineStatus, OrderAfterSales, OrderLineChoice, OrderLinePanel, OrderLinePhoto, OrderLineRow, OrderLineTitle } from "@/components/account/OrderActions";

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
 * The picture an order is recognised by: its first product's photograph, with
 * how many more things are in it. Decorative to a screen reader, which hears
 * the names beside it.
 */
/**
 * What is in the order, by its pictures — several, on the owner's word ("show
 * more than one picture of the orders"): up to four of its items' photos side
 * by side (`summary.photos`, the server's, one per product), and a tile saying
 * how many more there are. For the eye alone: the order's number names it.
 */
function OrderPhotos({ photos, count }: { photos: string[]; count: number }) {
  const shown = photos.slice(0, 4);
  const more = Math.max(0, count - Math.max(shown.length, 1));
  /* Five columns of at most 56px that narrow together on a small phone, so
     the count never wraps under the pictures (it did at 390). */
  const tile = "aspect-square w-full rounded-2xl border border-[#e7edf5] bg-white object-contain";
  return (
    <span className="grid grid-cols-[repeat(5,minmax(0,3.5rem))] gap-2" aria-hidden>
      {shown.length === 0 ? (
        <Thumb src={null} alt="" className={tile} icon={<PackageSearch className="size-6" />} />
      ) : shown.map(photo => (
        <Thumb key={photo} src={photo} alt="" className={tile} icon={<PackageSearch className="size-6" />} />
      ))}
      {more > 0 ? (
        <span className="grid aspect-square w-full place-items-center rounded-2xl bg-[#eef2f8] text-[14px] font-extrabold text-[#0a285a]">
          <bdi dir="ltr">+{more}</bdi>
        </span>
      ) : null}
    </span>
  );
}

/** One order's row on My orders. */
type OrderRowData = {
  id: number;
  reference: string;
  status: string;
  currency: string;
  grandTotal: string;
  paymentMethod?: string | null;
  placedAt: string | Date;
  owed?: { owed: string; reduced: boolean } | null;
  summary?: { lineCount: number; photos: string[]; progress: { kind: string } } | null;
};

/**
 * One order on My orders: its pictures, its number, the day it was ordered,
 * what it comes to and how it is paid, and Track order — the owner's list of
 * what the row carries, nothing more. The opened order is `children`.
 */
export function OrderListRow({ order, open, onToggle, onTrack, children }: {
  order: OrderRowData;
  open: boolean;
  onToggle: () => void;
  onTrack: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const formatDate = useDateFormat();
  const payment = PAYMENT[order.status] ?? PAYMENT.pending_payment;
  const summary = order.summary;
  return (
    <li className="rounded-[1.35rem] border border-[#d5dfeb] bg-white">
      <h3 className="sr-only">
        {t("orders.orderHeading", { reference: order.reference })}
      </h3>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`order-${order.id}-lines`}
        className="pressable block w-full rounded-[1.35rem] p-4 text-start sm:p-5"
      >
        {/* The order's main facts and nothing else, on the owner's word
            ("more than one picture of the orders, also order number and date
            and the amount and payment method and track order only"): its
            pictures, the card's whole width, then its number, when it was
            ordered, and what it comes to and how it is paid. Where each item
            is, and rating or returning it, are the opened order's
            (`ItemStatus`, the chosen items' bar). */}
        <OrderPhotos photos={summary?.photos ?? []} count={summary?.lineCount ?? 1} />
        <span className="mt-3 flex items-start gap-3">
          <span className="min-w-0 flex-1">
            {/* A server older than the summary says how it is paid. */}
            {summary ? null : <Pill label={t(payment.label)} className={payment.className} />}
            {/* The number stays on one line: it is read down a phone, and
                "NL-20261012-" over "3NJA9" is two numbers. */}
            <span className="block whitespace-nowrap text-[15px] font-extrabold text-[#0a285a]">
              <span className="sr-only">{t("orders.reference")} </span><bdi dir="ltr">{order.reference}</bdi>
            </span>
            <span className="mt-0.5 block text-[13px] font-semibold text-[#3d5170]">{t("orders.orderedOn", { date: formatDate(order.placedAt) })}</span>
            <span className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <OrderTotal order={order} />
            </span>
          </span>
          <ChevronDown className={`mt-0.5 size-5 shrink-0 ink-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </span>
      </button>

      {/* Track order, the one press on the list, on the owner's
          word: it opens the order on where its parcels are. An
          order cancelled whole has nothing to follow. */}
      {!open && summary?.progress.kind !== "cancelled" ? (
        <div className="border-t border-[#e7edf5] px-2 py-1.5">
          <button
            type="button"
            onClick={onTrack}
            className="pressable inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl px-3 text-[14px] font-bold text-[#0a285a] hover:bg-[#f0f2f5]"
          >
            <Truck className="size-[18px] rtl:-scale-x-100" aria-hidden />
            {t("orders.track")}
            <span className="sr-only">: <bdi dir="ltr">{order.reference}</bdi></span>
          </button>
        </div>
      ) : null}
      {children}
    </li>
  );
}

/**
 * The top of the page: a bar with the way back at its start and "Your
 * orders" in its middle, then the search bar with the filter button beside it
 * (`OrderSearchAndFilter`) — **no tabs and no sort, on the owner's word**
 * ("all bar up removed, only add search bar and in the side filter"); the
 * statuses with the returns and refunds, and the dates, are on the filter page.
 */
function OrdersTop({ search }: { search: ReactNode }) {
  const { t } = useTranslation();
  /* The way back says where it goes, the account sections' rule. */
  const from = cameFrom();
  const backLabel = !from || from.split("?")[0] === "/account" ? t("account.backToAccount") : t("nav.back");
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
        <span className="-me-2.5 size-11 shrink-0" aria-hidden />
      </div>
      {search}
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
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  /* Checkout lands here with `?order=` on the order it just placed, open. */
  const search = useSearch();
  const [, navigate] = useLocation();
  /* The filters, read from the address and written back to it: a status or
     a list, a search, and a date. An older address's store, payment, total
     or sort are not read: the filter page no longer offers them. */
  const query = new URLSearchParams(search);
  const rawTab = query.get("view");
  const tab: OrderTab = isOrderTab(rawTab) ? rawTab : "all";
  const q = (query.get("q") ?? "").slice(0, ORDER_SEARCH_MAX);
  const rawPeriod = query.get("period");
  const rawFrom = query.get("from");
  const rawTo = query.get("to");
  const chosen: OrderFilterState = {
    tab,
    period: isOrderPeriod(rawPeriod) ? rawPeriod : "all",
    from: isCalendarDay(rawFrom) ? rawFrom : null,
    to: isCalendarDay(rawTo) ? rawTo : null,
  };
  const setFilters = (changes: OrderFilterChange) => {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (!value || (key === "view" && value === "all") || (key === "period" && value === "all")) next.delete(key);
      else next.set(key, value);
    }
    /* What the filter page no longer offers goes with any change. */
    for (const key of ["store", "pay", "total", "sort"]) next.delete(key);
    /* A filter is a new list: no order left open from the old one. */
    for (const key of ["order", "track", "refund"]) next.delete(key);
    const text = next.toString();
    setPage(1);
    setOpenRef(null);
    navigate(`/account/orders${text ? `?${text}` : ""}`, { replace: true });
  };
  const [openRef, setOpenRef] = useState<string | null>(() => new URLSearchParams(search).get("order"));
  /* `&track=1` opens the order on its tracking — where a link about a parcel
     on its way should land. */
  const [trackRef, setTrackRef] = useState<string | null>(() => (new URLSearchParams(search).get("track") === "1" ? new URLSearchParams(search).get("order") : null));

  /* `&refund=1` (a notice, the help centre): the order opens on its refund form. */
  const [refundRef, setRefundRef] = useState<string | null>(() => (new URLSearchParams(search).get("refund") === "1" ? new URLSearchParams(search).get("order") : null));

  const viewing = isOrderView(tab);
  const list = trpc.orders.list.useQuery(
    {
      page,
      view: viewing ? tab : "all",
      q: q || undefined,
      period: chosen.period === "all" ? undefined : chosen.period,
      from: chosen.from ?? undefined,
      to: chosen.to ?? undefined,
    },
    /* The last answer stays drawn while the next filter is asked, so the
       chips and the list never blink to an outline under the press. */
    { placeholderData: previous => previous },
  );
  const narrowing = filtersOn({ ...chosen, tab: viewing ? tab : "all" }) > 0;
  const filtered = Boolean(q) || narrowing;
  const clearEverything = () => setFilters({ view: null, q: null, period: null, from: null, to: null });
  /* The years come with the answer; before the first, nothing to choose from. */
  const facets: OrderFacets = list.data?.facets ?? { stores: [], years: [], firstDay: null };

  const tools = (
    <OrdersTop search={<OrderSearchAndFilter state={chosen} q={q} facets={facets} onChange={setFilters} />} />
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
            <OrderLines reference={openRef} trackFirst={trackRef === openRef} refundFirst={refundRef === openRef} dated />
          </section>
        ) : null;
        if (!data || data.total === 0) {
          /* Nothing under these filters is not the same as no orders at all. */
          return filtered && ((data?.counts.all ?? 0) > 0 || Boolean(q) || narrowing)
            ? <>{linked}<NoMatch onClear={clearEverything} /></>
            : <>{linked}<EmptyOrders /></>;
        }

        return (
          <>
            {linked}
            {/* How many the filters left, while anything narrows the list. */}
            {Boolean(q) || narrowing ? (
              <p className="mb-3 text-[13px] font-semibold text-[#3d5170]" aria-live="polite">
                {t("orders.foundCount", { count: data.total })}
              </p>
            ) : null}
            {/*
              A real list, so assistive tech announces "list, 3 items" before
              reading them. A stack of <article>s in a <div> is three unrelated
              things that happen to be near each other.
            */}
            <ul className="space-y-3">
              {data.rows.map(order => {
                const open = openRef === order.reference;
                return (
                  <OrderListRow
                    key={order.id}
                    order={order}
                    open={open}
                    onToggle={() => { setRefundRef(null); setTrackRef(null); setOpenRef(open ? null : order.reference); }}
                    onTrack={() => { setRefundRef(null); setTrackRef(order.reference); setOpenRef(order.reference); }}
                  >
                    <div id={`order-${order.id}-lines`} hidden={!open} className="border-t border-[#e7edf5] px-4 py-4 sm:px-5">
                      {open ? (
                        <OrderLines
                          key={refundRef === order.reference ? "refund" : trackRef === order.reference ? "track" : "plain"}
                          reference={order.reference}
                          trackFirst={trackRef === order.reference}
                          refundFirst={refundRef === order.reference}
                        />
                      ) : null}
                    </div>
                  </OrderListRow>
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
  order: { status: string; currency: string; grandTotal: string; paymentMethod?: string | null; owed?: { owed: string; reduced: boolean } | null };
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
    /* Paid online instead (0086): the driver collects nothing. */
    : order.status === "pending_payment" && isOnlineMethod(order.paymentMethod) ? { label: "orders.paidOnline", className: "text-[#2f5d33]" }
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
function OrderLines({ reference, trackFirst = false, refundFirst = false, dated = false }: { reference: string; trackFirst?: boolean; refundFirst?: boolean; dated?: boolean }) {
  const { t, locale } = useTranslation();
  const returnsOn = useFeature("returns");
  const detail = trpc.orders.get.useQuery({ reference });
  const formatDate = useDateFormat();
  const slotWords = useSlotWords();
  const utils = trpc.useUtils();
  const [rating, setRating] = useState<ReviewTarget | null>(null);
  const rate = (lineId: number) => {
    const line = detail.data?.lines.find(entry => entry.id === lineId);
    if (line) setRating({ orderItemId: line.id, productTitle: line.productTitle, photo: line.photo ?? null, review: line.review });
  };

  return (
    <QueryGate audience="shopper" queries={[detail]}>
      {() => {
        const data = detail.data;
        if (!data) return <p className="text-sm ink-muted">{t("orders.detailMissing")}</p>;

        return (
          <>
          {/* An order a link opened on its own has no row over it saying when
              it was ordered, so it says so under its title (on the owner's word). */}
          {dated ? <p className="-mt-2 mb-3 text-[13px] font-semibold text-[#3d5170]">{t("orders.orderedOn", { date: formatDate(data.order.placedAt) })}</p> : null}
          <OrderAfterSales reference={reference} detail={data} trackFirst={trackFirst} refundFirst={refundFirst} onRate={rate}>
          {/* The day and time asked of each store in the cart (0085), as frozen. */}
          {data.deliverySlots.length ? (
            <ul className="mb-4 space-y-1.5 rounded-xl bg-[#f7f9fc] px-4 py-3">
              {data.deliverySlots.map(slot => {
                const vendor = data.lines.find(line => line.vendorId === slot.vendorId)?.vendorName;
                return (
                  <li key={`${slot.vendorId ?? "store"}-${slot.date}`} className="flex items-start gap-2 text-[13px] font-semibold leading-5 text-[#404553]">
                    <CalendarDays className="mt-0.5 size-4 shrink-0 text-[#0a285a]" aria-hidden />
                    <span>{vendor ? <><bdi>{t("delivery.parcelFrom", { vendor })}</bdi> · </> : null}{t("storeDelivery.preferred", { slot: slotWords.slot(slot) })}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <ul className="space-y-4">
            {data.lines.map(line => {
              return (
                <li key={line.id}>
                  {/* A press on the item's words opens where it is and on its
                      photo its product, or chooses it while the order is
                      edited (on the owner's word). */}
                  <OrderLineRow line={line}>
                  {/* Chosen for the bar's acts, the cart's own circle (on the owner's word). */}
                  <OrderLineChoice line={line} />
                  {/* The photo, the size the owner drew it ("I prefer the item
                      picture this size"), and under it where the item is — once
                      it has arrived, its review — the picture at the row's start
                      and the word after it (on the owner's word). */}
                  <div className="flex w-[76px] shrink-0 flex-col items-stretch gap-2 min-[360px]:w-24">
                    <OrderLinePhoto line={line}>
                      <Thumb src={line.photo ?? null} alt="" className="size-[76px] rounded-2xl border border-[#e7edf5] bg-white object-contain min-[360px]:size-24" icon={<PackageSearch className="size-6" />} />
                    </OrderLinePhoto>
                    <LineStatus line={line} detail={data} />
                  </div>
                  <div className="min-w-0 flex-1">
                    {/* What can be done with it is the bar's, once its circle is
                        chosen — the item has no ⋯ of its own (on the owner's word). */}
                    <OrderLineTitle line={line} />
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
                    {/* When this item is expected, while it is still coming. */}
                    <LineExpected line={line} detail={data} />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
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
                  </OrderLineRow>
                  {/* What the bar opened for this item, the item's full width. */}
                  <OrderLinePanel line={line} />
                </li>
              );
            })}

            {/* How a return works, said once at the foot. A chosen item's bar
                offers the return where one is open; this is the policy behind it. */}
            <li className="rounded-xl bg-[#e7edf5] p-4">
              <p className="text-xs leading-5 ink-muted">{t(returnsOn ? "returns.howTo" : "returns.howToPaused", { days: String(data.windowDays) })}</p>
            </li>
          </ul>
          {/* The tax added at checkout (0087), part of the total on the row. */}
          {data.tax ? (
            <p className="mt-3 text-xs font-semibold ink-muted">
              {t("orders.taxIncluded", { rate: rateLabel(data.tax.rate), amount: formatMoney(data.tax.amount, { currencyCode: data.order.currency, locale }) })}
            </p>
          ) : null}
          {/* The invoice and any credit notes (3.6.6) once the money has
              been collected — the moment the sale completes. The receipt is
              at the order's top now, on the owner's word (`ReceiptButton`). */}
          {data.documents.length > 0 ? (
            <section aria-labelledby={`docs-${reference}`} className="mt-5 border-t border-[#e7edf5] pt-4">
              <h4 id={`docs-${reference}`} className="type-label ink-muted">{t(data.documents.some(document => document.kind === "credit_note") ? "orders.invoiceAndCredit" : "invoice.title")}</h4>
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
          </>
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
/** Where the review stands; its stars are under the photo, with Edit. */
function LineReview({ review }: { review: MyReview }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <ReviewStatePill state={review.state} />
    </div>
  );
}
