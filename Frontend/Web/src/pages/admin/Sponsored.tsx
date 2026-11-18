/**
 * Sponsored products, on the owner's word: a store asks for one of its
 * products to be among the first products on NetLet's home page, NetLet
 * reviews the request and asks for the payment, and the product is shown on
 * its days once it is paid (`Shared/commerce/sponsorRequests.ts`).
 *
 * One page for a store's owner and for NetLet, scoped by the server. The
 * owner asks (with the calendar of free places and a picture of the card as
 * shoppers will see it), pays — from earnings, or by a bank transfer to
 * NetLet's account quoting the request's reference — withdraws, stops, and
 * reads how the run did. NetLet's people answer: approve at a day rate with a
 * last day to pay, or decline with a reason; confirm a transfer arrived, or
 * say it did not; take a run down, with what is owed back said beside it.
 *
 * Every button is the server's answer (`actions` on each row), so the page
 * never offers a press the API would refuse; every press that moves money or
 * a place asks first.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Landmark, Megaphone, Wallet } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { PlacementCalendar, useDay, useRun } from "@/components/admin/PlacementCalendar";
import {
  Card,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Pill,
  Segmented,
  SkeletonRows,
  buttonClass,
  fieldClass,
  isolate,
  smallButtonClass,
  surfaceClass,
  textareaClass,
} from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Select";
import { useProductsByIds } from "@/hooks/useCatalog";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { shopHref } from "@/lib/portalHost";
import { trpc } from "@/lib/trpc";
import { MAX_AD_DAYS, MAX_AD_LEAD_DAYS, addDays, kuwaitToday } from "@shared/commerce/adBookings";
import {
  SPONSOR_NOTE_MAX,
  SPONSOR_REFERENCE_MAX,
  SPONSOR_STEPS,
  payByProblem,
  rateProblem,
  referenceProblem,
  type SponsorState,
  type SponsorStep,
} from "@shared/commerce/sponsorRequests";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import type { Actor } from "@shared/inventory/permissions";
import { privatePageMeta } from "@shared/seo";
import type { AppRouter } from "../../../../../Backend/src/routes";
import type { inferRouterOutputs } from "@trpc/server";

type List = inferRouterOutputs<AppRouter>["sponsor"]["list"];
type Row = List["rows"][number];
type View = "todo" | "open" | "live" | "done" | "all";

const STATE_LABEL: Record<SponsorState, MessageKey> = {
  review: "sponsor.stateReview",
  payment: "sponsor.statePayment",
  sent: "sponsor.stateSent",
  paid: "sponsor.statePaid",
  declined: "sponsor.stateDeclined",
  withdrawn: "sponsor.stateWithdrawn",
  lapsed: "sponsor.stateLapsed",
};

/* What NetLet reads where the state means something else from its side. */
const NETLET_STATE_LABEL: Partial<Record<SponsorState, MessageKey>> = {
  review: "sponsor.stateReviewNetLet",
  payment: "sponsor.statePaymentNetLet",
  sent: "sponsor.stateSentNetLet",
};

const STEP_LABEL: Record<SponsorStep, MessageKey> = {
  requested: "sponsor.stepRequested",
  payment: "sponsor.stepPayment",
  live: "sponsor.stepLive",
  ended: "sponsor.stepEnded",
};

const VIEW_LABEL: Record<View, MessageKey> = {
  todo: "sponsor.viewTodo",
  open: "sponsor.viewOpen",
  live: "sponsor.viewLive",
  done: "sponsor.viewDone",
  all: "sponsor.viewAll",
};

export default function AdminSponsored() {
  usePageMeta(privatePageMeta("Sponsored products"));
  return <AdminShell need="ads.book">{actor => <Sponsored actor={actor} />}</AdminShell>;
}

/** A dinar amount as the page draws money. */
function useKwd() {
  const money = useMoney();
  return (amount: string) => money({ amount, currencyCode: "KWD" });
}

function Sponsored({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const kwd = useKwd();
  const store = actor.kind === "vendor";
  const [view, setView] = useState<View>(store ? "all" : "todo");
  const [page, setPage] = useState(1);
  const list = trpc.sponsor.list.useQuery({ view, page }, { placeholderData: previous => previous });
  const data = list.data;

  return (
    <>
      <PageHeader title={t("admin.sponsored")} description={t(store ? "sponsor.noteStore" : "sponsor.noteNetLet")} />

      {/* The steps, for the store that takes them; NetLet's people know them. */}
      {store ? (
        <ol className="mb-6 grid max-w-4xl grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3" aria-label={t("sponsor.howTitle")}>
          {(["sponsor.how1", "sponsor.how2", "sponsor.how3", "sponsor.how4"] as const).map((key, index) => (
            <li key={key} className={`${surfaceClass} flex gap-2.5 p-3 sm:gap-3 sm:p-4`}>
              <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-[#0a285a] text-[12px] font-bold text-white sm:size-7 sm:text-[13px]">{index + 1}</span>
              <p className="text-[12px] leading-5 text-[#0a285a] sm:text-[13px]">{t(key)}</p>
            </li>
          ))}
        </ol>
      ) : null}

      {data && !data.ready ? <Notice tone="warning" className="mb-6 max-w-4xl">{t("sponsor.unavailable")}</Notice> : null}

      {data?.ready ? (
        <p className="mb-6 max-w-4xl text-[13px] ink-muted">
          {t("sponsor.rateLine", { rate: kwd(data.rateCard), places: data.capacity })}
          {store && data.room !== null ? <> {t("sponsor.roomLine", { room: kwd(data.room) })}</> : null}
        </p>
      ) : null}

      {store && data?.ready ? <RequestForm /> : null}

      <section className="mt-8" aria-labelledby="sponsor-requests">
        <h2 id="sponsor-requests" className="mb-3 text-[17px] font-bold text-[#0a285a]">{t(store ? "sponsor.yourRequests" : "sponsor.requests")}</h2>
        {data?.ready ? (
          <Segmented
            label={t("sponsor.viewLabel")}
            value={view}
            onChange={next => { setView(next); setPage(1); }}
            options={(store ? (["all", "todo", "open", "live", "done"] as const) : (["todo", "open", "live", "done", "all"] as const)).map(value => ({
              value,
              label: t(value === "todo" && store ? "sponsor.viewToPay" : VIEW_LABEL[value]),
              count: data.counts[value],
            }))}
            className="mb-4"
          />
        ) : null}
        {list.isLoading ? (
          <SkeletonRows rows={3} label={t("admin.loading")} />
        ) : (
          <QueryGate queries={[list]}>
            {() => {
              if (!data?.ready) return null;
              if (data.rows.length === 0) {
                return <EmptyState title={t(view === "all" ? (store ? "sponsor.noneStore" : "sponsor.none") : "sponsor.noneHere")} />;
              }
              return (
                <>
                  <ul className="space-y-3">
                    {data.rows.map(row => <RequestRow key={row.id} row={row} side={store ? "store" : "netlet"} list={data} />)}
                  </ul>
                  <Pager page={data} onPage={setPage} />
                </>
              );
            }}
          </QueryGate>
        )}
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ asking --- */

function RequestForm() {
  const { t, tError } = useTranslation();
  const kwd = useKwd();
  const run = useRun();
  const day = useDay();
  const utils = trpc.useUtils();
  const today = kuwaitToday(new Date());

  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState<number | null>(null);
  const [startsOn, setStartsOn] = useState(addDays(today, 2));
  const [days, setDays] = useState(7);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);

  const products = trpc.inventory.products.list.useQuery({ status: "published", query: search.trim() || undefined, pageSize: 50 });
  const validDays = Number.isInteger(days) && days >= 1 && days <= MAX_AD_DAYS;
  const ask = useMemo(() => (productId && validDays && /^\d{4}-\d{2}-\d{2}$/.test(startsOn) ? { productId, startsOn, days } : null), [productId, startsOn, days, validDays]);
  const quote = trpc.sponsor.quote.useQuery(ask!, { enabled: Boolean(ask) });
  const answer = quote.data;
  const ready = Boolean(ask && answer && answer.problem === null);

  const send = trpc.sponsor.request.useMutation({
    onSuccess: () => {
      setConfirming(false);
      setNote("");
      toast.success(t("sponsor.sent"));
      void utils.sponsor.list.invalidate();
      void utils.sponsor.quote.invalidate();
      void utils.ads.calendar.invalidate();
    },
    onError: error => { setConfirming(false); toast.error(tError(error.message)); },
  });

  return (
    <form className="max-w-4xl" onSubmit={event => { event.preventDefault(); if (ready) setConfirming(true); }}>
      <Card
        title={t("sponsor.askTitle")}
        description={t("sponsor.askNote")}
        footer={<button type="submit" disabled={!ready || send.isPending} className={buttonClass.primary}>{t("sponsor.send")}</button>}
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_15rem]">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field label={t("ads.findProduct")} className="sm:col-span-2">
              <input type="search" dir="auto" value={search} onChange={event => setSearch(event.target.value)} maxLength={160} className={fieldClass} />
            </Field>
            <Field label={t("ads.product")} className="sm:col-span-2">
              <Select value={productId ?? ""} onChange={event => setProductId(event.target.value ? Number(event.target.value) : null)} className={fieldClass}>
                <option value="">—</option>
                {(products.data?.rows ?? []).map(product => <option key={product.id} value={product.id}>{product.title}</option>)}
              </Select>
            </Field>
            <Field label={t("ads.startsOn")}>
              <input type="date" value={startsOn} min={today} max={addDays(today, MAX_AD_LEAD_DAYS)} onChange={event => setStartsOn(event.target.value)} required className={fieldClass} />
            </Field>
            <Field label={t("ads.days", { max: MAX_AD_DAYS })} error={validDays ? undefined : t("ads.badLength")}>
              <input type="number" inputMode="numeric" min={1} max={MAX_AD_DAYS} value={Number.isFinite(days) ? days : ""} onChange={event => setDays(Math.trunc(Number(event.target.value)))} required className={fieldClass} />
            </Field>
            <Field label={t("sponsor.noteLabel")} optional hint={t("sponsor.noteHint")} className="sm:col-span-2">
              <textarea dir="auto" value={note} maxLength={SPONSOR_NOTE_MAX} onChange={event => setNote(event.target.value)} rows={2} className={textareaClass} />
            </Field>
          </div>
          <CardPreview productId={productId} />
        </div>

        <div className="mt-5">
          {productId ? (
            <PlacementCalendar productId={productId} slot="home" startsOn={startsOn} days={validDays ? days : 0} onPick={(from, length) => { setStartsOn(from); setDays(length); }} />
          ) : (
            <p className="text-[13px] ink-muted">{t("ads.calendarPickProduct")}</p>
          )}
        </div>

        <div className="mt-4" aria-live="polite">
          {ask && answer ? (
            <div className="rounded-xl border border-[#e1e7ef] bg-[#fafbfd] px-4 py-3 text-[13px] leading-6 text-[#0a285a]">
              <p className="text-[15px] font-bold">
                {days === 1 ? t("ads.quoteLineOne", { total: kwd(answer.cost) }) : t("ads.quoteLine", { total: kwd(answer.cost), rate: kwd(answer.dailyRate), days })}
              </p>
              <p>{run(startsOn, addDays(startsOn, days - 1))}</p>
              <p className="ink-muted">{t("sponsor.quoteNote")}</p>
              {answer.problem ? (
                <Notice tone="danger" className="mt-2">
                  {isMessageKey(answer.problem) ? t(answer.problem) : answer.problem}
                  {answer.fullDays.length ? <> {answer.fullDays.map(day).join(" · ")}</> : null}
                </Notice>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      <ConfirmDialog
        open={confirming}
        title={t("sponsor.confirmTitle")}
        body={t("sponsor.confirmBody", { total: answer ? kwd(answer.cost) : "", run: run(startsOn, addDays(startsOn, days - 1)) })}
        confirmLabel={t("sponsor.send")}
        pending={send.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => ask && send.mutate({ ...ask, note: note.trim() || null })}
      />
    </form>
  );
}

/**
 * The card as shoppers will see it on the home page: the photo, the name, the
 * price, and "Sponsored" with the store's name where the store's name sits.
 */
function CardPreview({ productId }: { productId: number | null }) {
  const { t } = useTranslation();
  const money = useMoney();
  const { products } = useProductsByIds(productId ? [String(productId)] : [], { enabled: productId !== null });
  const product = products[0];
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-[13px] font-semibold text-[#0a285a]">{t("sponsor.previewTitle")}</figcaption>
      <div className={`${surfaceClass} flex overflow-hidden lg:block`}>
        <div className="aspect-square w-24 shrink-0 bg-white lg:w-auto">
          {product?.images[0] ? (
            <img src={product.images[0].url} alt="" loading="lazy" decoding="async" className="size-full object-contain" />
          ) : (
            <div className="grid size-full place-items-center bg-[#f4f6fb]"><Megaphone className="size-8 text-[#9aa8bd]" aria-hidden /></div>
          )}
        </div>
        <div className="min-w-0 space-y-1 p-3">
          <p className="truncate text-[12px] ink-muted">{t("ads.sponsored")}{product?.vendor ? <> · <bdi>{product.vendor}</bdi></> : null}</p>
          <p className="line-clamp-2 text-[14px] font-semibold leading-5 text-[#0a285a]" dir="auto">{product?.title ?? t("sponsor.previewEmpty")}</p>
          {product ? <p className="text-[15px] font-bold text-[#0a285a]">{money(product.priceRange.min)}</p> : null}
        </div>
      </div>
      <p className="mt-2 text-[12px] leading-5 ink-muted">{t("sponsor.previewNote")}</p>
    </figure>
  );
}

/* ------------------------------------------------------------------- a row --- */

function Steps({ row }: { row: Row }) {
  const { t } = useTranslation();
  const at = SPONSOR_STEPS.indexOf(row.step);
  return (
    <ol className="mt-3 grid grid-cols-4 gap-1" aria-label={t("sponsor.stepsLabel")}>
      {SPONSOR_STEPS.map((step, index) => {
        const done = index < at || (index === at && row.step === "ended");
        const current = index === at && row.step !== "ended";
        const stopped = current && row.stopped;
        return (
          <li key={step} aria-current={current ? "step" : undefined} className="min-w-0">
            <span className={`block h-1.5 rounded-full ${stopped ? "bg-[#c9a19a]" : done || current ? "bg-[#0a285a]" : "bg-[#e3e8f0]"}`} />
            <span className={`mt-1 block text-[12px] leading-4 ${current ? "font-semibold text-[#0a285a]" : "ink-muted"}`}>{t(STEP_LABEL[step])}</span>
          </li>
        );
      })}
    </ol>
  );
}

type Asking = "approve" | "decline" | "earnings" | "transfer" | "confirm" | "missing" | "withdraw" | "stop" | null;

function RequestRow({ row, side, list }: { row: Row; side: "store" | "netlet"; list: List }) {
  const { t, tError } = useTranslation();
  const kwd = useKwd();
  const run = useRun();
  const day = useDay();
  const utils = trpc.useUtils();
  const today = kuwaitToday(new Date());
  const [asking, setAsking] = useState<Asking>(null);
  const [rate, setRate] = useState(row.dailyRate);
  const [payBy, setPayBy] = useState(row.suggestedPayBy);
  const [reply, setReply] = useState("");
  const [reference, setReference] = useState("");
  const [startsOn, setStartsOn] = useState(today);
  const [tried, setTried] = useState(false);

  const close = () => { setAsking(null); setTried(false); };
  const refresh = () => {
    void utils.sponsor.list.invalidate();
    void utils.sponsor.waiting.invalidate();
    void utils.ads.calendar.invalidate();
  };
  const done = (key: MessageKey, values?: Record<string, string>) => () => { close(); setReply(""); toast.success(t(key, values)); refresh(); };
  const failed = (error: { message: string }) => { close(); toast.error(tError(error.message)); refresh(); };

  const approve = trpc.sponsor.approve.useMutation({ onSuccess: done("sponsor.approved"), onError: failed });
  const decline = trpc.sponsor.decline.useMutation({
    onSuccess: answer => { close(); setReply(""); toast.success(answer.refund ? t("sponsor.declinedRefund", { refund: kwd(answer.refund) }) : t("sponsor.declined")); refresh(); },
    onError: failed,
  });
  const payEarnings = trpc.sponsor.payFromEarnings.useMutation({ onSuccess: done("sponsor.paidEarnings"), onError: failed });
  const sendTransfer = trpc.sponsor.sendTransfer.useMutation({ onSuccess: done("sponsor.transferSent"), onError: failed });
  const confirm = trpc.sponsor.confirmPayment.useMutation({ onSuccess: done("sponsor.confirmed"), onError: failed });
  const missing = trpc.sponsor.notReceived.useMutation({ onSuccess: done("sponsor.notReceivedDone"), onError: failed });
  const withdraw = trpc.sponsor.withdraw.useMutation({ onSuccess: done("sponsor.withdrawn"), onError: failed });
  const stop = trpc.sponsor.stop.useMutation({
    onSuccess: answer => { close(); toast.success(answer.refund ? t("sponsor.stoppedRefund", { refund: kwd(answer.refund) }) : t("sponsor.stopped")); refresh(); },
    onError: failed,
  });

  const rateWrong = rateProblem(rate);
  const approveTotal = !rateWrong ? approvedTotal(row, today, rate) : null;
  const payByWrong = payByProblem(payBy, row.startsOn < today ? today : row.startsOn, today);
  const referenceWrong = referenceProblem(reference);
  const startPassed = row.startsOn < today;
  const room = row.storeRoom ?? list.room;
  const short = room !== null && Number(room) < Number(row.total);
  const a = row.actions;

  return (
    <li className={`${surfaceClass} p-4 text-[13px] text-[#0a285a] sm:p-5`}>
      <div className="flex gap-3">
        <div className="size-16 shrink-0 overflow-hidden rounded-xl border border-[#e3e8f0] bg-white">
          {row.photo ? <img src={row.photo} alt="" loading="lazy" decoding="async" className="size-full object-contain" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <p className="min-w-0 text-[15px] font-bold">
              {row.productHandle
                ? <a href={shopHref(`/products/${row.productHandle}`)} className="hover:underline"><bdi>{row.productTitle}</bdi></a>
                : <bdi>{row.productTitle}</bdi>}
              {side === "netlet" ? <span className="text-[13px] font-semibold ink-muted"> · <bdi>{row.vendorName}</bdi></span> : null}
            </p>
            <Pill tone={row.state === "paid" ? "good" : row.state === "payment" || row.state === "review" || row.state === "sent" ? "warning" : row.state === "declined" ? "danger" : "neutral"}>
              {t(side === "netlet" ? NETLET_STATE_LABEL[row.state] ?? STATE_LABEL[row.state] : STATE_LABEL[row.state])}
            </Pill>
          </div>
          <p className="mt-1 text-[#3d5376]">
            {run(row.placement?.startsOn ?? row.startsOn, row.placement?.endsOn ?? row.endsOn)}
            {" · "}
            {row.days === 1 ? t("ads.quoteLineOne", { total: kwd(row.total) }) : t("ads.quoteLine", { total: kwd(row.total), rate: kwd(row.dailyRate), days: row.days })}
          </p>
          <p className="mt-0.5 text-[12px] ink-muted">{t("sponsor.referenceLine", { reference: row.transferReference })}</p>
        </div>
      </div>

      <Steps row={row} />

      <div className="mt-3 space-y-2">
        {row.note ? <p className="text-[#3d5376]"><span className="font-semibold">{t("sponsor.noteFromStore")}</span> <bdi dir="auto">{row.note}</bdi></p> : null}
        {row.reply ? <p className="text-[#3d5376]"><span className="font-semibold">{t("sponsor.replyFromNetLet")}</span> <bdi dir="auto">{row.reply}</bdi></p> : null}
        <StateLine row={row} side={side} />
        {side === "netlet" && row.storeRoom !== null && (row.state === "review" || row.state === "payment") ? (
          <p className="ink-muted">{t("sponsor.storeRoom", { room: kwd(row.storeRoom) })}</p>
        ) : null}
        {row.results ? <Results row={row} /> : null}
      </div>

      {a.approve || a.decline || a.payFromEarnings || a.sendTransfer || a.confirmPayment || a.notReceived || a.withdraw || a.stop ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-[#eef1f5] pt-3">
          {a.approve ? <button type="button" onClick={() => { setRate(row.dailyRate); setPayBy(row.suggestedPayBy); setAsking("approve"); }} className={smallButtonClass.primary}>{t("sponsor.approve")}</button> : null}
          {a.confirmPayment ? <button type="button" onClick={() => { setStartsOn(today); setAsking("confirm"); }} className={smallButtonClass.primary}>{t("sponsor.confirm")}</button> : null}
          {a.payFromEarnings ? <button type="button" onClick={() => setAsking("earnings")} className={smallButtonClass.primary}><Wallet className="size-4" aria-hidden />{t("sponsor.payEarnings")}</button> : null}
          {a.sendTransfer ? <button type="button" onClick={() => setAsking("transfer")} className={smallButtonClass.secondary}><Landmark className="size-4" aria-hidden />{t("sponsor.payTransfer")}</button> : null}
          {a.notReceived ? <button type="button" onClick={() => { setPayBy(row.suggestedPayBy); setAsking("missing"); }} className={smallButtonClass.secondary}>{t("sponsor.notReceived")}</button> : null}
          {a.withdraw ? <button type="button" onClick={() => setAsking("withdraw")} className={smallButtonClass.quietDanger}>{t("sponsor.withdraw")}</button> : null}
          {a.decline ? <button type="button" onClick={() => setAsking("decline")} className={smallButtonClass.quietDanger}>{t("sponsor.decline")}</button> : null}
          {a.stop ? <button type="button" onClick={() => setAsking("stop")} className={smallButtonClass.quietDanger}>{t(side === "netlet" ? "ads.takeDown" : "sponsor.stop")}</button> : null}
        </div>
      ) : null}

      {/* NetLet approves at a day rate, by a last day to pay. */}
      <ConfirmDialog
        open={asking === "approve"}
        title={t("sponsor.approveTitle")}
        body={t(startPassed ? "sponsor.approveLate" : "sponsor.approveBody", { run: run(startPassed ? today : row.startsOn, row.endsOn) })}
        confirmLabel={t("sponsor.approveSend")}
        confirmDisabled={rateWrong !== null || payByWrong !== null}
        pending={approve.isPending}
        onClose={close}
        onConfirm={() => approve.mutate({ id: row.id, dailyRate: rate, payBy, reply: reply.trim() || null })}
      >
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t("sponsor.dayRate")} hint={t("sponsor.dayRateHint", { rate: kwd(list.rateCard) })} error={rateWrong ? t(rateWrong) : undefined}>
            <input inputMode="decimal" dir="ltr" value={rate} onChange={event => setRate(event.target.value)} className={fieldClass} />
          </Field>
          <Field label={t("sponsor.payBy")} error={payByWrong ? t(payByWrong) : undefined}>
            <input type="date" value={payBy} min={today} max={row.startsOn < today ? today : row.startsOn} onChange={event => setPayBy(event.target.value)} className={fieldClass} />
          </Field>
        </div>
        {approveTotal ? <p className="mt-2 text-[14px] font-bold text-[#0a285a]">{t("sponsor.approveTotal", { total: kwd(approveTotal) })}</p> : null}
        <Field label={t("sponsor.replyLabel")} optional hint={t("sponsor.replyHint")} className="mt-3">
          <textarea dir="auto" value={reply} maxLength={SPONSOR_NOTE_MAX} onChange={event => setReply(event.target.value)} rows={2} className={textareaClass} />
        </Field>
      </ConfirmDialog>

      {/* NetLet declines, with the reason the store reads. */}
      <ConfirmDialog
        open={asking === "decline"}
        tone="danger"
        title={t("sponsor.declineTitle", { product: isolate(row.productTitle) })}
        body={t(row.state === "sent" ? "sponsor.declineSent" : "sponsor.declineBody", { total: kwd(row.total) })}
        confirmLabel={t("sponsor.decline")}
        pending={decline.isPending}
        onClose={close}
        onConfirm={() => { setTried(true); if (reply.trim()) decline.mutate({ id: row.id, reply }); }}
      >
        <Field label={t("sponsor.declineReason")} error={tried && !reply.trim() ? t("sponsor.needsReply") : undefined} className="mt-3">
          <textarea dir="auto" value={reply} maxLength={SPONSOR_NOTE_MAX} onChange={event => setReply(event.target.value)} rows={3} className={textareaClass} />
        </Field>
      </ConfirmDialog>

      {/* The store pays from what it has earned. */}
      <ConfirmDialog
        open={asking === "earnings"}
        title={t("sponsor.earningsTitle", { total: kwd(row.total) })}
        body={t(short ? "sponsor.earningsShort" : "sponsor.earningsBody", { room: room !== null ? kwd(room) : "", run: run(row.startsOn, row.endsOn) })}
        confirmLabel={t("sponsor.payEarnings")}
        confirmDisabled={short}
        pending={payEarnings.isPending}
        onClose={close}
        onConfirm={() => payEarnings.mutate({ id: row.id })}
      />

      {/* The store transfers to NetLet's account and says so. */}
      <ConfirmDialog
        open={asking === "transfer"}
        title={t("sponsor.transferTitle", { total: kwd(row.total) })}
        body={t("sponsor.transferBody", { day: row.payBy ? day(row.payBy) : "" })}
        confirmLabel={t("sponsor.transferDone")}
        pending={sendTransfer.isPending}
        onClose={close}
        onConfirm={() => { setTried(true); if (!referenceWrong) sendTransfer.mutate({ id: row.id, reference }); }}
      >
        {list.transfer ? (
          <dl className="mt-3 grid gap-2 rounded-xl border border-[#e1e7ef] bg-[#fafbfd] p-3 text-[13px]">
            <AccountLine label={t("sponsor.accountName")} value={list.transfer.name} />
            <AccountLine label={t("sponsor.accountIban")} value={list.transfer.iban} copy />
            <AccountLine label={t("sponsor.accountAmount")} value={kwd(row.total)} />
            <AccountLine label={t("sponsor.accountReference")} value={row.transferReference} copy />
          </dl>
        ) : null}
        <Field label={t("sponsor.bankReference")} hint={t("sponsor.bankReferenceHint")} error={tried && referenceWrong ? t(referenceWrong) : undefined} className="mt-3">
          <input dir="ltr" value={reference} maxLength={SPONSOR_REFERENCE_MAX} onChange={event => setReference(event.target.value)} className={fieldClass} />
        </Field>
      </ConfirmDialog>

      {/* NetLet sees the transfer arrive. */}
      <ConfirmDialog
        open={asking === "confirm"}
        title={t("sponsor.confirmPaidTitle", { total: kwd(row.total) })}
        body={t(startPassed ? "sponsor.confirmLate" : "sponsor.confirmPaidBody", { reference: row.paymentReference ?? "", ours: row.transferReference, run: run(row.startsOn, row.endsOn) })}
        confirmLabel={t("sponsor.confirm")}
        pending={confirm.isPending}
        onClose={close}
        onConfirm={() => confirm.mutate({ id: row.id, startsOn: startPassed ? startsOn : null })}
      >
        {startPassed ? (
          <Field label={t("sponsor.runsFrom")} hint={t("sponsor.runsFromHint", { days: row.days })} className="mt-3">
            <input type="date" value={startsOn} min={today} max={addDays(today, MAX_AD_LEAD_DAYS)} onChange={event => setStartsOn(event.target.value)} className={fieldClass} />
          </Field>
        ) : null}
      </ConfirmDialog>

      {/* NetLet has not seen it: back to waiting for the payment. */}
      <ConfirmDialog
        open={asking === "missing"}
        title={t("sponsor.missingTitle")}
        body={t("sponsor.missingBody", { reference: row.paymentReference ?? "" })}
        confirmLabel={t("sponsor.notReceived")}
        confirmDisabled={payByWrong !== null}
        pending={missing.isPending}
        onClose={close}
        onConfirm={() => { setTried(true); if (reply.trim()) missing.mutate({ id: row.id, reply, payBy }); }}
      >
        <Field label={t("sponsor.missingReason")} error={tried && !reply.trim() ? t("sponsor.needsReply") : undefined} className="mt-3">
          <textarea dir="auto" value={reply} maxLength={SPONSOR_NOTE_MAX} onChange={event => setReply(event.target.value)} rows={2} className={textareaClass} />
        </Field>
        <Field label={t("sponsor.payBy")} error={payByWrong ? t(payByWrong) : undefined} className="mt-3">
          <input type="date" value={payBy} min={today} max={row.startsOn < today ? today : row.startsOn} onChange={event => setPayBy(event.target.value)} className={fieldClass} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={asking === "withdraw"}
        tone="danger"
        title={t("sponsor.withdrawTitle", { product: isolate(row.productTitle) })}
        body={t("sponsor.withdrawBody")}
        confirmLabel={t("sponsor.withdraw")}
        cancelLabel={t("sponsor.keep")}
        pending={withdraw.isPending}
        onClose={close}
        onConfirm={() => withdraw.mutate({ id: row.id })}
      />

      <ConfirmDialog
        open={asking === "stop"}
        tone="danger"
        title={t(side === "netlet" ? "ads.takeDownTitle" : "ads.cancelTitle", { product: isolate(row.productTitle) })}
        body={row.refundIfStopped
          ? t("sponsor.stopRefund", { refund: kwd(row.refundIfStopped) })
          : t(row.placement?.state === "upcoming" ? "ads.cancelFree" : "ads.cancelToday")}
        confirmLabel={t(side === "netlet" ? "ads.takeDown" : "sponsor.stop")}
        cancelLabel={t("sponsor.keep")}
        pending={stop.isPending}
        onClose={close}
        onConfirm={() => stop.mutate({ id: row.id })}
      />
    </li>
  );
}

/** What the total of an approval would be, for the dialog: the days still to come at the rate typed. */
function approvedTotal(row: Row, today: string, rate: string): string {
  const start = row.startsOn < today ? today : row.startsOn;
  const days = Math.max(0, Math.round((Date.parse(`${row.endsOn}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1);
  const fils = Math.round(Number(rate) * 1000) * days;
  return (fils / 1000).toFixed(3);
}

function AccountLine({ label, value, copy = false }: { label: string; value: string; copy?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <dt className="ink-muted">{label}</dt>
      <dd className="flex items-center gap-2 font-semibold text-[#0a285a]">
        <bdi dir="ltr" className="break-all">{value}</bdi>
        {copy ? (
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(value).then(() => toast.success(t("sponsor.copied")), () => undefined)}
            aria-label={t("sponsor.copy", { what: label })}
            title={t("sponsor.copy", { what: label })}
            className="grid size-8 place-items-center rounded-lg text-[#0a285a] hover:bg-[#0a285a]/[.06]"
          >
            <Copy className="size-4" aria-hidden />
          </button>
        ) : null}
      </dd>
    </div>
  );
}

/** One sentence saying where the request stands and what happens next, for whoever is reading. */
function StateLine({ row, side }: { row: Row; side: "store" | "netlet" }) {
  const { t } = useTranslation();
  const kwd = useKwd();
  const day = useDay();
  const store = side === "store";
  let key: MessageKey | null = null;
  let values: Record<string, string> = {};
  switch (row.state) {
    case "review":
      key = store ? "sponsor.lineReviewStore" : "sponsor.lineReviewNetLet";
      break;
    case "payment":
      key = store ? "sponsor.linePaymentStore" : "sponsor.linePaymentNetLet";
      values = { total: kwd(row.total), day: row.payBy ? day(row.payBy) : "" };
      break;
    case "sent":
      key = store ? "sponsor.lineSentStore" : "sponsor.lineSentNetLet";
      values = { total: kwd(row.total), reference: row.paymentReference ?? "", ours: row.transferReference };
      break;
    case "paid":
      if (row.placement) {
        key = row.placement.state === "upcoming" ? "sponsor.lineUpcoming" : row.placement.state === "running" ? "sponsor.lineRunning" : row.placement.cancelledOn ? "sponsor.lineStopped" : "sponsor.lineEnded";
        values = { day: day(row.placement.startsOn), end: day(row.placement.cancelledOn && row.placement.cancelledOn < row.placement.endsOn ? row.placement.cancelledOn : row.placement.endsOn) };
      }
      break;
    case "declined":
      key = "sponsor.lineDeclined";
      break;
    case "withdrawn":
      key = "sponsor.lineWithdrawn";
      break;
    case "lapsed":
      key = row.status === "payment" ? "sponsor.lineLapsedPayment" : "sponsor.lineLapsedReview";
      values = { day: row.payBy ? day(row.payBy) : day(row.endsOn) };
      break;
  }
  if (!key) return null;
  const paidLine = row.state === "paid" && row.paidWith
    ? t(row.paidWith === "earnings" ? "sponsor.paidWithEarnings" : "sponsor.paidWithTransfer", { total: kwd(row.total), accrued: kwd(row.placement?.accrued ?? "0.000") })
    : null;
  return (
    <>
      <p className="font-semibold">{t(key, values)}</p>
      {paidLine ? <p className="ink-muted">{paidLine}</p> : null}
    </>
  );
}

/** How a run is doing: home-page views against the days before it, and orders. */
function Results({ row }: { row: Row }) {
  const { t } = useTranslation();
  const results = row.results!;
  if (results.daysShown <= 0) return null;
  return (
    <div className="rounded-xl border border-[#e1e7ef] bg-[#fafbfd] p-3">
      <p className="text-[13px] font-semibold text-[#0a285a]">{t("sponsor.resultsTitle", { days: results.daysShown })}</p>
      <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label={t("sponsor.resultViews")} value={results.homeViews} />
        <Figure label={t("sponsor.resultVisitors")} value={results.homeVisitors} />
        <Figure
          label={t("sponsor.resultBefore")}
          value={results.viewsBefore}
          note={results.lift === null ? undefined : t(results.lift >= 0 ? "sponsor.liftUp" : "sponsor.liftDown", { percent: Math.abs(results.lift) })}
        />
        <Figure label={t("sponsor.resultOrders")} value={results.orders} />
      </dl>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] ink-muted">{label}</dt>
      <dd className="text-[18px] font-extrabold tabular-nums text-[#0a285a]">{value.toLocaleString("en")}</dd>
      {note ? <dd className="text-[12px] ink-muted">{note}</dd> : null}
    </div>
  );
}
