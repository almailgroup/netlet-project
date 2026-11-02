/**
 * What a shopper can do about an opened order, on the owner's word: track it,
 * cancel it while nothing has started, and ask for a refund on what arrived.
 *
 * **Nothing here decides.** Whether the order can be cancelled is the server's
 * answer (`cancel`, from `shopperCancelState`), whether an item can be sent
 * back is the return window the server resolved per line, and the steps are
 * `stepsForOrder`'s — this file draws them and sends the presses.
 *
 * - **Track order** opens the order's parcels as steps — placed, being
 *   prepared, on the way, delivered — one line of steps per store, since a
 *   basket from three stores is three parcels. The dates drawn are the facts
 *   (placed, arrived); a date still to come is the store's estimate and says
 *   so. While a parcel is on the road the live map is under its steps, and
 *   the panel opens by itself.
 * - **Cancel order** asks first, in `ConfirmDialog`, and says what comes back.
 *   Once a store has started, the button is gone and a sentence says why and
 *   what to do instead — a missing button is not an answer.
 * - **Request a refund** asks which of the items still inside their return
 *   window, then why, and sends one return request per item, the per-item
 *   form's own call with the refund chosen.
 */
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Check, CircleX, PackageSearch, RotateCcw, Truck, Zap } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Select";
import { Thumb } from "@/components/product/Thumb";
import { TrackParcels } from "@/components/account/TrackParcels";
import { mayRequestReturn, REASON_LABEL, type Detail } from "@/components/account/LineReturn";
import { useFeature } from "@/hooks/useFeature";
import { useTranslation } from "@/hooks/useTranslation";
import { useShortDayFormat } from "@/hooks/useDateFormat";
import { trpc } from "@/lib/trpc";
import { MAX_RETURN_NOTE, RETURN_REASONS, type ReturnReason } from "@shared/commerce/returnRequests";
import { TRACK_STEPS, type ParcelTrack, type TrackStep } from "@shared/commerce/orderTracking";
import type { MessageKey } from "@shared/i18n/dictionary";

const STEP_LABEL: Record<TrackStep, MessageKey> = {
  placed: "track.placed",
  preparing: "track.preparing",
  onTheWay: "track.onTheWay",
  delivered: "track.delivered",
};

/** A store's name inside one of our sentences keeps its own direction. */
const isolate = (text: string) => `⁨${text}⁩`;

const ACTION = "glass type-control pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 py-1.5 pointer-fine:min-h-9";

export function OrderActions({ reference, detail, trackFirst = false, refundFirst = false }: {
  reference: string;
  detail: Detail;
  trackFirst?: boolean;
  /** Opened from the list row's "Request a refund", or `&refund=1`: the form is open, in view and focused. */
  refundFirst?: boolean;
}) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const returnsOn = useFeature("returns");
  const ids = useId();
  const [tracking, setTracking] = useState(() => trackFirst || detail.steps.parcels.some(parcel => parcel.step === "onTheWay"));
  const [refunding, setRefunding] = useState(refundFirst);
  const [asking, setAsking] = useState(false);

  const refundable = returnsOn ? detail.lines.filter(line => mayRequestReturn(line, detail.returns)) : [];
  /* Opened for the refund: the form is brought into view with its first box
     focused, since the press that asked for it is on the list above. */
  useEffect(() => {
    if (!refundFirst) return;
    const panel = document.getElementById(`${ids}-refund`);
    panel?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    panel?.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
  }, [refundFirst, ids]);
  const refresh = () => {
    void utils.orders.get.invalidate({ reference });
    void utils.orders.list.invalidate();
    void utils.orders.onTheWay.invalidate();
  };
  const cancel = trpc.orders.cancel.useMutation({
    onSuccess: () => {
      setAsking(false);
      toast.success(t("orders.cancelDone"));
      refresh();
    },
    onError: error => {
      setAsking(false);
      toast.error(tError(error.message));
      refresh();
    },
  });

  /* Said only while the order is still coming: an order that is over needs
     no sentence about why it cannot be cancelled. */
  const whyNot = !detail.cancel.cancellable && detail.cancel.reason !== "orders.cancelClosed" && !detail.steps.cancelled
    && detail.steps.parcels.some(parcel => parcel.step !== "delivered")
    ? detail.cancel.reason
    : null;

  return (
    <div className="mb-4">
      <div className="flex flex-wrap gap-2">
        {detail.steps.cancelled ? null : (
          <button
            type="button"
            aria-expanded={tracking}
            aria-controls={`${ids}-track`}
            onClick={() => setTracking(open => !open)}
            className={ACTION}
          >
            <Truck className="size-4 rtl:-scale-x-100" aria-hidden />{t("orders.track")}
          </button>
        )}
        {refundable.length > 0 ? (
          <button
            type="button"
            aria-expanded={refunding}
            aria-controls={`${ids}-refund`}
            onClick={() => setRefunding(open => !open)}
            className={ACTION}
          >
            <RotateCcw className="size-4 rtl:-scale-x-100" aria-hidden />{t("orders.requestRefund")}
          </button>
        ) : null}
        {detail.cancel.cancellable ? (
          <button type="button" onClick={() => setAsking(true)} className={`${ACTION} text-[#8c2f22]`}>
            <CircleX className="size-4" aria-hidden />{t("orders.cancelOrder")}
          </button>
        ) : null}
      </div>
      {whyNot ? <p className="mt-2 text-[12px] leading-5 ink-muted">{t(whyNot)}</p> : null}

      <div id={`${ids}-track`} hidden={!tracking}>
        {tracking ? <OrderTracking reference={reference} detail={detail} /> : null}
      </div>
      <div id={`${ids}-refund`} hidden={!refunding || refundable.length === 0}>
        {refunding && refundable.length > 0 ? (
          <RefundForm
            reference={reference}
            lines={refundable}
            onDone={() => { setRefunding(false); refresh(); }}
            onCancel={() => setRefunding(false)}
          />
        ) : null}
      </div>

      <ConfirmDialog
        open={asking}
        title={t("orders.cancelAsk")}
        body={t("orders.cancelBody")}
        confirmLabel={t("orders.cancelOrder")}
        cancelLabel={t("orders.keepOrder")}
        tone="danger"
        pending={cancel.isPending}
        icon={<CircleX className="size-5" aria-hidden />}
        onConfirm={() => cancel.mutate({ reference })}
        onClose={() => setAsking(false)}
      />
    </div>
  );
}

/**
 * The order's parcels as steps, one line of steps per parcel, with the live
 * map under a parcel on the road.
 */
function OrderTracking({ reference, detail }: { reference: string; detail: Detail }) {
  const { t } = useTranslation();
  const shortDay = useShortDayFormat();
  const headingId = useId();
  const { steps } = detail;
  const titles = new Map(detail.lines.map(line => [line.id, line.productTitle]));
  const estimated = steps.parcels.some(parcel => parcel.promise && parcel.promise.kind !== "madeToOrder");

  return (
    <section aria-labelledby={headingId} className="mt-3 rounded-2xl border border-[#d5dfeb] bg-[#fbfcfe] p-4">
      <h4 id={headingId} className="text-[14px] font-extrabold text-[#0a285a]">{t("track.title")}</h4>
      <ul className="mt-3 space-y-3">
        {steps.parcels.map(parcel => (
          <li key={parcel.key} className="rounded-xl border border-[#e7edf5] bg-white p-3">
            <ParcelSteps parcel={parcel} placedAt={steps.placedAt} titles={titles} shortDay={shortDay} />
          </li>
        ))}
      </ul>
      {estimated ? <p className="mt-3 text-[12px] leading-5 ink-muted">{t("track.estimate")}</p> : null}
      {/* Live tracking (3.4.3), while anything is on the road. */}
      {steps.parcels.some(parcel => parcel.step === "onTheWay") ? <TrackParcels reference={reference} /> : null}
    </section>
  );
}

function ParcelSteps({ parcel, placedAt, titles, shortDay }: {
  parcel: ParcelTrack;
  placedAt: string;
  titles: Map<number, string>;
  shortDay: (value: string) => string;
}) {
  const { t } = useTranslation();
  const reached = TRACK_STEPS.indexOf(parcel.step);
  const names = parcel.lineIds.map(id => titles.get(id)).filter((name): name is string => Boolean(name));
  const dateOf = (step: TrackStep) =>
    step === "placed" ? shortDay(placedAt) : step === "delivered" && parcel.deliveredAt ? shortDay(parcel.deliveredAt) : null;

  const promise = (() => {
    const promised = parcel.promise;
    if (!promised) return null;
    if (promised.kind === "madeToOrder") return { text: t("track.madeToOrder"), late: false };
    if (promised.kind === "preorder") return { text: promised.at ? t("track.preorder", { date: shortDay(promised.at) }) : t("track.preorderOpen"), late: false };
    if (promised.late) return { text: t("track.late", { date: shortDay(promised.to) }), late: true };
    const from = shortDay(promised.from);
    const to = shortDay(promised.to);
    return { text: from === to ? t("track.expectedOn", { date: from }) : t("track.expected", { from, to }), late: false };
  })();

  return (
    <>
      <p className="text-[13px] font-extrabold text-[#0a285a]">
        {parcel.vendorName ? t("track.from", { store: isolate(parcel.vendorName) }) : t("track.parcel")}
      </p>
      {names.length > 0 ? <p dir="auto" className="mt-0.5 truncate text-[12px] ink-muted">{names.join(" · ")}</p> : null}
      {parcel.fast || parcel.destinationLabel ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-semibold text-[#0a285a]">
          {parcel.fast ? <span className="inline-flex items-center gap-1"><Zap className="size-3.5" aria-hidden />{t("track.fast")}</span> : null}
          {parcel.destinationLabel ? <span>{t("track.to", { label: isolate(parcel.destinationLabel) })}</span> : null}
        </p>
      ) : null}

      <ol className="mt-3">
        {TRACK_STEPS.map((step, index) => {
          const done = index < reached || (index === reached && step === "delivered");
          const now = index === reached && !done;
          const label = t(STEP_LABEL[step]);
          const date = dateOf(step);
          const last = index === TRACK_STEPS.length - 1;
          return (
            <li key={step} className="relative flex items-start gap-3 pb-3 last:pb-0">
              {last ? null : (
                <span aria-hidden className={`absolute start-[9px] top-5 bottom-0 w-0.5 ${index < reached ? "bg-[#0a285a]" : "bg-[#d5dfeb]"}`} />
              )}
              <span
                aria-hidden
                className={`relative z-[1] grid size-5 shrink-0 place-items-center rounded-full ${
                  done ? "bg-[#0a285a] text-white"
                    : now ? "border-2 border-[#0a285a] bg-white"
                      : "border-2 border-[#c9d3e0] bg-white"
                }`}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : now ? <span className="size-2 rounded-full bg-[#0a285a]" /> : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3">
                <span className={`text-[13px] ${now ? "font-extrabold text-[#0a285a]" : done ? "font-bold text-[#0a285a]" : "font-semibold ink-muted"}`}>
                  <span className="sr-only">{t(done ? "track.stepDone" : now ? "track.stepNow" : "track.stepNext", { step: label })}</span>
                  <span aria-hidden>{label}</span>
                </span>
                {date ? <span className="text-[12px] ink-muted">{date}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      {promise ? <p className={`mt-2 text-[12px] font-semibold ${promise.late ? "ink-accent" : "text-[#2f5d33]"}`}>{promise.text}</p> : null}
    </>
  );
}

/**
 * "Request a refund": which items, why, and a note — one return request per
 * item, with the refund chosen. Each is decided as the per-item form's is,
 * and the item says where its request stands once it is sent.
 */
function RefundForm({ reference, lines, onDone, onCancel }: {
  reference: string;
  lines: Detail["lines"];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t, tError } = useTranslation();
  const ids = useId();
  const [chosen, setChosen] = useState<number[]>(() => (lines.length === 1 ? [lines[0].id] : []));
  const [reason, setReason] = useState<ReturnReason>("damaged");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const ask = trpc.orders.requestReturn.useMutation();

  const send = async () => {
    if (chosen.length === 0) {
      setProblem(t("orders.refundPickOne"));
      document.getElementById(`${ids}-items`)?.querySelector("input")?.focus();
      return;
    }
    setProblem(null);
    setSending(true);
    let sent = 0;
    for (const orderItemId of chosen) {
      try {
        await ask.mutateAsync({ reference, orderItemId, kind: "refund", reason, note: note.trim() || null });
        sent += 1;
      } catch (error) {
        toast.error(tError(error instanceof Error ? error.message : ""));
      }
    }
    setSending(false);
    if (sent > 0) {
      toast.success(t("orders.refundSent"));
      onDone();
    }
  };

  return (
    <form
      className="mt-3 rounded-2xl border border-[#d5dfeb] bg-white p-4"
      aria-labelledby={`${ids}-title`}
      onSubmit={event => { event.preventDefault(); void send(); }}
    >
      <h4 id={`${ids}-title`} className="text-[14px] font-extrabold text-[#0a285a]">{t("orders.requestRefund")}</h4>
      <fieldset id={`${ids}-items`} className="mt-3" aria-describedby={problem ? `${ids}-problem` : undefined}>
        <legend className="text-[12px] font-extrabold ink-muted">{t("orders.refundWhich")}</legend>
        <ul className="mt-2 space-y-2">
          {lines.map(line => (
            <li key={line.id}>
              <label className="flex min-h-11 items-center gap-3 rounded-xl border border-[#e7edf5] px-3 py-2">
                <input
                  type="checkbox"
                  checked={chosen.includes(line.id)}
                  onChange={event => {
                    const ticked = event.target.checked;
                    setChosen(now => ticked ? [...now, line.id] : now.filter(id => id !== line.id));
                    setProblem(null);
                  }}
                  className="size-4 shrink-0 accent-[#0a285a]"
                />
                <Thumb src={line.photo ?? null} alt="" className="size-10 shrink-0 rounded-lg border border-[#e7edf5] bg-white object-contain" icon={<PackageSearch className="size-4" />} />
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate text-[13px] font-bold text-[#0a285a]">{line.productTitle}</span>
                  {/* A lone "Default" names no choice anybody made. */}
                  {line.variantTitle && line.variantTitle !== "Default" ? <span dir="auto" className="block truncate text-[12px] ink-muted">{line.variantTitle}</span> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {problem ? <p id={`${ids}-problem`} role="alert" className="mt-2 text-[12px] font-semibold text-[#8c2f22]">{problem}</p> : null}
      </fieldset>
      <label className="mt-3 block">
        <span className="block text-[12px] font-extrabold ink-muted">{t("returns.why")}</span>
        <Select
          value={reason}
          onChange={event => setReason(event.target.value as ReturnReason)}
          className="mt-1 h-11 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[13px] text-[#0a285a]"
        >
          {RETURN_REASONS.map(option => <option key={option} value={option}>{t(REASON_LABEL[option])}</option>)}
        </Select>
      </label>
      <label className="mt-3 block">
        <span className="block text-[12px] font-extrabold ink-muted">{t(reason === "other" ? "returns.noteRequired" : "returns.noteOptional")}</span>
        <textarea
          value={note}
          onChange={event => setNote(event.target.value)}
          maxLength={MAX_RETURN_NOTE}
          rows={2}
          dir="auto"
          required={reason === "other"}
          className="glass-field mt-1 w-full rounded-2xl px-3 py-2 text-sm"
        />
      </label>
      <p className="mt-2 text-[12px] leading-5 ink-muted">{t("returns.howItWorks")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" disabled={sending} className="glass-navy type-control pressable min-h-11 rounded-full px-4 py-2 disabled:opacity-60 pointer-fine:min-h-9">
          {t("orders.refundSend")}
        </button>
        <button type="button" onClick={onCancel} className="glass type-control pressable min-h-11 rounded-full px-4 py-2 pointer-fine:min-h-9">
          {t("claims.cancel")}
        </button>
      </div>
    </form>
  );
}
