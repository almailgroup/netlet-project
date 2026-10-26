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
 *
 * A home banner is booked here too, with its picture and headline, and waits
 * for NetLet: an administrator sees the waiting ones first, and approves or
 * turns each down with a reason. Days it waited are never charged.
 */
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { buttonClass, Card, EmptyState, Field, fieldClass, isolate, Notice, PageHeader, Pill, SectionHeading, SkeletonRows, smallButtonClass, textareaClass } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import {
  AD_CAPACITY,
  AD_RATES,
  AD_SLOTS,
  BANNER_HEADLINE_MAX,
  BANNER_NOTE_MAX,
  MAX_AD_DAYS,
  MAX_AD_LEAD_DAYS,
  addDays,
  approvalStart,
  daysInclusive,
  headlineProblem,
  kuwaitToday,
  type AdSlot,
  type BookingState,
  type CalendarDay,
} from "@shared/commerce/adBookings";
import { contactFindings } from "@shared/commerce/contactFilter";
import { prepareBanner } from "@/lib/prepareBanner";
import { DEMO_MODE } from "@/lib/demoMode";
import { can } from "@shared/inventory/permissions";
import { ChevronLeft, ChevronRight, ImagePlus, LoaderCircle } from "lucide-react";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import type { Actor } from "@shared/inventory/permissions";
import { privatePageMeta } from "@shared/seo";
import type { AppRouter } from "../../../../../Backend/src/routes";
import type { inferRouterOutputs } from "@trpc/server";
import { Select } from "@/components/ui/Select";

type Booking = inferRouterOutputs<AppRouter>["ads"]["list"]["rows"][number];

const STATE_LABEL: Record<BookingState, MessageKey> = {
  upcoming: "ads.stateUpcoming",
  running: "ads.stateRunning",
  ended: "ads.stateEnded",
  cancelled: "ads.stateCancelled",
  inReview: "ads.stateInReview",
  rejected: "ads.stateRejected",
};

const SLOT_LABEL: Record<AdSlot, MessageKey> = { home: "ads.slotHome", department: "ads.slotDepartment", home_banner: "ads.slotBanner" };

const PERMIT_LABEL = { valid: "ads.permitValid", missing: "ads.permitMissing", expired: "ads.permitExpired" } as const satisfies Record<string, MessageKey>;

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
      <ul className="mb-6 grid max-w-4xl gap-3 sm:grid-cols-3">
        {AD_SLOTS.map(slot => (
          <li key={slot} className="rounded-2xl border border-[#e1e7ef] bg-white p-4">
            <p className="text-[14px] font-bold text-[#0a285a]">{t(SLOT_LABEL[slot], { department: t("ads.yourDepartment") })}</p>
            <p className="mt-1 text-[13px] text-[#536b8c]">{t("ads.rateLine", { rate: money({ amount: AD_RATES[slot], currencyCode: "KWD" }), places: AD_CAPACITY[slot] })}</p>
            {slot === "home_banner" ? <p className="mt-1 text-[13px] text-[#536b8c]">{t("ads.bannerRateNote")}</p> : null}
          </li>
        ))}
      </ul>

      {actor.kind === "vendor" ? <BookForm /> : null}
      {can(actor, "product.review") ? <BannerQueue /> : null}

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
  const [banner, setBanner] = useState<BannerDraft>({ mediaId: null, preview: null, headline: "", headlineAr: "" });
  const isBanner = slot === "home_banner";
  const bannerProblem = isBanner
    ? (banner.mediaId ? null : "ads.bannerNeedsImage")
      ?? headlineProblem(banner.headline, true, contactFindings)
      ?? headlineProblem(banner.headlineAr, false, contactFindings)
    : null;

  /* Searched on the server, for the reason every portal list is: a filter over
     the first page fetched reports "no matches" for a product on the second. */
  const products = trpc.inventory.products.list.useQuery({ status: "published", query: search.trim() || undefined, pageSize: 50 });
  const request = useMemo(() => (productId ? { productId, slot, startsOn, days } : null), [productId, slot, startsOn, days]);
  const validDays = Number.isInteger(days) && days >= 1 && days <= MAX_AD_DAYS;
  const quote = trpc.ads.quote.useQuery(request!, { enabled: Boolean(request) && validDays && /^\d{4}-\d{2}-\d{2}$/.test(startsOn) });

  const book = trpc.ads.book.useMutation({
    onSuccess: reply => {
      setConfirming(false);
      toast.success(t(isBanner ? "ads.bannerBooked" : "ads.booked", { total: money({ amount: reply.total, currencyCode: "KWD" }) }));
      if (isBanner) setBanner({ mediaId: null, preview: null, headline: "", headlineAr: "" });
      void utils.ads.list.invalidate();
      void utils.ads.quote.invalidate();
    },
    onError: error => { setConfirming(false); toast.error(tError(error.message)); },
  });

  const answer = quote.data;
  const ready = Boolean(request && answer && answer.problem === null) && bannerProblem === null;
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
              {AD_SLOTS.map(option => (
                <label key={option} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-[14px] font-semibold text-[#0a285a] ${slot === option ? "border-[#0a285a] bg-[#f4f7fb]" : "border-[#cfd9e6] bg-white hover:bg-[#f0f2f5]"}`}>
                  <input type="radio" name="ads-slot" value={option} checked={slot === option} onChange={() => setSlot(option)} className="accent-[#0a285a]" />
                  {t(SLOT_LABEL[option], { department: t("ads.yourDepartment") })}
                </label>
              ))}
            </div>
          </fieldset>
          {isBanner ? <BannerFields draft={banner} onChange={setBanner} /> : null}
          <Field label={t("ads.startsOn")}>
            <input type="date" value={startsOn} min={today} max={addDays(today, MAX_AD_LEAD_DAYS)} onChange={event => setStartsOn(event.target.value)} required className={fieldClass} />
          </Field>
          <Field label={t("ads.days", { max: MAX_AD_DAYS })} error={validDays ? undefined : t("ads.badLength")}>
            <input type="number" inputMode="numeric" min={1} max={MAX_AD_DAYS} value={Number.isFinite(days) ? days : ""} onChange={event => setDays(Math.trunc(Number(event.target.value)))} required className={fieldClass} />
          </Field>

          <div className="sm:col-span-2">
            {productId ? (
              <PlacementCalendar
                productId={productId}
                slot={slot}
                startsOn={startsOn}
                days={validDays ? days : 0}
                onPick={(from, length) => { setStartsOn(from); setDays(length); }}
              />
            ) : (
              <p className="text-[13px] ink-muted">{t("ads.calendarPickProduct")}</p>
            )}
          </div>

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
                ) : isBanner && bannerProblem ? (
                  <p className="mt-1 font-semibold">{t(bannerProblem)}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={confirming}
        title={t("ads.confirmTitle", { total: answer ? amount(answer.cost) : "" })}
        body={t(isBanner ? "ads.confirmBannerBody" : "ads.confirmBody")}
        confirmLabel={t("ads.book")}
        pending={book.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => request && book.mutate(isBanner && banner.mediaId
          ? { ...request, banner: { mediaId: banner.mediaId, headline: banner.headline, headlineAr: banner.headlineAr || null } }
          : request)}
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
        <Pill tone={booking.state === "running" ? "good" : booking.state === "upcoming" ? "navy" : booking.state === "inReview" ? "warning" : booking.state === "rejected" ? "danger" : "neutral"}>{t(STATE_LABEL[booking.state])}</Pill>
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
      {booking.banner ? <BannerSummary banner={booking.banner} /> : null}
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
        body={t(booking.state === "upcoming" || booking.state === "inReview" ? "ads.cancelFree" : "ads.cancelToday")}
        confirmLabel={t(showStore ? "ads.takeDown" : "ads.cancel")}
        pending={cancel.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => cancel.mutate({ id: booking.id })}
      />
    </li>
  );
}

type BannerDraft = { mediaId: string | null; preview: string | null; headline: string; headlineAr: string };

/**
 * A banner's picture and words. The picture is cropped to 3:1 in the browser
 * and stored the moment it is chosen, so what is previewed is exactly what
 * the home page would draw; the headlines are checked as they are typed by
 * the rule the server refuses on.
 */
function BannerFields({ draft, onChange }: { draft: BannerDraft; onChange: (draft: BannerDraft) => void }) {
  const { t, tError } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const english = headlineProblem(draft.headline, false, contactFindings);
  const arabic = headlineProblem(draft.headlineAr, false, contactFindings);

  const chosen = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const prepared = await prepareBanner(file);
      if (typeof prepared === "string") throw new Error(prepared);
      const response = await fetch("/api/media", { method: "POST", headers: { "Content-Type": prepared.type }, body: prepared.blob, credentials: "same-origin" });
      const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      const id = body.url?.match(/^\/media\/([A-Za-z0-9_-]+)\./)?.[1];
      if (!response.ok || !body.url || !id) throw new Error(body.error ?? "media.failed");
      onChange({ ...draft, mediaId: id, preview: body.url });
    } catch (error) {
      toast.error(tError(error instanceof Error ? error.message : "media.failed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="space-y-4 sm:col-span-2">
      <Notice tone="info">{t("ads.bannerReviewNote")}</Notice>
      <div>
        <p className="text-[13px] font-semibold text-[#0a285a]">{t("ads.bannerPicture")}</p>
        <p id="banner-picture-hint" className="mt-0.5 text-[12px] ink-muted">{t("ads.bannerPictureHint")}</p>
        {draft.preview ? (
          <img src={draft.preview} alt={t("ads.bannerPreview")} loading="lazy" decoding="async" className="mt-2 aspect-[3/1] w-full rounded-xl border border-[#e1e7ef] object-cover" />
        ) : null}
        {DEMO_MODE ? null : (
          <>
            <input ref={input} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={event => void chosen(event.target.files?.[0])} />
            <button type="button" onClick={() => input.current?.click()} disabled={busy} aria-describedby="banner-picture-hint" className={`${smallButtonClass.secondary} mt-2`}>
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
              {t(draft.preview ? "ads.bannerReplace" : "ads.bannerChoose")}
            </button>
          </>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("ads.bannerHeadline")} hint={t("ads.bannerHeadlineHint", { max: BANNER_HEADLINE_MAX })} error={english ? t(english) : undefined}>
          <input dir="auto" value={draft.headline} maxLength={BANNER_HEADLINE_MAX} onChange={event => onChange({ ...draft, headline: event.target.value })} required className={fieldClass} />
        </Field>
        <Field label={t("ads.bannerHeadlineAr")} optional hint={t("ads.bannerHeadlineArHint")} error={arabic ? t(arabic) : undefined}>
          <input dir="rtl" lang="ar" value={draft.headlineAr} maxLength={BANNER_HEADLINE_MAX} onChange={event => onChange({ ...draft, headlineAr: event.target.value })} className={fieldClass} />
        </Field>
      </div>
    </div>
  );
}

/** A banner booking's picture, words and NetLet's answer, as the store and NetLet read it. */
function BannerSummary({ banner }: { banner: NonNullable<Booking["banner"]> }) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 space-y-2">
      {banner.imageUrl ? (
        <img src={banner.imageUrl} alt="" loading="lazy" decoding="async" className="aspect-[3/1] w-full max-w-xl rounded-xl border border-[#e1e7ef] object-cover" />
      ) : null}
      <p className="font-semibold"><bdi dir="auto">{banner.headline}</bdi></p>
      {banner.headlineAr ? <p className="font-semibold" lang="ar" dir="rtl">{banner.headlineAr}</p> : null}
      {banner.note ? <p className="ink-muted">{t("ads.bannerNoteLine", { note: banner.note })}</p> : null}
    </div>
  );
}

/**
 * Banners waiting on NetLet, first booked first, for whoever reviews them.
 * The store's discount permit is said beside each, because a headline
 * promising a saving needs one, and only a person can read whether it does.
 */
function BannerQueue() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const waiting = trpc.ads.list.useQuery({ page, waiting: true }, { placeholderData: previous => previous });
  const rows = waiting.data?.rows ?? [];
  if (!waiting.isLoading && rows.length === 0 && page === 1) return null;
  return (
    <section className="mt-8" aria-labelledby="ads-banners-waiting">
      <SectionHeading><span id="ads-banners-waiting">{t("ads.bannersWaiting")}</span></SectionHeading>
      {waiting.isLoading ? (
        <SkeletonRows rows={2} label={t("admin.loading")} />
      ) : (
        <QueryGate queries={[waiting]}>
          {() => (
            <>
              <ul className="space-y-3">{rows.map(row => <BannerReview key={row.id} booking={row} />)}</ul>
              {waiting.data ? <Pager page={waiting.data} onPage={setPage} /> : null}
            </>
          )}
        </QueryGate>
      )}
    </section>
  );
}

function BannerReview({ booking }: { booking: Booking }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const run = useRun();
  const utils = trpc.useUtils();
  const today = kuwaitToday(new Date());
  const [asking, setAsking] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const review = trpc.ads.reviewBanner.useMutation({
    onSuccess: reply => {
      setAsking(null);
      setNote("");
      toast.success(t(reply.status === "approved" ? "ads.bannerApproved" : "ads.bannerRejected"));
      void utils.ads.list.invalidate();
      void utils.ads.bannersWaiting.invalidate();
    },
    onError: error => { setAsking(null); toast.error(tError(error.message)); },
  });
  const banner = booking.banner!;
  const starts = approvalStart(booking.startsOn, today);
  return (
    <li className="rounded-2xl border border-[#e1e7ef] bg-white p-4 text-[13px] text-[#0a285a] sm:p-5">
      <p className="text-[15px] font-bold">
        {booking.productHandle
          ? <a href={`/products/${booking.productHandle}`} className="hover:underline"><bdi>{booking.productTitle}</bdi></a>
          : <bdi>{booking.productTitle}</bdi>}
        <span className="text-[13px] font-semibold ink-muted"> · <bdi>{booking.vendorName}</bdi></span>
      </p>
      <p className="mt-1 text-[#3d5376]">{run(booking.startsOn, booking.endsOn)} · {money({ amount: booking.dailyRate, currencyCode: "KWD" })}</p>
      <BannerSummary banner={banner} />
      <p className={`mt-2 ${banner.permit === "valid" ? "ink-muted" : "font-semibold text-[#8c2f22]"}`}>{t(PERMIT_LABEL[banner.permit])}</p>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-[#eef1f5] pt-3">
        <button type="button" onClick={() => setAsking("approve")} className={smallButtonClass.primary}>{t("ads.bannerApprove")}</button>
        <button type="button" onClick={() => setAsking("reject")} className={smallButtonClass.quietDanger}>{t("ads.bannerReject")}</button>
      </div>
      <ConfirmDialog
        open={asking === "approve"}
        title={t("ads.bannerApproveTitle")}
        body={t(starts === booking.startsOn ? "ads.bannerApproveBody" : "ads.bannerApproveLate", { run: run(starts, booking.endsOn) })}
        confirmLabel={t("ads.bannerApprove")}
        pending={review.isPending}
        onClose={() => setAsking(null)}
        onConfirm={() => review.mutate({ id: booking.id, decision: "approve" })}
      />
      <ConfirmDialog
        open={asking === "reject"}
        tone="danger"
        title={t("ads.bannerRejectTitle")}
        body={t("ads.bannerRejectBody")}
        confirmLabel={t("ads.bannerReject")}
        confirmDisabled={!note.trim()}
        pending={review.isPending}
        onClose={() => setAsking(null)}
        onConfirm={() => review.mutate({ id: booking.id, decision: "reject", note })}
      >
        <Field label={t("ads.bannerRejectReason")} className="mt-3">
          <textarea dir="auto" value={note} maxLength={BANNER_NOTE_MAX} onChange={event => setNote(event.target.value)} rows={3} className={textareaClass} />
        </Field>
      </ConfirmDialog>
    </li>
  );
}

/**
 * The calendar a store books from (3.3.15): each day with how many places are
 * still free, a month at a time, Sunday first — the Kuwaiti week. The first
 * press picks the first day and the second the last; a run never takes a
 * full day, because the booking would refuse it. The date and length fields
 * above stay for a keyboard and are the same two values.
 */
function PlacementCalendar({ productId, slot, startsOn, days, onPick }: {
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
    <section aria-labelledby="ads-calendar" className="rounded-2xl border border-[#e1e7ef] bg-white p-4">
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
