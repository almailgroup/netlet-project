/**
 * My orders' search and filter, on the owner's word ("all bar up removed,
 * only add search bar and in the side filter"): a search bar with a filter
 * button beside it, and the filter **a page of its own** — the whole screen on
 * a phone, a card from `sm` — never a row of tabs, a sort or a store list.
 *
 * The page asks three things, each a short row of pills, chosen together and
 * applied by "Show orders", with Reset beside it:
 *
 * - **Order status** (`ORDER_STATUSES`): received, being prepared, shipped,
 *   delivered, cancelled — the owner's "pending, received, ready to ship,
 *   shipped, delivered", in NetLet's own steps.
 * - **When**: the last 30 days, the last 3 months, or two days of one's own
 *   (`ORDER_DATE_CHOICES`); and by year, the newest with a More button for the
 *   years before it, on the owner's word.
 * - **Returns and reviews** (`ORDER_LISTS`): the lists that were the last two
 *   tabs, here because the tabs went.
 *
 * A pill pressed again is taken off. **No store list, on the owner's word**
 * ("he can search by the filter bar for any name — in future maybe he will
 * buy from 100 stores"): the search finds an order by its store's name. No
 * payment or total either. Under the bar, each filter that is on is a chip
 * with a cross, and Clear all takes them all.
 *
 * Nothing here filters: the page writes the choice into the address and the
 * server answers over every order (`Shared/commerce/orderFilters.ts`); the
 * years come back with that answer, read over every order.
 */
import {
  isCalendarDay, ORDER_DATE_CHOICES, ORDER_LISTS, ORDER_SEARCH_MAX, ORDER_STATUSES, yearOfRange, yearRange,
  type OrderPeriod, type OrderTab,
} from "@shared/commerce/orderFilters";
import { kuwaitDay } from "@shared/kuwaitDay";
import type { MessageKey } from "@shared/i18n/dictionary";
import { CalendarDays, Check, ListChecks, MessageSquareText, Search, SlidersHorizontal, X, type LucideIcon } from "lucide-react";
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
  /** Every order, a status, or one of the two lists. */
  tab: OrderTab;
  period: OrderPeriod;
  from: string | null;
  to: string | null;
};

export type OrderFilterChange = Partial<Record<"view" | "q" | "period" | "from" | "to", string | null>>;

/** Each status's words: the row's own phrase for the first two, the old tabs' for the rest. */
export const STATUS_LABEL: Record<OrderTab, MessageKey> = {
  all: "orders.viewAll",
  received: "orders.progressReceived",
  preparing: "orders.progressPreparing",
  processing: "orders.viewProcessing",
  onTheWay: "orders.viewOnTheWay",
  delivered: "orders.viewDelivered",
  cancelled: "orders.viewCancelled",
  returns: "orders.viewReturns",
  reviews: "orders.viewReviews",
};

const PERIOD_LABEL: Record<(typeof ORDER_DATE_CHOICES)[number], MessageKey> = {
  "30": "orders.period30",
  "90": "orders.period90",
};

const isList = (tab: OrderTab) => (ORDER_LISTS as readonly string[]).includes(tab);

/** What the date chip says: a period, a year, or the days chosen. */
function useWhenLabel() {
  const { t, isArabic } = useTranslation();
  /* Short, since a chip holds it: "1 Oct 2026". */
  const day = (value: string) => new Date(`${value}T12:00:00+03:00`).toLocaleDateString(isArabic ? "ar-KW-u-nu-latn" : "en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: SHOP_TIME_ZONE,
  });
  return (state: OrderFilterState): string | null => {
    if (state.from || state.to) {
      const year = yearOfRange(state.from, state.to);
      if (year !== null) return String(year);
      if (state.from && state.to) return t("orders.whenBetween", { from: day(state.from), to: day(state.to) });
      if (state.from) return t("orders.whenSince", { date: day(state.from) });
      if (state.to) return t("orders.whenUntil", { date: day(state.to) });
    }
    return state.period === "30" || state.period === "90" ? t(PERIOD_LABEL[state.period]) : null;
  };
}

/** How many filters are on: the status or list, and the date, once. */
export function filtersOn(state: OrderFilterState): number {
  const dated = state.period !== "all" || Boolean(state.from || state.to);
  return (state.tab !== "all" ? 1 : 0) + (dated ? 1 : 0);
}

/**
 * The search bar and, at its end, the filter button saying how many filters
 * are on; under them a chip for each filter that is on. What is typed goes
 * to the address once typing pauses; the box follows the address only when
 * something else changed it (Clear all), never its own search coming back.
 */
export function OrderSearchAndFilter({ state, q, facets, onChange }: {
  state: OrderFilterState;
  q: string;
  facets: OrderFacets;
  onChange: (change: OrderFilterChange) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const whenLabel = useWhenLabel();
  const count = filtersOn(state);
  const box = useRef<HTMLInputElement>(null);

  const [typed, setTyped] = useState(q);
  const sent = useRef(q);
  /* A search is of the orders: from Returns or Reviews it goes back to them. */
  const send = (value: string) => {
    sent.current = value;
    onChange(isList(state.tab) && value ? { q: value || null, view: null } : { q: value || null });
  };
  useEffect(() => {
    if (q !== sent.current) { sent.current = q; setTyped(q); }
  }, [q]);
  useEffect(() => {
    if (typed.trim() === sent.current) return;
    const timer = window.setTimeout(() => send(typed.trim()), 350);
    return () => window.clearTimeout(timer);
  });

  /* Each filter that is on, as a chip with a cross for just that one. */
  const on: { key: string; icon: LucideIcon; value: string; clear: OrderFilterChange }[] = [];
  if (state.tab !== "all") on.push({ key: "status", icon: isList(state.tab) ? MessageSquareText : ListChecks, value: t(STATUS_LABEL[state.tab]), clear: { view: null } });
  const when = whenLabel(state);
  if (when) on.push({ key: "when", icon: CalendarDays, value: when, clear: { period: null, from: null, to: null } });

  return (
    <>
      <div role="search" className="mt-3 flex items-center gap-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <span className="sr-only">{t("orders.searchLabel")}</span>
          <Search className="pointer-events-none absolute start-3.5 size-[18px] text-[#5d6b82]" aria-hidden />
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
            className={`h-12 w-full rounded-full border border-[#d5dfeb] bg-white ps-11 ${typed ? "pe-11" : "pe-4"} text-[15px] text-[#0a285a] placeholder:text-[#6b7a90] focus:border-[#0a285a] focus:outline-none focus:ring-2 focus:ring-[#0a285a]/15 [&::-webkit-search-cancel-button]:hidden`}
          />
          {typed ? (
            <button
              type="button"
              onClick={() => { setTyped(""); send(""); box.current?.focus(); }}
              aria-label={t("orders.searchClear")}
              className="absolute end-1.5 grid size-9 place-items-center rounded-full text-[#5d6b82] hover:bg-[#f0f2f5]"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </label>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          aria-label={count ? `${t("orders.filters")} (${count})` : t("orders.filters")}
          title={t("orders.filters")}
          className={`relative grid size-12 shrink-0 place-items-center rounded-full border text-[#0a285a] ${count ? "border-[#0a285a] bg-[#eef2f8] hover:bg-[#0a285a]/[.06]" : "border-[#d5dfeb] bg-white hover:bg-[#f0f2f5]"}`}
        >
          <SlidersHorizontal className="size-5" aria-hidden />
          {count ? (
            <span aria-hidden className="absolute -end-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#0a285a] px-1 text-[11px] font-bold tabular-nums text-white ring-2 ring-white">{count}</span>
          ) : null}
        </button>
      </div>
      {on.length ? (
        <ul aria-label={t("orders.filtersOnLabel")} className="-mx-4 mt-2 flex items-center gap-2 overflow-x-auto overflow-y-hidden px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {on.map(chip => (
            <li key={chip.key} className="shrink-0">
              <button
                type="button"
                onClick={() => onChange(chip.clear)}
                aria-label={t("orders.removeFilter", { name: chip.value })}
                className="flex h-9 max-w-[16rem] items-center gap-1.5 rounded-full bg-[#0a285a] pe-2 ps-3 text-[13px] font-semibold text-white hover:bg-[#0d3372]"
              >
                <chip.icon className="size-3.5 shrink-0" aria-hidden />
                <span dir="auto" className="truncate">{chip.value}</span>
                <X className="size-4 shrink-0 opacity-80" aria-hidden />
              </button>
            </li>
          ))}
          <li className="shrink-0">
            <button type="button" onClick={() => onChange({ view: null, period: null, from: null, to: null })} className="flex h-9 items-center gap-1 rounded-full px-2.5 text-[13px] font-bold ink-accent hover:bg-[#f0f2f5]">
              {t("orders.clearAll")}
            </button>
          </li>
        </ul>
      ) : null}

      <FilterPage
        open={open}
        state={state}
        facets={facets}
        onClose={() => setOpen(false)}
        onApply={change => { onChange(change); setOpen(false); }}
      />
    </>
  );
}

type Draft = { tab: OrderTab; period: OrderPeriod; from: string | null; to: string | null; custom: boolean };

/** What the address holds, as the page's draft: a span of one's own is "Choose dates". */
function draftOf(state: OrderFilterState): Draft {
  return {
    tab: state.tab === "processing" ? "all" : state.tab,
    period: state.period,
    from: state.from,
    to: state.to,
    custom: Boolean(state.from || state.to) && yearOfRange(state.from, state.to) === null,
  };
}

const EMPTY_DRAFT: Draft = { tab: "all", period: "all", from: null, to: null, custom: false };

/**
 * The filter page: the whole screen on a phone, a card from `sm`, with its
 * title and Close; every choice in a section of its own, applied together by
 * "Show orders" so somebody choosing a status and a year chooses both before
 * the list moves. Reset empties the draft; nothing changes until Show orders.
 */
function FilterPage({ open, state, facets, onClose, onApply }: {
  open: boolean;
  state: OrderFilterState;
  facets: OrderFacets;
  onClose: () => void;
  onApply: (change: OrderFilterChange) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(state));
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [allYears, setAllYears] = useState(false);
  const endRef = useRef<HTMLInputElement>(null);
  const fromId = useId();
  const toId = useId();
  const problemId = useId();
  const today = kuwaitDay(new Date());
  useOverlay(open, onClose);
  useEffect(() => {
    if (open) window.setTimeout(() => closeRef.current?.focus(), 40);
  }, [open]);
  /* Each opening starts from what the list holds now. */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setDraft(draftOf(state)); setProblem(null); setAllYears(false); }
  }
  const { mounted, closing } = usePresence(open);
  if (!mounted) return null;

  const change = (next: Partial<Draft>) => { setDraft(current => ({ ...current, ...next })); setProblem(null); };
  /* A pill pressed again is taken off. */
  const pickTab = (tab: OrderTab) => change({ tab: draft.tab === tab ? "all" : tab });
  const undated = !draft.custom && !draft.from && !draft.to;
  const pickPeriod = (period: OrderPeriod) => change(undated && draft.period === period ? { period: "all" } : { period, from: null, to: null, custom: false });
  const chosenYear = !draft.custom ? yearOfRange(draft.from, draft.to) : null;
  const pickYear = (year: number) => {
    if (chosenYear === year) { change({ from: null, to: null }); return; }
    const whole = yearRange(year);
    change({ period: "all", from: whole.from, to: whole.to, custom: false });
  };
  /* The newest year, and the rest behind More (the owner's "2026, then a more icon"). */
  const years = facets.years;
  const shownYears = allYears ? years : years.slice(0, 1).concat(chosenYear !== null && chosenYear !== years[0] ? [chosenYear] : []);

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
      view: draft.tab === "all" ? null : draft.tab,
      period: dated || draft.period === "all" ? null : draft.period,
      from,
      to,
    });
  };

  const box = "h-12 w-full rounded-xl border bg-white px-3 text-[15px] text-[#0a285a] focus:outline-none focus:ring-2 focus:ring-[#0a285a]/15";

  return (
    <div
      className="overlay-scrim fixed inset-0 z-[80] grid bg-[#061b3b]/40 sm:place-items-center sm:p-4"
      data-closing={closing ? "" : undefined}
      inert={closing}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={event => event.stopPropagation()}
        className="overlay-sheet flex h-[100svh] w-full flex-col bg-white sm:h-auto sm:max-h-[86vh] sm:max-w-[480px] sm:rounded-3xl sm:shadow-[0_24px_60px_rgba(10,40,90,.28)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[#e6e9ef] px-5 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <h2 id={titleId} className="min-w-0 truncate text-[17px] font-extrabold text-[#0a285a]">{t("orders.filtersLabel")}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t("common.close")} className="-me-2 grid size-11 shrink-0 place-items-center rounded-full hover:bg-[#f0f2f5]">
            <X className="size-5 text-[#0a285a]" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4 pt-2">
          <FilterSection icon={ListChecks} title={t("orders.statusTitle")}>
            <div className="flex flex-wrap gap-2">
              {ORDER_STATUSES.map(status => (
                <Pill key={status} chosen={draft.tab === status} onPick={() => pickTab(status)}>{t(STATUS_LABEL[status])}</Pill>
              ))}
            </div>
          </FilterSection>
          <FilterSection icon={CalendarDays} title={t("orders.whenTitle")}>
            <div className="flex flex-wrap gap-2">
              {ORDER_DATE_CHOICES.map(period => (
                <Pill key={period} chosen={undated && draft.period === period} onPick={() => pickPeriod(period)}>{t(PERIOD_LABEL[period])}</Pill>
              ))}
              <Pill chosen={draft.custom} onPick={() => change(draft.custom ? { custom: false, from: null, to: null } : { period: "all", custom: true, from: null, to: null })}>
                {t("orders.whenChoose")}
              </Pill>
            </div>
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
            {years.length ? (
              <>
                <h4 className="mt-4 text-[13px] font-bold text-[#3d5170]">{t("orders.whenYears")}</h4>
                <div className="mt-2 flex flex-wrap gap-2">
                  {shownYears.map(year => (
                    <Pill key={year} chosen={chosenYear === year} onPick={() => pickYear(year)}>{year}</Pill>
                  ))}
                  {!allYears && years.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setAllYears(true)}
                      aria-expanded={false}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[14px] font-bold ink-accent hover:bg-[#f0f2f5]"
                    >
                      {t("orders.moreYears")}
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </FilterSection>
          <FilterSection icon={MessageSquareText} title={t("orders.listsTitle")} last>
            <div className="flex flex-wrap gap-2">
              {ORDER_LISTS.map(list => (
                <Pill key={list} chosen={draft.tab === list} onPick={() => pickTab(list)}>{t(STATUS_LABEL[list])}</Pill>
              ))}
            </div>
          </FilterSection>
        </div>
        <div className="flex gap-3 border-t border-[#e6e9ef] px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:pb-4">
          <button type="button" onClick={() => { setDraft(EMPTY_DRAFT); setProblem(null); }} className="h-12 shrink-0 rounded-full border border-[#d5dfeb] bg-white px-5 text-[15px] font-bold text-[#0a285a] hover:bg-[#f0f2f5]">
            {t("orders.reset")}
          </button>
          <button type="button" onClick={apply} className="h-12 min-w-0 flex-1 rounded-full bg-[#0a285a] px-5 text-[15px] font-bold text-white hover:bg-[#0d3372]">
            {t("orders.whenApply")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One section of the page: its icon and name, then its pills. */
function FilterSection({ icon: Icon, title, last = false, children }: { icon: LucideIcon; title: string; last?: boolean; children: ReactNode }) {
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

/** A choice as a pill: navy-rimmed with a tick once chosen; pressed again, taken off. */
function Pill({ chosen, onPick, children }: { chosen: boolean; onPick: () => void; children: ReactNode }) {
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
    </button>
  );
}
