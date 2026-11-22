/**
 * The filter chips under My orders' tabs, on the owner's word ("a filter
 * option at the top of the my order page in which the user can set custom
 * dates to see the orders they made before — give the user as many options
 * as you can, but keep it as user friendly as possible").
 *
 * One row of chips — When, Store, Payment, Total, Sort — each naming what it
 * holds once something is chosen, navy-rimmed then, and each opening a short
 * sheet of its own (a sheet from the foot of a phone, a card from `sm`): a
 * press on a choice applies it and puts the sheet away. When has the periods,
 * this month and last, every year the shopper ordered in, and two days of
 * their own, from their first order's day to today, which wait for "Show
 * orders". Clear all ends the row while anything narrows the list.
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
import { ArrowUpDown, CalendarDays, Check, ChevronDown, Coins, Store, Wallet, X, type LucideIcon } from "lucide-react";
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

type Group = "when" | "store" | "payment" | "total" | "sort";

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

const GROUP_ICON: Record<Group, LucideIcon> = {
  when: CalendarDays,
  store: Store,
  payment: Wallet,
  total: Coins,
  sort: ArrowUpDown,
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
  const [open, setOpen] = useState<Group | null>(null);
  const today = kuwaitDay(new Date());
  const whenLabel = useWhenLabel();
  const totalLabel = useTotalLabel();
  const storeName = (store: OrderFacets["stores"][number]) => (isArabic && store.nameAr ? store.nameAr : store.name);
  const chosenStore = state.store ? facets.stores.find(store => store.id === state.store) : undefined;

  const set: OrderFilterSet = { period: state.period, from: state.from, to: state.to, store: state.store, payment: state.payment, total: state.total };
  const narrowed = narrowingCount(set) > 0 || state.sort !== "newest";

  /* A chip is drawn where there is something to choose: a store only when the
     shopper has bought from more than one (or one is chosen). */
  const chips: { group: Group; name: string; value: string | null }[] = [
    { group: "when", name: t("orders.chipWhen"), value: whenLabel(state, today) },
    ...(facets.stores.length > 1 || state.store
      ? [{ group: "store" as const, name: t("orders.chipStore"), value: state.store ? (chosenStore ? storeName(chosenStore) : t("orders.storeGone")) : null }]
      : []),
    { group: "payment", name: t("orders.chipPayment"), value: state.payment !== "all" ? t(PAYMENT_LABEL[state.payment]) : null },
    { group: "total", name: t("orders.chipTotal"), value: state.total !== "all" ? totalLabel(state.total) : null },
    { group: "sort", name: t("orders.chipSort"), value: state.sort !== "newest" ? t(SORT_LABEL[state.sort]) : null },
  ];

  const clearAll = () => onChange({ period: null, from: null, to: null, store: null, pay: null, total: null, sort: null });

  return (
    <>
      <div
        role="group"
        aria-label={t("orders.filtersLabel")}
        className="-mx-4 mt-3 flex gap-2 overflow-x-auto overflow-y-hidden px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      >
        {chips.map(chip => {
          const Icon = GROUP_ICON[chip.group];
          const on = chip.value !== null;
          return (
            <button
              key={chip.group}
              type="button"
              aria-haspopup="dialog"
              onClick={() => setOpen(chip.group)}
              /* Its name first and then what it holds, so voice control can say what it sees. */
              aria-label={on ? `${chip.name}: ${chip.value}` : chip.name}
              className={`filter-chip flex h-11 shrink-0 items-center gap-2 rounded-full border ps-3.5 pe-3 text-[14px] text-[#0a285a] ${
                on ? "border-[#0a285a] bg-[#eef2f8] font-bold hover:bg-[#0a285a]/[.06]" : "border-[#d5dfeb] bg-white font-semibold hover:bg-[#f0f2f5]"
              }`}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span dir="auto" className="max-w-[14rem] truncate whitespace-nowrap">{chip.value ?? chip.name}</span>
              <ChevronDown className="size-4 shrink-0 ink-muted" aria-hidden />
            </button>
          );
        })}
        {narrowed ? (
          <button
            type="button"
            onClick={clearAll}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[14px] font-bold ink-accent hover:bg-[#f0f2f5]"
          >
            <X className="size-4" aria-hidden />
            {t("orders.clearAll")}
          </button>
        ) : null}
      </div>

      <FilterSheet
        group={open}
        state={state}
        facets={facets}
        today={today}
        storeName={storeName}
        onClose={() => setOpen(null)}
        onChange={change => { onChange(change); setOpen(null); }}
      />
    </>
  );
}

/**
 * One group's choices. A press on a radio applies it at once; the days of
 * one's own wait for "Show orders", since two boxes are filled one at a time.
 */
function FilterSheet({ group, state, facets, today, storeName, onClose, onChange }: {
  group: Group | null;
  state: OrderFilterState;
  facets: OrderFacets;
  today: string;
  storeName: (store: OrderFacets["stores"][number]) => string;
  onClose: () => void;
  onChange: (change: OrderFilterChange) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const totalLabel = useTotalLabel();
  const open = group !== null;
  useOverlay(open, onClose);
  /* The sheet keeps the group it was opened for while it plays its way out. */
  const [shown, setShown] = useState<Group>("when");
  if (group && group !== shown) setShown(group);
  useEffect(() => {
    if (open) window.setTimeout(() => closeRef.current?.focus(), 40);
  }, [open]);
  const { mounted, closing } = usePresence(open);
  if (!mounted) return null;

  const title: Record<Group, MessageKey> = {
    when: "orders.whenTitle",
    store: "orders.storeTitle",
    payment: "orders.paymentTitle",
    total: "orders.totalTitle",
    sort: "orders.sortTitle",
  };

  const months = monthRanges(today);
  const custom = Boolean(state.from || state.to)
    && !(state.from === months.thisMonth.from && state.to === months.thisMonth.to)
    && !(state.from === months.lastMonth.from && state.to === months.lastMonth.to)
    && yearOfRange(state.from, state.to) === null;

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
        className="overlay-sheet flex max-h-[88svh] w-full flex-col rounded-t-[1.5rem] bg-white shadow-[0_-12px_40px_rgba(10,40,90,.22)] sm:max-h-[86vh] sm:max-w-[440px] sm:rounded-3xl sm:shadow-[0_24px_60px_rgba(10,40,90,.28)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[#e6e9ef] px-5 py-3">
          <h2 id={titleId} className="min-w-0 truncate text-[16px] font-extrabold text-[#0a285a]">{t(title[shown])}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t("common.close")} className="-me-2 grid size-11 shrink-0 place-items-center rounded-full hover:bg-[#f0f2f5]">
            <X className="size-5 text-[#0a285a]" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:pb-4">
          {shown === "when" ? (
            <>
              {/* The quick spans and the years as pills, so the days of
                  one's own fit on a phone's first screen of the sheet. */}
              <div role="group" aria-labelledby={titleId} className="flex flex-wrap gap-2 px-3 pt-2">
                {ORDER_PERIODS.map(period => (
                  <DayPill
                    key={period}
                    chosen={!state.from && !state.to && state.period === period}
                    onPick={() => onChange({ period: period === "all" ? null : period, from: null, to: null })}
                  >
                    {t(PERIOD_LABEL[period])}
                  </DayPill>
                ))}
                <DayPill
                  chosen={state.from === months.thisMonth.from && state.to === months.thisMonth.to}
                  onPick={() => onChange({ period: null, ...months.thisMonth })}
                >
                  {t("orders.whenThisMonth")}
                </DayPill>
                <DayPill
                  chosen={state.from === months.lastMonth.from && state.to === months.lastMonth.to}
                  onPick={() => onChange({ period: null, ...months.lastMonth })}
                >
                  {t("orders.whenLastMonth")}
                </DayPill>
              </div>
              {facets.years.length ? (
                <>
                  <h3 id={`${titleId}-years`} className="mt-4 px-3 text-[13px] font-bold text-[#3d5170]">{t("orders.whenYears")}</h3>
                  <div role="group" aria-labelledby={`${titleId}-years`} className="mt-2 flex flex-wrap gap-2 px-3">
                    {facets.years.map(year => (
                      <DayPill key={year} chosen={yearOfRange(state.from, state.to) === year} onPick={() => onChange({ period: null, ...yearRange(year) })}>
                        {year}
                      </DayPill>
                    ))}
                  </div>
                </>
              ) : null}
              <CustomDays
                from={custom ? state.from : null}
                to={custom ? state.to : null}
                firstDay={facets.firstDay}
                today={today}
                onApply={(from, to) => onChange({ period: null, from, to })}
              />
            </>
          ) : shown === "store" ? (
            <Choices labelledBy={titleId}>
              <Choice chosen={!state.store} onPick={() => onChange({ store: null })}>{t("orders.storeAny")}</Choice>
              {facets.stores.map(store => (
                <Choice key={store.id} chosen={state.store === store.id} onPick={() => onChange({ store: String(store.id) })} count={store.count}>
                  <bdi>{storeName(store)}</bdi>
                </Choice>
              ))}
            </Choices>
          ) : shown === "payment" ? (
            <Choices labelledBy={titleId}>
              {ORDER_PAYMENTS.map(payment => (
                <Choice key={payment} chosen={state.payment === payment} onPick={() => onChange({ pay: payment === "all" ? null : payment })}>
                  {t(PAYMENT_LABEL[payment])}
                </Choice>
              ))}
            </Choices>
          ) : shown === "total" ? (
            <Choices labelledBy={titleId}>
              {ORDER_TOTALS.map(band => (
                <Choice key={band} chosen={state.total === band} onPick={() => onChange({ total: band === "all" ? null : band })}>
                  {totalLabel(band)}
                </Choice>
              ))}
            </Choices>
          ) : (
            <Choices labelledBy={titleId}>
              {ORDER_SORTS.map(sort => (
                <Choice key={sort} chosen={state.sort === sort} onPick={() => onChange({ sort: sort === "newest" ? null : sort })}>
                  {t(SORT_LABEL[sort])}
                </Choice>
              ))}
            </Choices>
          )}
        </div>
      </div>
    </div>
  );
}

/** A span of time as a pill: navy-rimmed once chosen. */
function DayPill({ chosen, onPick, children }: { chosen: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      onClick={onPick}
      className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-[14px] text-[#0a285a] ${
        chosen ? "border-[#0a285a] bg-[#eef2f8] font-bold hover:bg-[#0a285a]/[.06]" : "border-[#d5dfeb] bg-white font-semibold hover:bg-[#f0f2f5]"
      }`}
    >
      {chosen ? <Check className="size-4 shrink-0" strokeWidth={3} aria-hidden /> : null}
      {children}
    </button>
  );
}

function Choices({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return <div role="radiogroup" aria-labelledby={labelledBy}>{children}</div>;
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

/**
 * Two days of one's own: From and To, either left empty, from the first
 * order's day to today. "Show orders" applies them; a To before the From is
 * said under it with the press and focused, never swapped behind the
 * shopper's back.
 */
function CustomDays({ from, to, firstDay, today, onApply }: {
  from: string | null;
  to: string | null;
  firstDay: string | null;
  today: string;
  onApply: (from: string | null, to: string | null) => void;
}) {
  const { t } = useTranslation();
  const [start, setStart] = useState(from ?? "");
  const [end, setEnd] = useState(to ?? "");
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const fromId = useId();
  const toId = useId();
  const problemId = useId();

  const apply = () => {
    const first = isCalendarDay(start) ? start : null;
    const last = isCalendarDay(end) ? end : null;
    if (!first && !last) { setProblem("orders.whenNeedsDay"); endRef.current?.focus(); return; }
    if (first && last && first > last) { setProblem("orders.whenBackwards"); endRef.current?.focus(); return; }
    setProblem(null);
    onApply(first, last);
  };

  const box = "h-12 w-full rounded-xl border bg-white px-3 text-[15px] text-[#0a285a] focus:outline-none focus:ring-2 focus:ring-[#0a285a]/15";
  return (
    <section aria-labelledby={`${fromId}-heading`} className="mx-3 mt-4 rounded-2xl border border-[#e6e9ef] bg-[#f7f9fc] p-4">
      <h3 id={`${fromId}-heading`} className="text-[14px] font-bold text-[#0a285a]">{t("orders.whenCustom")}</h3>
      <p className="mt-1 text-[13px] leading-5 ink-muted">{t("orders.whenCustomHint")}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={fromId} className="mb-1 block text-[13px] font-semibold text-[#3d5170]">{t("orders.whenFrom")}</label>
          <input
            id={fromId}
            type="date"
            value={start}
            min={firstDay ?? undefined}
            max={today}
            onChange={event => { setStart(event.target.value); setProblem(null); }}
            className={`${box} border-[#d5dfeb] focus:border-[#0a285a]`}
          />
        </div>
        <div>
          <label htmlFor={toId} className="mb-1 block text-[13px] font-semibold text-[#3d5170]">{t("orders.whenTo")}</label>
          <input
            ref={endRef}
            id={toId}
            type="date"
            value={end}
            min={start || firstDay || undefined}
            max={today}
            onChange={event => { setEnd(event.target.value); setProblem(null); }}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? problemId : undefined}
            className={`${box} ${problem ? "border-[#b42318] focus:border-[#b42318]" : "border-[#d5dfeb] focus:border-[#0a285a]"}`}
          />
        </div>
      </div>
      {problem ? <p id={problemId} className="mt-2 text-[13px] font-semibold text-[#b42318]">{t(problem)}</p> : null}
      <button
        type="button"
        onClick={apply}
        className="mt-3 h-12 w-full rounded-full bg-[#0a285a] text-[15px] font-bold text-white hover:bg-[#0d3372]"
      >
        {t("orders.whenApply")}
      </button>
    </section>
  );
}
