/**
 * The pieces the placement pages share: a Kuwaiti day spelled out, a run of
 * days, and the calendar a store books or asks from — the Placements page and
 * the Sponsored products page both draw it, so the two cannot count a day's
 * places differently.
 */
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Notice, SkeletonRows, smallButtonClass } from "@/components/admin/ui";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { MAX_AD_DAYS, MAX_AD_LEAD_DAYS, addDays, daysInclusive, type AdSlot, type CalendarDay } from "@shared/commerce/adBookings";

/** A Kuwaiti calendar day, spelled out in the reader's language. */
export function useDay() {
  const format = useDateFormat();
  /* Noon UTC, so no reader's own timezone can tip the day either way. */
  return (day: string) => format(`${day}T12:00:00Z`);
}

/** "4 to 6 October", or just the day when a run is one day long. */
export function useRun() {
  const { t } = useTranslation();
  const day = useDay();
  return (from: string, to: string) => (from === to ? day(from) : t("ads.runsLine", { from: day(from), to: day(to) }));
}

/**
 * The calendar a store books from (3.3.15): each day with how many places are
 * still free, a month at a time, Sunday first — the Kuwaiti week. The first
 * press picks the first day and the second the last; a run never takes a
 * full day, because the booking would refuse it. The date and length fields
 * above stay for a keyboard and are the same two values.
 */
export function PlacementCalendar({ productId, slot, startsOn, days, onPick }: {
  productId: number;
  slot: AdSlot;
  startsOn: string;
  days: number;
  onPick: (startsOn: string, days: number) => void;
}) {
  const { t, tError, isArabic } = useTranslation();
  const money = useMoney();
  const day = useDay();
  const calendar = trpc.ads.calendar.useQuery({ productId, slot }, { staleTime: 30_000 });
  const [anchor, setAnchor] = useState<string | null>(null);
  const [monthIndex, setMonthIndex] = useState(0);

  const months = useMemo(() => {
    const byMonth = new Map<string, CalendarDay[]>();
    for (const entry of calendar.data?.days ?? []) {
      const key = entry.date.slice(0, 7);
      byMonth.set(key, [...(byMonth.get(key) ?? []), entry]);
    }
    return [...byMonth.entries()];
  }, [calendar.data]);

  if (calendar.isLoading) return <SkeletonRows rows={2} label={t("admin.loading")} />;
  if (calendar.isError) return <Notice tone="danger">{tError(calendar.error.message)}</Notice>;
  const data = calendar.data;
  if (!data || !months.length) return null;

  const lastStart = addDays(data.today, MAX_AD_LEAD_DAYS);
  const runEnd = days > 0 ? addDays(startsOn, days - 1) : null;
  const inRun = (date: string) => runEnd !== null && startsOn <= date && date <= runEnd;
  const byDate = new Map(data.days.map(entry => [entry.date, entry]));

  const press = (date: string) => {
    const entry = byDate.get(date);
    if (!entry || entry.free === 0) return;
    if (anchor && date >= anchor) {
      const length = daysInclusive(anchor, date);
      /* Every day between has to have room, or the run would be refused. */
      const blocked = Array.from({ length }, (_, offset) => byDate.get(addDays(anchor, offset))).some(item => !item || item.free === 0);
      if (length <= MAX_AD_DAYS && !blocked) {
        onPick(anchor, length);
        setAnchor(null);
        return;
      }
    }
    if (date > lastStart) return;
    onPick(date, 1);
    setAnchor(date);
  };

  const shown = Math.min(monthIndex, months.length - 1);
  const [monthKey, monthDays] = months[shown];
  const monthName = new Date(`${monthKey}-15T12:00:00Z`).toLocaleDateString(isArabic ? "ar-KW-u-nu-latn" : "en-GB", { month: "long", year: "numeric", timeZone: "Asia/Kuwait" });
  /* Sunday first: the Kuwaiti week. Blank cells before the month's first day. */
  const leading = new Date(`${monthDays[0].date}T12:00:00Z`).getUTCDay();
  /* Arabic's short names are whole words ("الخميس") that wrap in a seventh of
     a phone; its calendars head a column with the day's letter. */
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Date(Date.UTC(2026, 0, 4 + index, 12)).toLocaleDateString(isArabic ? "ar-KW" : "en-GB", { weekday: isArabic ? "narrow" : "short", timeZone: "UTC" }));

  return (
    <section aria-labelledby="ads-calendar" className="rounded-2xl border border-[#e3e8f0] bg-white shadow-[0_1px_2px_rgba(10,40,90,0.05)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="ads-calendar" className="text-[14px] font-bold text-[#0a285a]">{t("ads.calendarTitle")}</h3>
        <p className="text-[13px] ink-muted">{t("ads.rateLine", { rate: money({ amount: data.dailyRate, currencyCode: "KWD" }), places: data.capacity })}</p>
      </div>
      <p className="mt-1 text-[13px] ink-muted">{t(anchor ? "ads.calendarPickEnd" : "ads.calendarHint")}</p>

      <div className="mt-3 flex items-center justify-between">
        <button type="button" onClick={() => setMonthIndex(Math.max(0, shown - 1))} disabled={shown === 0} aria-label={t("ads.calendarPrevMonth")} className={`${smallButtonClass.secondary} disabled:opacity-40`}>
          <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden />
        </button>
        <p className="text-[14px] font-bold text-[#0a285a]" aria-live="polite">{monthName}</p>
        <button type="button" onClick={() => setMonthIndex(Math.min(months.length - 1, shown + 1))} disabled={shown >= months.length - 1} aria-label={t("ads.calendarNextMonth")} className={`${smallButtonClass.secondary} disabled:opacity-40`}>
          <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1 text-center" role="group" aria-label={monthName}>
        {weekdays.map(name => <span key={name} aria-hidden className="py-1 text-[11px] font-semibold ink-muted">{name}</span>)}
        {Array.from({ length: leading }, (_, index) => <span key={`blank-${index}`} aria-hidden />)}
        {monthDays.map(entry => {
          const full = entry.free === 0;
          const chosen = inRun(entry.date);
          const startable = entry.date <= lastStart || (anchor !== null && entry.date >= anchor);
          return (
            <button
              key={entry.date}
              type="button"
              onClick={() => press(entry.date)}
              disabled={full || !startable}
              aria-pressed={chosen}
              aria-label={full ? t("ads.calendarDayFull", { day: day(entry.date) }) : t("ads.calendarDayLabel", { day: day(entry.date), count: entry.free, capacity: data.capacity })}
              className={`flex min-h-12 flex-col items-center justify-center rounded-lg border text-[13px] leading-tight ${
                chosen ? "border-[#0a285a] bg-[#0a285a] text-white"
                  : full ? "cursor-not-allowed border-[#eef1f5] bg-[#f4f6f9] text-[#8a97ab] line-through"
                  : !startable ? "cursor-not-allowed border-[#eef1f5] bg-white text-[#8a97ab]"
                  : "border-[#dfe5ee] bg-white text-[#0a285a] hover:bg-[#f0f2f5]"
              }`}
            >
              <span className="font-bold tabular-nums">{Number(entry.date.slice(8))}</span>
              <span className={`text-[11px] ${chosen ? "text-white/85" : "ink-muted"}`}>{full ? t("ads.calendarFull") : t("ads.calendarFree", { count: entry.free })}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
