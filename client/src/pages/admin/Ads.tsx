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
import { buttonClass, Card, EmptyState, Field, fieldClass, isolate, Notice, PageHeader, Pill, SectionHeading, SkeletonRows, smallButtonClass } from "@/components/admin/ui";
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
import { Select } from "@/components/ui/Select";

type Booking = inferRouterOutputs<AppRouter>["ads"]["list"]["rows"][number];

const STATE_LABEL: Record<BookingState, MessageKey> = {
  upcoming: "ads.stateUpcoming",
  running: "ads.stateRunning",
  ended: "ads.stateEnded",
  cancelled: "ads.stateCancelled",
};

const SLOT_LABEL: Record<AdSlot, MessageKey> = { home: "ads.slotHome", department: "ads.slotDepartment" };

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
      <PageHeader title={t("admin.ads")} description={t(actor.kind === "admin" ? "ads.noteAdmin" : "ads.noteStore")} />
      <ul className="mb-6 grid max-w-3xl gap-3 sm:grid-cols-2">
        {(["home", "department"] as const).map(slot => (
          <li key={slot} className="rounded-2xl border border-[#e1e7ef] bg-white p-4">
            <p className="text-[14px] font-bold text-[#0a285a]">{t(SLOT_LABEL[slot], { department: t("ads.yourDepartment") })}</p>
            <p className="mt-1 text-[13px] text-[#536b8c]">{t("ads.rateLine", { rate: money({ amount: AD_RATES[slot], currencyCode: "KWD" }), places: AD_CAPACITY[slot] })}</p>
          </li>
        ))}
      </ul>

      {actor.kind === "vendor" ? <BookForm /> : null}

      <section className="mt-8" aria-labelledby="ads-bookings">
        <SectionHeading><span id="ads-bookings">{t("ads.bookings")}</span></SectionHeading>
        {list.isLoading ? (
          <SkeletonRows rows={3} label={t("admin.loading")} />
        ) : (
          <QueryGate queries={[list]}>
            {() => {
              const result = list.data;
              const rows = result?.rows ?? [];
              if (rows.length === 0) return <EmptyState title={t("ads.none")} />;
              return (
                <>
                  <ul className="space-y-3">{rows.map(row => <BookingRow key={row.id} booking={row} showStore={actor.kind === "admin"} />)}</ul>
                  {result ? <Pager page={result} onPage={setPage} /> : null}
                </>
              );
            }}
          </QueryGate>
        )}
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
    <form className="max-w-3xl" onSubmit={event => { event.preventDefault(); if (ready) setConfirming(true); }}>
      <Card
        title={t("ads.bookTitle")}
        footer={<button type="submit" disabled={!ready || book.isPending} className={buttonClass.primary}>{t("ads.book")}</button>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("ads.findProduct")} className="sm:col-span-2">
            <input type="search" dir="auto" value={search} onChange={event => setSearch(event.target.value)} maxLength={160} className={fieldClass} />
          </Field>
          <Field label={t("ads.product")} className="sm:col-span-2">
            <Select value={productId ?? ""} onChange={event => setProductId(event.target.value ? Number(event.target.value) : null)} className={fieldClass}>
              <option value="">—</option>
              {(products.data?.rows ?? []).map(product => <option key={product.id} value={product.id}>{product.title}</option>)}
            </Select>
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="text-[13px] font-semibold text-[#0a285a]">{t("ads.place")}</legend>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {(["home", "department"] as const).map(option => (
                <label key={option} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-[14px] font-semibold text-[#0a285a] ${slot === option ? "border-[#0a285a] bg-[#f4f7fb]" : "border-[#cfd9e6] bg-white hover:bg-[#f0f2f5]"}`}>
                  <input type="radio" name="ads-slot" value={option} checked={slot === option} onChange={() => setSlot(option)} className="accent-[#0a285a]" />
                  {t(SLOT_LABEL[option], { department: t("ads.yourDepartment") })}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label={t("ads.startsOn")}>
            <input type="date" value={startsOn} min={today} max={addDays(today, MAX_AD_LEAD_DAYS)} onChange={event => setStartsOn(event.target.value)} required className={fieldClass} />
          </Field>
          <Field label={t("ads.days", { max: MAX_AD_DAYS })} error={validDays ? undefined : t("ads.badLength")}>
            <input type="number" inputMode="numeric" min={1} max={MAX_AD_DAYS} value={Number.isFinite(days) ? days : ""} onChange={event => setDays(Math.trunc(Number(event.target.value)))} required className={fieldClass} />
          </Field>

          <div className="sm:col-span-2" aria-live="polite">
            {request && validDays && answer ? (
              <div className="rounded-xl border border-[#e1e7ef] bg-[#fafbfd] px-4 py-3 text-[13px] leading-6 text-[#0a285a]">
                <p className="text-[15px] font-bold">
                  {days === 1
                    ? t("ads.quoteLineOne", { total: amount(answer.cost) })
                    : t("ads.quoteLine", { total: amount(answer.cost), rate: amount(answer.dailyRate), days })}
                </p>
                <p>{run(startsOn, addDays(startsOn, days - 1))}</p>
                <p className="ink-muted">{t("ads.roomLine", { room: amount(answer.room) })}</p>
                {answer.problem ? (
                  <Notice tone="danger" className="mt-2">
                    {isMessageKey(answer.problem) ? t(answer.problem) : answer.problem}
                    {answer.fullDays.length ? <> {answer.fullDays.map(day).join(" · ")}</> : null}
                  </Notice>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={confirming}
        title={t("ads.confirmTitle", { total: answer ? amount(answer.cost) : "" })}
        body={t("ads.confirmBody")}
        confirmLabel={t("ads.book")}
        pending={book.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => request && book.mutate(request)}
      />
    </form>
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
    <li className="rounded-2xl border border-[#e1e7ef] bg-white p-4 text-[13px] text-[#0a285a] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 text-[15px] font-bold">
          {booking.productHandle
            ? <a href={`/products/${booking.productHandle}`} className="hover:underline"><bdi>{booking.productTitle}</bdi></a>
            : <bdi>{booking.productTitle}</bdi>}
          {showStore ? <span className="text-[13px] font-semibold ink-muted"> · <bdi>{booking.vendorName}</bdi></span> : null}
        </p>
        <Pill tone={booking.state === "running" ? "good" : booking.state === "upcoming" ? "navy" : "neutral"}>{t(STATE_LABEL[booking.state])}</Pill>
      </div>
      <p className="mt-1 text-[#3d5376]">
        {t(SLOT_LABEL[booking.slot], { department: (isArabic ? booking.departmentNameAr : null) ?? booking.departmentName ?? t("ads.yourDepartment") })}
        {" · "}
        {/* A run cancelled before it started has no days; it reads as booked. */}
        {run(booking.startsOn, booking.cancelledOn && booking.cancelledOn < booking.endsOn && booking.cancelledOn >= booking.startsOn ? booking.cancelledOn : booking.endsOn)}
      </p>
      <p className="mt-1 ink-muted">
        {t("ads.costLine", { accrued: amount(booking.accrued), total: amount(booking.total), deducted: amount(booking.deducted) })}
      </p>
      {booking.cancellable ? (
        <div className="mt-3 border-t border-[#eef1f5] pt-3">
          <button type="button" onClick={() => setConfirming(true)} className={smallButtonClass.quietDanger}>
            {t(showStore ? "ads.takeDown" : "ads.cancel")}
          </button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirming}
        tone="danger"
        title={t(showStore ? "ads.takeDownTitle" : "ads.cancelTitle", { product: isolate(booking.productTitle) })}
        body={t(booking.state === "upcoming" ? "ads.cancelFree" : "ads.cancelToday")}
        confirmLabel={t(showStore ? "ads.takeDown" : "ads.cancel")}
        pending={cancel.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => cancel.mutate({ id: booking.id })}
      />
    </li>
  );
}
