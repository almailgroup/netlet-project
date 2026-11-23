/**
 * The filters under My orders' tabs, on the owner's word ("a filter option at
 * the top of the my order page in which the user can set custom dates … give
 * the user as many options as you can, but keep it as user friendly as
 * possible") — **organised, on the owner's word** ("organize the filter
 * options for the my orders page, make it better and enhanced").
 *
 * Two buttons: **Filters**, with how many are on, and **Sort**, naming the
 * order the list is in. Filters opens one sheet (from the foot of a phone, a
 * card from `sm`) with every choice in its own section — the date, the store
 * (once there is more than one), how it was paid and the total — chosen as
 * pills and applied together by "Show orders", with Reset beside it. The date
 * has the periods, this month and last, every year the shopper ordered in, and
 * "Choose dates" for two days of their own, from the first order's day to
 * today. Sort is a short list where a press applies at once. Under the two,
 * each filter that is on is a chip of its own with a cross that takes just
 * that one off, and Clear all takes them all.
 *
 * Nothing here filters: the page writes the choice into the address and the
 * server answers over every order (`Shared/commerce/orderFilters.ts`), and the
 * choices themselves — the stores, the years, the first day — come back with
 * that answer, read over every order so a chip can always be changed back.
 */
import {
  isCalendarDay, narrowingCount, ORDER_PAYMENTS, ORDER_PERIODS, ORDER_SORTS, ORDER_TOTALS, yearOfRange, yearRange,
  type OrderFilterSet, type OrderPayment, type OrderPeriod, type OrderSort, type OrderTotal,
} from "@shared/commerce/orderFilters";
import { kuwaitDay } from "@shared/kuwaitDay";
import type { MessageKey } from "@shared/i18n/dictionary";
import { ArrowUpDown, CalendarDays, Check, ChevronDown, Coins, SlidersHorizontal, Store, Wallet, X, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { SHOP_TIME_ZONE } from "@/hooks/useDateFormat";
import { useOverlay } from "@/hooks/useOverlay";
import { usePresence } from "@/hooks/usePresence";

export type OrderFacets = {
  stores: { id: number; name: string; nameAr: string | null; count: number }[];
  years: number[];
  firstDay: string | null;
};

/** What the address holds, read whole; the page passes it down and writes changes back. */
export type OrderFilterState = {
  period: OrderPeriod;
  from: string | null;
  to: string | null;
  store: number | null;
  payment: OrderPayment;
  total: OrderTotal;
  sort: OrderSort;
};

export type OrderFilterChange = Partial<Record<"period" | "from" | "to" | "store" | "pay" | "total" | "sort", string | null>>;

type Section = "when" | "store" | "payment" | "total";

export const PERIOD_LABEL: Record<OrderPeriod, MessageKey> = {
  all: "orders.periodAll",
  "30": "orders.period30",
  "90": "orders.period90",
  "180": "orders.period180",
  "365": "orders.period365",
};

const PAYMENT_LABEL: Record<OrderPayment, MessageKey> = {
  all: "orders.payAny",
  cod: "orders.payCash",
  online: "orders.payOnline",
};

const SORT_LABEL: Record<OrderSort, MessageKey> = {
  newest: "orders.sortNewest",
  oldest: "orders.sortOldest",
  highest: "orders.sortHighest",
  lowest: "orders.sortLowest",
};

const SECTION_ICON: Record<Section, LucideIcon> = {
  when: CalendarDays,
  store: Store,
  payment: Wallet,
  total: Coins,
};

/** The first and last day of this month and the last one, as Kuwait counts them. */
function monthRanges(today: string) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const days = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (value: number) => String(value).padStart(2, "0");
  const lastYear = month === 1 ? year - 1 : year;
  const lastMonth = month === 1 ? 12 : month - 1;
  return {
    thisMonth: { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(days(year, month))}` },
    lastMonth: { from: `${lastYear}-${pad(lastMonth)}-01`, to: `${lastYear}-${pad(lastMonth)}-${pad(days(lastYear, lastMonth))}` },
  };
}

/** The words a total band is said in. */
function useTotalLabel() {
  const { t } = useTranslation();
  return (band: OrderTotal): string => {
    switch (band) {
      case "all": return t("orders.totalAny");
      case "under10": return t("orders.totalUnder", { amount: "10" });
      case "10to50": return t("orders.totalBetween", { low: "10", high: "50" });
      case "50to100": return t("orders.totalBetween", { low: "50", high: "100" });
      case "over100": return t("orders.totalOver", { amount: "100" });
    }
  };
}

/** What the When chip says: a period, this month or last, a year, or the days chosen. */
function useWhenLabel() {
  const { t, isArabic } = useTranslation();
  /* Short, since a chip holds it: "1 Oct 2026". */
  const day = (value: string) => new Date(`${value}T12:00:00+03:00`).toLocaleDateString(isArabic ? "ar-KW-u-nu-latn" : "en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: SHOP_TIME_ZONE,
  });
  return (state: OrderFilterState, today: string): string | null => {
    const months = monthRanges(today);
    if (state.from || state.to) {
      if (state.from === months.thisMonth.from && state.to === months.thisMonth.to) return t("orders.whenThisMonth");
      if (state.from === months.lastMonth.from && state.to === months.lastMonth.to) return t("orders.whenLastMonth");
      const year = yearOfRange(state.from, state.to);
      if (year !== null) return String(year);
      if (state.from && state.to) return t("orders.whenBetween", { from: day(state.from), to: day(state.to) });
      if (state.from) return t("orders.whenSince", { date: day(state.from) });
      if (state.to) return t("orders.whenUntil", { date: day(state.to) });
    }
    return state.period !== "all" ? t(PERIOD_LABEL[state.period]) : null;
  };
}

export function OrderFilterChips({ state, facets, onChange }: {
  state: OrderFilterState;
  facets: OrderFacets;
  onChange: (change: OrderFilterChange) => void;
}) {
  const { t, isArabic } = useTranslation();
  const [open, setOpen] = useState<"filters" | "sort" | null>(null);
  const today = kuwaitDay(new Date());
  const whenLabel = useWhenLabel();
  const totalLabel = useTotalLabel();
  const storeName = (store: OrderFacets["stores"][number]) => (isArabic && store.nameAr ? store.nameAr : store.name);
  const chosenStore = state.store ? facets.stores.find(store => store.id === state.store) : undefined;

  const set: OrderFilterSet = { period: state.period, from: state.from, to: state.to, store: state.store, payment: state.payment, total: state.total };
  const count = narrowingCount(set);

  /* Each filter that is on, as a chip with a cross for just that one. */
  const on: { section: Section; value: string; clear: OrderFilterChange }[] = [];
  const when = whenLabel(state, today);
  if (when) on.push({ section: "when", value: when, clear: { period: null, from: null, to: null } });
  if (state.store) on.push({ section: "store", value: chosenStore ? storeName(chosenStore) : t("orders.storeGone"), clear: { store: null } });
  if (state.payment !== "all") on.push({ section: "payment", value: t(PAYMENT_LABEL[state.payment]), clear: { pay: null } });
  if (state.total !== "all") on.push({ section: "total", value: totalLabel(state.total), clear: { total: null } });

  const clearAll = () => onChange({ period: null, from: null, to: null, store: null, pay: null, total: null, sort: null });
  const bar = "filter-chip flex h-11 min-w-0 items-center gap-2 rounded-full border px-4 text-[14px] text-[#0a285a]";

  return (
    <>
      <div role="group" aria-label={t("orders.filtersLabel")} className="mt-3 flex gap-2">
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setOpen("filters")}
          aria-label={count ? `${t("orders.filters")} (${count})` : t("orders.filters")}
          className={`${bar} flex-1 justify-center sm:flex-none ${count ? "border-[#0a285a] bg-[#eef2f8] font-bold hover:bg-[#0a285a]/[.06]" : "border-[#d5dfeb] bg-white font-semibold hover:bg-[#f0f2f5]"}`}
        >
          <SlidersHorizontal className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{t("orders.filters")}</span>
          {count ? <span aria-hidden className="grid h-5 min-w-5 place-items-center rounded-full bg-[#0a285a] px-1.5 text-[12px] font-bold tabular-nums text-white">{count}</span> : null}
        </button>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setOpen("sort")}
          /* Its name first and then what it holds, so voice control can say what it sees. */
          aria-label={`${t("orders.chipSort")}: ${t(SORT_LABEL[state.sort])}`}
          className={`${bar} flex-1 justify-center sm:flex-none ${state.sort !== "newest" ? "border-[#0a285a] bg-[#eef2f8] font-bold hover:bg-[#0a285a]/[.06]" : "border-[#d5dfeb] bg-white font-semibold hover:bg-[#f0f2f5]"}`}
        >
          <ArrowUpDown className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{t(SORT_LABEL[state.sort])}</span>
          <ChevronDown className="size-4 shrink-0 ink-muted" aria-hidden />
        </button>
      </div>
      {on.length || state.sort !== "newest" ? (
        <ul aria-label={t("orders.filtersOnLabel")} className="-mx-4 mt-2 flex items-center gap-2 overflow-x-auto overflow-y-hidden px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {on.map(chip => {
            const Icon = SECTION_ICON[chip.section];
            return (
              <li key={chip.section} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onChange(chip.clear)}
                  aria-label={t("orders.removeFilter", { name: chip.value })}
                  className="flex h-9 max-w-[16rem] items-center gap-1.5 rounded-full bg-[#0a285a] pe-2 ps-3 text-[13px] font-semibold text-white hover:bg-[#0d3372]"
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  <span dir="auto" className="truncate">{chip.value}</span>
                  <X className="size-4 shrink-0 opacity-80" aria-hidden />
                </button>
              </li>
            );
          })}
          <li className="shrink-0">
            <button type="button" onClick={clearAll} className="flex h-9 items-center gap-1 rounded-full px-2.5 text-[13px] font-bold ink-accent hover:bg-[#f0f2f5]">
              {t("orders.clearAll")}
            </button>
          </li>
        </ul>
      ) : null}

      <FiltersSheet
        open={open === "filters"}
        state={state}
        facets={facets}
        today={today}
        storeName={storeName}
        onClose={() => setOpen(null)}
        onApply={change => { onChange(change); setOpen(null); }}
      />
      <SortSheet
        open={open === "sort"}
        sort={state.sort}
        onClose={() => setOpen(null)}
        onPick={sort => { onChange({ sort: sort === "newest" ? null : sort }); setOpen(null); }}
      />
    </>
  );
}

/** The sheet itself: a sheet from the foot of a phone, a card from `sm`, with a title and Close. */
function Sheet({ open, title, onClose, footer, children }: { open: boolean; title: string; onClose: () => void; footer?: ReactNode; children: ReactNode }) {
  const { t } = useTranslation();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useOverlay(open, onClose);
  useEffect(() => {
    if (open) window.setTimeout(() => closeRef.current?.focus(), 40);
  }, [open]);
  const { mounted, closing } = usePresence(open);
  if (!mounted) return null;
  return (
    <div
      className="overlay-scrim fixed inset-0 z-[80] grid items-end bg-[#061b3b]/40 sm:place-items-center sm:p-4"
      data-closing={closing ? "" : undefined}
      inert={closing}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={event => event.stopPropagation()}
        className="overlay-sheet flex max-h-[90svh] w-full flex-col rounded-t-[1.5rem] bg-white shadow-[0_-12px_40px_rgba(10,40,90,.22)] sm:max-h-[86vh] sm:max-w-[480px] sm:rounded-3xl sm:shadow-[0_24px_60px_rgba(10,40,90,.28)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[#e6e9ef] px-5 py-3">
          <h2 id={titleId} className="min-w-0 truncate text-[16px] font-extrabold text-[#0a285a]">{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t("common.close")} className="-me-2 grid size-11 shrink-0 place-items-center rounded-full hover:bg-[#f0f2f5]">
            <X className="size-5 text-[#0a285a]" aria-hidden />
          </button>
        </div>
        <div className={`flex-1 overflow-y-auto px-5 pt-2 ${footer ? "pb-4" : "pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4"}`}>{children}</div>
        {footer ? <div className="border-t border-[#e6e9ef] px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:pb-4">{footer}</div> : null}
      </div>
    </div>
  );
}

type Draft = { period: OrderPeriod; from: string | null; to: string | null; custom: boolean; store: number | null; payment: OrderPayment; total: OrderTotal };

/** What the address holds, as the sheet's draft: a span of one's own is "Choose dates". */
function draftOf(state: OrderFilterState, today: string): Draft {
  const months = monthRanges(today);
  const named = (state.from === months.thisMonth.from && state.to === months.thisMonth.to)
    || (state.from === months.lastMonth.from && state.to === months.lastMonth.to)
    || yearOfRange(state.from, state.to) !== null;
  return {
    period: state.period,
    from: state.from,
    to: state.to,
    custom: Boolean(state.from || state.to) && !named,
    store: state.store,
    payment: state.payment,
    total: state.total,
  };
}

const EMPTY_DRAFT: Draft = { period: "all", from: null, to: null, custom: false, store: null, payment: "all", total: "all" };

/**
 * Every filter in one sheet, a section each, applied together by "Show
 * orders" — so somebody narrowing by a year and a store chooses both before
 * the list moves. Reset empties the draft; nothing changes until Show orders.
 */
function FiltersSheet({ open, state, facets, today, storeName, onClose, onApply }: {
  open: boolean;
  state: OrderFilterState;
  facets: OrderFacets;
  today: string;
  storeName: (store: OrderFacets["stores"][number]) => string;
  onClose: () => void;
  onApply: (change: OrderFilterChange) => void;
}) {
  const { t } = useTranslation();
  const totalLabel = useTotalLabel();
  const [draft, setDraft] = useState<Draft>(() => draftOf(state, today));
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const fromId = useId();
  const toId = useId();
  const problemId = useId();
  /* Each opening starts from what the list holds now. */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setDraft(draftOf(state, today)); setProblem(null); }
  }
  const months = monthRanges(today);
  const change = (next: Partial<Draft>) => { setDraft(current => ({ ...current, ...next })); setProblem(null); };
  const span = (from: string, to: string) => change({ period: "all", from, to, custom: false });
  const showStores = facets.stores.length > 1 || draft.store !== null;

  const apply = () => {
    let from = draft.from;
    let to = draft.to;
    if (draft.custom) {
      from = from && isCalendarDay(from) ? from : null;
      to = to && isCalendarDay(to) ? to : null;
      if (!from && !to) { setProblem("orders.whenNeedsDay"); endRef.current?.focus(); return; }
      if (from && to && from > to) { setProblem("orders.whenBackwards"); endRef.current?.focus(); return; }
    }
    const dated = Boolean(from || to);
    onApply({
      period: dated || draft.period === "all" ? null : draft.period,
      from,
      to,
      store: draft.store === null ? null : String(draft.store),
      pay: draft.payment === "all" ? null : draft.payment,
      total: draft.total === "all" ? null : draft.total,
    });
  };

  const undated = !draft.custom && !draft.from && !draft.to;
  const box = "h-12 w-full rounded-xl border bg-white px-3 text-[15px] text-[#0a285a] focus:outline-none focus:ring-2 focus:ring-[#0a285a]/15";

  return (
    <Sheet
      open={open}
      title={t("orders.filtersLabel")}
      onClose={onClose}
      footer={(
        <div className="flex gap-3">
          <button type="button" onClick={() => { setDraft(EMPTY_DRAFT); setProblem(null); }} className="h-12 shrink-0 rounded-full border border-[#d5dfeb] bg-white px-5 text-[15px] font-bold text-[#0a285a] hover:bg-[#f0f2f5]">
            {t("orders.reset")}
          </button>
          <button type="button" onClick={apply} className="h-12 min-w-0 flex-1 rounded-full bg-[#0a285a] px-5 text-[15px] font-bold text-white hover:bg-[#0d3372]">
            {t("orders.whenApply")}
          </button>
        </div>
      )}
    >
      <FilterSection section="when" title={t("orders.whenTitle")}>
        <div className="flex flex-wrap gap-2">
          {ORDER_PERIODS.map(period => (
            <DayPill key={period} chosen={undated && draft.period === period} onPick={() => change({ period, from: null, to: null, custom: false })}>
              {t(PERIOD_LABEL[period])}
            </DayPill>
          ))}
          <DayPill chosen={!draft.custom && draft.from === months.thisMonth.from && draft.to === months.thisMonth.to} onPick={() => span(months.thisMonth.from, months.thisMonth.to)}>
            {t("orders.whenThisMonth")}
          </DayPill>
          <DayPill chosen={!draft.custom && draft.from === months.lastMonth.from && draft.to === months.lastMonth.to} onPick={() => span(months.lastMonth.from, months.lastMonth.to)}>
            {t("orders.whenLastMonth")}
          </DayPill>
          <DayPill chosen={draft.custom} onPick={() => change({ period: "all", custom: true, from: draft.custom ? draft.from : null, to: draft.custom ? draft.to : null })}>
            {t("orders.whenChoose")}
          </DayPill>
        </div>
        {facets.years.length ? (
          <>
            <h4 className="mt-4 text-[13px] font-bold text-[#3d5170]">{t("orders.whenYears")}</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {facets.years.map(year => (
                <DayPill key={year} chosen={!draft.custom && yearOfRange(draft.from, draft.to) === year} onPick={() => { const whole = yearRange(year); span(whole.from, whole.to); }}>
                  {year}
                </DayPill>
              ))}
            </div>
          </>
        ) : null}
        {draft.custom ? (
          <div className="mt-4 rounded-2xl border border-[#e6e9ef] bg-[#f7f9fc] p-4">
            <p className="text-[13px] leading-5 ink-muted">{t("orders.whenCustomHint")}</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={fromId} className="mb-1 block text-[13px] font-semibold text-[#3d5170]">{t("orders.whenFrom")}</label>
                <input id={fromId} type="date" value={draft.from ?? ""} min={facets.firstDay ?? undefined} max={today} onChange={event => change({ from: event.target.value || null })} className={`${box} border-[#d5dfeb] focus:border-[#0a285a]`} />
              </div>
              <div>
                <label htmlFor={toId} className="mb-1 block text-[13px] font-semibold text-[#3d5170]">{t("orders.whenTo")}</label>
                <input
                  ref={endRef}
                  id={toId}
                  type="date"
                  value={draft.to ?? ""}
                  min={draft.from || facets.firstDay || undefined}
                  max={today}
                  onChange={event => change({ to: event.target.value || null })}
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={problem ? problemId : undefined}
                  className={`${box} ${problem ? "border-[#b42318] focus:border-[#b42318]" : "border-[#d5dfeb] focus:border-[#0a285a]"}`}
                />
              </div>
            </div>
            {problem ? <p id={problemId} className="mt-2 text-[13px] font-semibold text-[#b42318]">{t(problem)}</p> : null}
          </div>
        ) : null}
      </FilterSection>
      {showStores ? (
        <FilterSection section="store" title={t("orders.storeTitle")}>
          <div className="flex flex-wrap gap-2">
            <DayPill chosen={draft.store === null} onPick={() => change({ store: null })}>{t("orders.storeAny")}</DayPill>
            {facets.stores.map(store => (
              <DayPill key={store.id} chosen={draft.store === store.id} onPick={() => change({ store: store.id })} count={store.count}>
                <bdi>{storeName(store)}</bdi>
              </DayPill>
            ))}
          </div>
        </FilterSection>
      ) : null}
      <FilterSection section="payment" title={t("orders.paymentTitle")}>
        <div className="flex flex-wrap gap-2">
          {ORDER_PAYMENTS.map(payment => (
            <DayPill key={payment} chosen={draft.payment === payment} onPick={() => change({ payment })}>{t(PAYMENT_LABEL[payment])}</DayPill>
          ))}
        </div>
      </FilterSection>
      <FilterSection section="total" title={t("orders.totalTitle")} last>
        <div className="flex flex-wrap gap-2">
          {ORDER_TOTALS.map(band => (
            <DayPill key={band} chosen={draft.total === band} onPick={() => change({ total: band })}>{totalLabel(band)}</DayPill>
          ))}
        </div>
      </FilterSection>
    </Sheet>
  );
}

/** One section of the sheet: its icon and name, then its pills. */
function FilterSection({ section, title, last = false, children }: { section: Section; title: string; last?: boolean; children: ReactNode }) {
  const Icon = SECTION_ICON[section];
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={`py-4 ${last ? "" : "border-b border-[#eef1f5]"}`}>
      <h3 id={headingId} className="mb-3 flex items-center gap-2 text-[15px] font-extrabold text-[#0a285a]">
        <span aria-hidden className="grid size-8 place-items-center rounded-full bg-[#eef2f8]"><Icon className="size-4" /></span>
        {title}
      </h3>
      <div role="group" aria-labelledby={headingId}>{children}</div>
    </section>
  );
}

/** The orders' order, a short list: a press applies it and puts the sheet away. */
function SortSheet({ open, sort, onClose, onPick }: { open: boolean; sort: OrderSort; onClose: () => void; onPick: (sort: OrderSort) => void }) {
  const { t } = useTranslation();
  const headingId = useId();
  return (
    <Sheet open={open} title={t("orders.sortTitle")} onClose={onClose}>
      <span id={headingId} className="sr-only">{t("orders.sortTitle")}</span>
      <div role="radiogroup" aria-labelledby={headingId} className="-mx-2 py-1">
        {ORDER_SORTS.map(each => (
          <Choice key={each} chosen={sort === each} onPick={() => onPick(each)}>
            {t(SORT_LABEL[each])}
          </Choice>
        ))}
      </div>
    </Sheet>
  );
}

/** A choice as a pill: navy-rimmed with a tick once chosen, a count where there is one. */
function DayPill({ chosen, onPick, count, children }: { chosen: boolean; onPick: () => void; count?: number; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      onClick={onPick}
      className={`inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border px-4 py-1.5 text-[14px] text-[#0a285a] ${
        chosen ? "border-[#0a285a] bg-[#eef2f8] font-bold hover:bg-[#0a285a]/[.06]" : "border-[#d5dfeb] bg-white font-semibold hover:bg-[#f0f2f5]"
      }`}
    >
      {chosen ? <Check className="size-4 shrink-0" strokeWidth={3} aria-hidden /> : null}
      <span className="min-w-0 truncate">{children}</span>
      {count !== undefined ? <span className="shrink-0 text-[12px] font-semibold ink-muted">{count}</span> : null}
    </button>
  );
}

function Choice({ chosen, onPick, count, children }: { chosen: boolean; onPick: () => void; count?: number; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      onClick={onPick}
      className={`flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 text-start text-[15px] text-[#0a285a] hover:bg-[#f0f2f5] ${chosen ? "font-bold" : "font-medium"}`}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined ? <span className="shrink-0 text-[13px] font-semibold ink-muted">{count}</span> : null}
      <span className={`grid size-5 shrink-0 place-items-center rounded-full ${chosen ? "bg-[#0a285a] text-white" : "border-2 border-[#c6d1e0]"}`} aria-hidden>
        {chosen ? <Check className="size-3" strokeWidth={3.5} /> : null}
      </span>
    </button>
  );
}
