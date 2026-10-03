/**
 * Paid placements (3.3.15): a store books a place on the shelf by the day.
 *
 * One page for a store's owner and for NetLet, scoped by the server. An owner
 * books, sees what each booking has cost so far and what their payouts have
 * already taken for it, and can stop one; an administrator sees every store's
 * bookings and can take any down. Nobody else reaches it: spending the store's
 * money is the owner's, the way the payout account is.
 *
 * The form asks the server before it offers the button — the same checks the
 * booking makes, so a full day, a product that is not on the shelf or a
 * booking bigger than what the store has earned is named before anybody
 * presses anything, not after.
 *
 * Booking and stopping both ask first: one commits money, the other ends a
 * placement somebody paid for.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { AD_CAPACITY, AD_RATES, MAX_AD_DAYS, MAX_AD_LEAD_DAYS, addDays, kuwaitToday, type AdSlot, type BookingState } from "@shared/commerce/adBookings";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import type { Actor } from "@shared/inventory/permissions";
import { privatePageMeta } from "@shared/seo";
import type { AppRouter } from "../../../../server/routers";
import type { inferRouterOutputs } from "@trpc/server";

type Booking = inferRouterOutputs<AppRouter>["ads"]["list"]["rows"][number];

const STATE_LABEL: Record<BookingState, MessageKey> = {
  upcoming: "ads.stateUpcoming",
  running: "ads.stateRunning",
  ended: "ads.stateEnded",
  cancelled: "ads.stateCancelled",
};

const SLOT_LABEL: Record<AdSlot, MessageKey> = { home: "ads.slotHome", department: "ads.slotDepartment" };

const field = "glass-field mt-1 h-10 w-full rounded-full px-4 text-sm";

export default function AdminAds() {
  usePageMeta(privatePageMeta("Placements"));
  return <AdminShell need="ads.book">{actor => <Ads actor={actor} />}</AdminShell>;
}

/** A Kuwaiti calendar day, spelled out in the reader's language. */
function useDay() {
  const format = useDateFormat();
  /* Noon UTC, so no reader's own timezone can tip the day either way. */
  return (day: string) => format(`${day}T12:00:00Z`);
}

/** "4 to 6 October", or just the day when a run is one day long. */
function useRun() {
  const { t } = useTranslation();
  const day = useDay();
  return (from: string, to: string) => (from === to ? day(from) : t("ads.runsLine", { from: day(from), to: day(to) }));
}

function Ads({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const money = useMoney();
  const [page, setPage] = useState(1);
  const list = trpc.ads.list.useQuery({ page }, { placeholderData: previous => previous });

  return (
    <>
      <h1 className="text-xl font-extrabold">{t("admin.ads")}</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#536b8c]">
        {t(actor.kind === "admin" ? "ads.noteAdmin" : "ads.noteStore")}
      </p>
      <ul className="mt-3 grid max-w-2xl gap-2 text-[12px] text-[#0a285a] sm:grid-cols-2">
        {(["home", "department"] as const).map(slot => (
          <li key={slot} className="rounded-xl border border-[#e6e9ef] bg-white px-3 py-2">
            <span className="font-extrabold">{t(SLOT_LABEL[slot], { department: t("ads.yourDepartment") })}</span>
            <br />
            {t("ads.rateLine", { rate: money({ amount: AD_RATES[slot], currencyCode: "KWD" }), places: AD_CAPACITY[slot] })}
          </li>
        ))}
      </ul>

      {actor.kind === "vendor" ? <BookForm /> : null}

      <section className="mt-8" aria-labelledby="ads-bookings">
        <h2 id="ads-bookings" className="text-sm font-extrabold">{t("ads.bookings")}</h2>
        <QueryGate queries={[list]}>
          {() => {
            const result = list.data;
            const rows = result?.rows ?? [];
            if (rows.length === 0) return <p className="mt-3 rounded-xl border border-[#d5dfeb] bg-white/60 px-4 py-5 text-[13px] text-[#536b8c]">{t("ads.none")}</p>;
            return (
              <div className="mt-3 space-y-2">
                <ul className="space-y-2">{rows.map(row => <BookingRow key={row.id} booking={row} showStore={actor.kind === "admin"} />)}</ul>
                {result ? <Pager page={result} onPage={setPage} /> : null}
              </div>
            );
          }}
        </QueryGate>
      </section>
    </>
  );
}

function BookForm() {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const day = useDay();
  const run = useRun();
  const utils = trpc.useUtils();
  const today = kuwaitToday(new Date());

  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState<number | null>(null);
  const [slot, setSlot] = useState<AdSlot>("home");
  const [startsOn, setStartsOn] = useState(addDays(today, 1));
  const [days, setDays] = useState(7);
  const [confirming, setConfirming] = useState(false);

  /* Searched on the server, for the reason every portal list is: a filter over
     the first page fetched reports "no matches" for a product on the second. */
  const products = trpc.inventory.products.list.useQuery({ status: "published", query: search.trim() || undefined, pageSize: 50 });
  const request = useMemo(() => (productId ? { productId, slot, startsOn, days } : null), [productId, slot, startsOn, days]);
  const validDays = Number.isInteger(days) && days >= 1 && days <= MAX_AD_DAYS;
  const quote = trpc.ads.quote.useQuery(request!, { enabled: Boolean(request) && validDays && /^\d{4}-\d{2}-\d{2}$/.test(startsOn) });

  const book = trpc.ads.book.useMutation({
    onSuccess: reply => {
      setConfirming(false);
      toast.success(t("ads.booked", { total: money({ amount: reply.total, currencyCode: "KWD" }) }));
      void utils.ads.list.invalidate();
      void utils.ads.quote.invalidate();
    },
    onError: error => { setConfirming(false); toast.error(tError(error.message)); },
  });

  const answer = quote.data;
  const ready = Boolean(request && answer && answer.problem === null);
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });

  return (
    <section className="mt-6 max-w-2xl rounded-2xl border border-[#e6e9ef] bg-white p-5" aria-labelledby="ads-book">
      <h2 id="ads-book" className="text-sm font-extrabold">{t("ads.bookTitle")}</h2>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); if (ready) setConfirming(true); }}>
        <label className="block sm:col-span-2">
          <span className="block text-[11px] font-extrabold text-[#536b8c]">{t("ads.findProduct")}</span>
          <input value={search} onChange={event => setSearch(event.target.value)} maxLength={160} className={field} />
        </label>
        <label className="block sm:col-span-2">
          <span className="block text-[11px] font-extrabold text-[#536b8c]">{t("ads.product")}</span>
          {/* Named explicitly: a <label> around a <select> pulls every option
              into the accessible name otherwise. */}
          <select aria-label={t("ads.product")} value={productId ?? ""} onChange={event => setProductId(event.target.value ? Number(event.target.value) : null)} className={field}>
            <option value="">—</option>
            {(products.data?.rows ?? []).map(product => <option key={product.id} value={product.id}>{product.title}</option>)}
          </select>
        </label>
        <fieldset className="sm:col-span-2">
          <legend className="text-[11px] font-extrabold text-[#536b8c]">{t("ads.place")}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {(["home", "department"] as const).map(option => (
              <label key={option} className={`pressable flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-bold ${slot === option ? "border-[#0a285a] bg-[#eaf1fb]" : "border-[#d5dfeb] bg-white"}`}>
                <input type="radio" name="ads-slot" value={option} checked={slot === option} onChange={() => setSlot(option)} className="accent-[#0a285a]" />
                {t(SLOT_LABEL[option], { department: t("ads.yourDepartment") })}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="block text-[11px] font-extrabold text-[#536b8c]">{t("ads.startsOn")}</span>
          <input type="date" value={startsOn} min={today} max={addDays(today, MAX_AD_LEAD_DAYS)} onChange={event => setStartsOn(event.target.value)} required className={field} />
        </label>
        <label className="block">
          <span className="block text-[11px] font-extrabold text-[#536b8c]">{t("ads.days", { max: MAX_AD_DAYS })}</span>
          <input type="number" inputMode="numeric" min={1} max={MAX_AD_DAYS} value={Number.isFinite(days) ? days : ""} onChange={event => setDays(Math.trunc(Number(event.target.value)))} required className={field} />
        </label>

        <div className="sm:col-span-2" aria-live="polite">
          {request && validDays && answer ? (
            <div className="rounded-xl bg-[#f6f8fb] px-4 py-3 text-[12px] leading-6 text-[#0a285a]">
              <p className="text-sm font-extrabold">
                {days === 1
                  ? t("ads.quoteLineOne", { total: amount(answer.cost) })
                  : t("ads.quoteLine", { total: amount(answer.cost), rate: amount(answer.dailyRate), days })}
              </p>
              <p>{run(startsOn, addDays(startsOn, days - 1))}</p>
              <p className="ink-muted">{t("ads.roomLine", { room: amount(answer.room) })}</p>
              {answer.problem ? (
                <p className="mt-1 font-bold text-[#8c2f22]">
                  {isMessageKey(answer.problem) ? t(answer.problem) : answer.problem}
                  {answer.fullDays.length ? <> {answer.fullDays.map(day).join(" · ")}</> : null}
                </p>
              ) : null}
            </div>
          ) : !validDays ? (
            <p className="text-[12px] font-bold text-[#8c2f22]">{t("ads.badLength")}</p>
          ) : null}
        </div>

        <div className="sm:col-span-2">
          <button type="submit" disabled={!ready || book.isPending} className="glass-navy type-control pressable rounded-full px-5 py-2 disabled:opacity-50">{t("ads.book")}</button>
        </div>
      </form>

      <ConfirmDialog
        open={confirming}
        title={t("ads.confirmTitle", { total: answer ? amount(answer.cost) : "" })}
        body={t("ads.confirmBody")}
        confirmLabel={t("ads.book")}
        pending={book.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => request && book.mutate(request)}
      />
    </section>
  );
}

function BookingRow({ booking, showStore }: { booking: Booking; showStore: boolean }) {
  const { t, tError, isArabic } = useTranslation();
  const money = useMoney();
  const run = useRun();
  const utils = trpc.useUtils();
  const [confirming, setConfirming] = useState(false);
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });
  const cancel = trpc.ads.cancel.useMutation({
    onSuccess: () => {
      setConfirming(false);
      toast.success(t("ads.cancelled"));
      void utils.ads.list.invalidate();
    },
    onError: error => { setConfirming(false); toast.error(tError(error.message)); },
  });

  return (
    <li className="rounded-2xl border border-[#e6e9ef] bg-white p-4 text-[12px] text-[#0a285a]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[13px] font-extrabold">
          {booking.productHandle
            ? <a href={`/products/${booking.productHandle}`} className="underline underline-offset-2"><bdi>{booking.productTitle}</bdi></a>
            : <bdi>{booking.productTitle}</bdi>}
          {showStore ? <span className="font-bold ink-muted"> · <bdi>{booking.vendorName}</bdi></span> : null}
        </p>
        <span className={`rounded-full px-3 py-1 text-[11px] font-extrabold ${booking.state === "running" ? "bg-[#e6f2e7] text-[#2f5d33]" : "bg-[#e7edf5] text-[#0a285a]"}`}>
          {t(STATE_LABEL[booking.state])}
        </span>
      </div>
      <p className="mt-1">
        {t(SLOT_LABEL[booking.slot], { department: (isArabic ? booking.departmentNameAr : null) ?? booking.departmentName ?? t("ads.yourDepartment") })}
        {" · "}
        {/* A run cancelled before it started has no days; it reads as booked. */}
        {run(booking.startsOn, booking.cancelledOn && booking.cancelledOn < booking.endsOn && booking.cancelledOn >= booking.startsOn ? booking.cancelledOn : booking.endsOn)}
      </p>
      <p className="mt-1 ink-muted">
        {t("ads.costLine", { accrued: amount(booking.accrued), total: amount(booking.total), deducted: amount(booking.deducted) })}
      </p>
      {booking.cancellable ? (
        <button type="button" onClick={() => setConfirming(true)} className="glass pressable type-control mt-3 rounded-full px-4 py-2">
          {t(showStore ? "ads.takeDown" : "ads.cancel")}
        </button>
      ) : null}
      <ConfirmDialog
        open={confirming}
        tone="danger"
        title={t(showStore ? "ads.takeDownTitle" : "ads.cancelTitle", { product: booking.productTitle })}
        body={t(booking.state === "upcoming" ? "ads.cancelFree" : "ads.cancelToday")}
        confirmLabel={t(showStore ? "ads.takeDown" : "ads.cancel")}
        pending={cancel.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => cancel.mutate({ id: booking.id })}
      />
    </li>
  );
}
