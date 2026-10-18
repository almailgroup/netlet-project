/**
 * After the door: rate the delivery, report damage.
 *
 * Drawn per *parcel* rather than per line, because a parcel — one seller's
 * goods to one door — is what one driver carried. Three things arrive in one
 * box and the shopper has one opinion about how it was handed over.
 *
 * Apart from the product review on purpose (3.4.4): a lamp should not earn one
 * star because the van was late, and the seller does not employ the driver.
 *
 * **Nothing here decides.** Whether a rating is open and whether damage may be
 * reported come from the server with the server's clock, the way the return
 * window does; the page draws the answer and, where the answer is no, says why
 * — "this parcel came from the seller's own van" is something a shopper can act
 * on, and a missing button is not.
 */
import { formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useFeature } from "@/hooks/useFeature";
import { CLAIM_WINDOW_DAYS, claimCeiling, MAX_CLAIM_DESCRIPTION } from "@shared/commerce/damageClaims";
import { DELIVERY_RATING_WINDOW_DAYS, MAX_DELIVERY_COMMENT, RATING_MAX } from "@shared/commerce/deliveryRatings";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import type { AppRouter } from "../../../../../Backend/src/routes";
import type { inferRouterOutputs } from "@trpc/server";
import { ShieldAlert, Star, Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type OrderDetail = NonNullable<inferRouterOutputs<AppRouter>["orders"]["get"]>;
type Parcel = OrderDetail["parcels"][number];

/** A refusal, with whichever window it is about filled in. */
function useRefusal() {
  const { t } = useTranslation();
  return (key: string) => {
    if (!isMessageKey(key)) return key;
    const days = key.startsWith("claims.") ? CLAIM_WINDOW_DAYS : DELIVERY_RATING_WINDOW_DAYS;
    return t(key as MessageKey, { days: String(days) });
  };
}

export function ParcelCare({ reference, currency, parcels }: { reference: string; currency: string; parcels: Parcel[] }) {
  const { t } = useTranslation();
  /* Only parcels there is something to say about: one that has arrived, or one
     already carrying a claim. A list of "not yet" under every open order is
     noise somebody learns to scroll past. */
  const shown = parcels.filter(parcel => parcel.arrivedAt || parcel.claim);
  if (shown.length === 0) return null;

  return (
    <section aria-labelledby={`care-${reference}`} className="mt-5 border-t border-[#e7edf5] pt-4">
      <h4 id={`care-${reference}`} className="type-label ink-muted">{t("delivery.heading")}</h4>
      <ul className="mt-3 space-y-3">
        {shown.map(parcel => (
          <ParcelCard key={parcel.key} reference={reference} currency={currency} parcel={parcel} />
        ))}
      </ul>
    </section>
  );
}

function ParcelCard({ reference, currency, parcel }: { reference: string; currency: string; parcel: Parcel }) {
  const { t } = useTranslation();
  const formatDate = useDateFormat();
  const refusal = useRefusal();
  const [reporting, setReporting] = useState(false);
  const vendor = parcel.vendorName ?? "—";
  /* Both switchable (2.3). A claim already filed still shows its status: the
     switch stops new claims, not the answer to an open one. */
  const ratingsOn = useFeature("deliveryRatings");
  const claimsOn = useFeature("damageClaims");

  return (
    <li className="rounded-xl border border-[#e7edf5] bg-[#fbfcfe] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="inline-flex items-center gap-2 text-sm font-extrabold text-[#0a285a]">
          <Truck className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden />
          <span dir="auto">
            {parcel.destinationLabel
              ? t("delivery.parcelFromTo", { vendor, label: parcel.destinationLabel })
              : t("delivery.parcelFrom", { vendor })}
          </span>
        </p>
        {parcel.arrivedAt ? (
          <span className="text-[12px] ink-muted">{t("delivery.arrivedOn", { date: formatDate(parcel.arrivedAt) })}</span>
        ) : null}
      </div>

      {ratingsOn || parcel.rating ? <RateDelivery reference={reference} parcel={parcel} readOnly={!ratingsOn} /> : null}

      {/* The claim, once there is one: what the shopper is waiting to hear. */}
      {parcel.claim ? <ClaimStatus claim={parcel.claim} currency={currency} /> : null}

      {!claimsOn ? null : reporting ? (
        <ReportDamage reference={reference} currency={currency} parcel={parcel} onDone={() => setReporting(false)} />
      ) : parcel.claimRefusal === null ? (
        <button
          type="button"
          onClick={() => setReporting(true)}
          className="pressable mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-extrabold text-[#8c2f22] hover:bg-[#fdeceb]"
        >
          <ShieldAlert className="size-3.5" aria-hidden />{t("claims.report")}
        </button>
      ) : parcel.claimRefusal !== "claims.alreadyOpen" && parcel.claimRefusal !== "claims.alreadyPaid" && parcel.arrivedAt ? (
        /* Said rather than hidden, except for the two refusals the claim's own
           status line above already explains. */
        <p className="mt-3 text-[12px] leading-5 ink-muted">{refusal(parcel.claimRefusal)}</p>
      ) : null}

    </li>
  );
}

function RateDelivery({ reference, parcel, readOnly = false }: { reference: string; parcel: Parcel; readOnly?: boolean }) {
  const { t } = useTranslation();
  const formatDate = useDateFormat();
  const refusal = useRefusal();
  const utils = trpc.useUtils();
  const [rating, setRating] = useState(parcel.rating?.rating ?? 0);
  const [comment, setComment] = useState(parcel.rating?.comment ?? "");

  const rate = trpc.orders.rateDelivery.useMutation({
    onSuccess: () => {
      toast.success(t("delivery.saved"));
      void utils.orders.get.invalidate({ reference });
    },
    onError: error => toast.error(refusal(error.message)),
  });

  const state = parcel.ratingState;
  if (!state.allowed || readOnly) {
    /* Closed: what they said stays visible; not arrived: nothing to say yet. */
    if (!parcel.rating) return !state.allowed && state.reason === "delivery.ratingClosed" ? <p className="mt-3 text-[12px] ink-muted">{refusal(state.reason)}</p> : null;
    return (
      <p className="mt-3 inline-flex items-center gap-2 text-[12px] font-bold text-[#0a285a]">
        {t("delivery.yourRating")} <Stars value={parcel.rating.rating} />
      </p>
    );
  }

  const name = `delivery-${reference}-${parcel.key}`;
  return (
    <form
      className="mt-3"
      onSubmit={event => {
        event.preventDefault();
        if (rating === 0) { toast.error(t("delivery.invalidRating")); return; }
        rate.mutate({ reference, parcelKey: parcel.key, rating, comment: comment.trim() || null });
      }}
    >
      <fieldset>
        <legend className="text-[12px] font-extrabold text-[#0a285a]">{t("delivery.rateLegend")}</legend>
        <p className="mt-0.5 text-[12px] leading-5 ink-muted">{t("delivery.rateNote")}</p>
        {/* Radios, because five stars are one choice from a set — the same
            control the product review uses, and for the same reason. */}
        <div className="mt-2 flex gap-1">
          {Array.from({ length: RATING_MAX }, (_, index) => index + 1).map(star => (
            <label key={star} className="cursor-pointer">
              <input
                type="radio"
                name={name}
                value={star}
                checked={rating === star}
                onChange={() => setRating(star)}
                className="peer sr-only"
              />
              <span className="sr-only">{t(star === 1 ? "review.starsOne" : "review.stars", { count: star })}</span>
              <Star
                aria-hidden
                className={`size-6 transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#f2683a] ${
                  star <= rating ? "fill-[#ffb800] text-[#ffb800]" : "text-[#c3ccda]"
                }`}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-3 block">
        <span className="block text-[12px] font-extrabold ink-muted">{t("delivery.commentLabel")}</span>
        <input
          value={comment}
          onChange={event => setComment(event.target.value)}
          maxLength={MAX_DELIVERY_COMMENT}
          dir="auto"
          placeholder={t("delivery.commentPlaceholder")}
          className="glass-field mt-1 w-full rounded-full px-4 py-2 text-sm"
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={rate.isPending}
          className="glass-navy type-control pressable rounded-full px-4 py-2 disabled:opacity-60"
        >
          {t("delivery.save")}
        </button>
        {parcel.rating ? (
          <span className="text-[12px] ink-muted">{t("delivery.openUntil", { date: formatDate(state.closesAt) })}</span>
        ) : null}
      </div>
    </form>
  );
}

function Stars({ value }: { value: number }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex gap-0.5">
      {Array.from({ length: RATING_MAX }, (_, index) => (
        <Star key={index} aria-hidden className={`size-3.5 ${index < value ? "fill-[#ffb800] text-[#ffb800]" : "text-[#c3ccda]"}`} />
      ))}
      <span className="sr-only">{t("review.outOf", { value })}</span>
    </span>
  );
}

function ClaimStatus({ claim, currency }: { claim: NonNullable<Parcel["claim"]>; currency: string }) {
  const { t, locale } = useTranslation();
  const money = (amount: string) => formatMoney(amount, { currencyCode: currency, locale });
  const line =
    claim.status === "accepted"
      ? t("claims.statusAccepted", { amount: money(claim.awardedAmount ?? claim.claimedAmount) })
      : claim.status === "rejected"
        ? t("claims.statusRejected")
        : t("claims.statusOpen");
  const tone =
    claim.status === "accepted" ? "bg-[#d8ead8] text-[#2f5d33]" : claim.status === "rejected" ? "bg-[#e7edf5] text-[#536b8c]" : "bg-[#fff0ab] text-[#705523]";
  return (
    <div className="mt-3">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-extrabold ${tone}`}>
        <ShieldAlert className="size-3.5" aria-hidden />{line}
      </span>
      {claim.decisionNote ? <p dir="auto" className="mt-1 text-[12px] leading-5 ink-muted">{claim.decisionNote}</p> : null}
    </div>
  );
}

function ReportDamage({ reference, currency, parcel, onDone }: { reference: string; currency: string; parcel: Parcel; onDone: () => void }) {
  const { t, locale } = useTranslation();
  const refusal = useRefusal();
  const utils = trpc.useUtils();
  const [chosen, setChosen] = useState<number[]>(parcel.lines.length === 1 ? [parcel.lines[0].lineId] : []);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");

  /* The same ceiling the server holds a claim to, computed by the same
     function from the same frozen figures — so the hint cannot promise more
     than the API will accept. */
  const ceiling = useMemo(
    () => claimCeiling(parcel.lines.filter(line => chosen.includes(line.lineId))),
    [chosen, parcel.lines],
  );

  const file = trpc.orders.claimDamage.useMutation({
    onSuccess: () => {
      toast.success(t("claims.filed"));
      void utils.orders.get.invalidate({ reference });
      onDone();
    },
    onError: error => toast.error(refusal(error.message)),
  });

  return (
    <form
      className="mt-4 rounded-xl border border-[#f3d2cc] bg-white p-4"
      onSubmit={event => {
        event.preventDefault();
        file.mutate({
          reference,
          lineIds: chosen,
          amount: amount.trim() || ceiling,
          description,
          evidenceUrl: evidenceUrl.trim() || null,
        });
      }}
    >
      <h5 className="text-sm font-extrabold text-[#0a285a]">{t("claims.reportHeading")}</h5>
      <p className="mt-1 text-[12px] leading-5 ink-muted">{t("claims.reportNote")}</p>

      <fieldset className="mt-3">
        <legend className="text-[12px] font-extrabold ink-muted">{t("claims.whichItems")}</legend>
        <ul className="mt-1 space-y-1">
          {parcel.lines.map(line => (
            <li key={line.lineId}>
              <label className="flex items-center gap-2 text-sm text-[#0a285a]">
                <input
                  type="checkbox"
                  checked={chosen.includes(line.lineId)}
                  onChange={event => setChosen(event.target.checked ? [...chosen, line.lineId] : chosen.filter(id => id !== line.lineId))}
                  className="size-4 accent-[#0a285a]"
                />
                <span dir="auto" className="min-w-0 flex-1 truncate">{line.productTitle}</span>
                <bdi dir="ltr" className="text-[12px] ink-muted">{formatMoney(line.lineTotal, { currencyCode: currency, locale })}</bdi>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <label className="mt-3 block">
        <span className="block text-[12px] font-extrabold ink-muted">{t("claims.amountLabel")}</span>
        <input
          value={amount}
          onChange={event => setAmount(event.target.value)}
          inputMode="decimal"
          dir="ltr"
          placeholder={ceiling}
          aria-describedby={`ceiling-${parcel.key}`}
          className="glass-field mt-1 w-40 rounded-full px-4 py-2 text-sm"
        />
        <span id={`ceiling-${parcel.key}`} className="mt-1 block text-[12px] ink-muted">
          {t("claims.amountHint", { amount: formatMoney(ceiling, { currencyCode: currency, locale }) })}
        </span>
      </label>

      <label className="mt-3 block">
        <span className="block text-[12px] font-extrabold ink-muted">{t("claims.descriptionLabel")}</span>
        <textarea
          value={description}
          onChange={event => setDescription(event.target.value)}
          maxLength={MAX_CLAIM_DESCRIPTION}
          rows={3}
          dir="auto"
          required
          className="glass-field mt-1 w-full rounded-2xl px-4 py-2.5 text-sm"
        />
      </label>

      <label className="mt-3 block">
        <span className="block text-[12px] font-extrabold ink-muted">{t("claims.evidenceLabel")}</span>
        <input
          value={evidenceUrl}
          onChange={event => setEvidenceUrl(event.target.value)}
          type="url"
          dir="ltr"
          placeholder="https://"
          className="glass-field mt-1 w-full rounded-full px-4 py-2 text-sm"
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={file.isPending || chosen.length === 0}
          className="glass-navy type-control pressable rounded-full px-4 py-2 disabled:opacity-60"
        >
          {t("claims.submit")}
        </button>
        <button type="button" onClick={onDone} className="glass type-control pressable rounded-full px-4 py-2">
          {t("claims.cancel")}
        </button>
      </div>
    </form>
  );
}
