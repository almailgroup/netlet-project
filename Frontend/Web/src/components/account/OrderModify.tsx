/**
 * "Modify order" — lower a quantity or take an item out, before a driver has
 * it (on the owner's word: "make changes to an order when permitted, before
 * delivery pick up", and "cancel individual eligible products").
 *
 * Nothing changes until the shopper has seen what it costs. "Review the
 * change" asks the server for a quote (`orders.changeQuote`): what the driver
 * collects before and after, a store's delivery fee a smaller order no longer
 * earns free, a code that no longer applies, stored value that goes back.
 * "Confirm" sends the same change with the figure it showed, and the server
 * refuses if that figure has moved (`orders.changeMoved`) — then the quote is
 * asked again rather than anything happening at a price nobody saw.
 *
 * Only what the server marks `changeable` is offered: unpaid, still in the
 * store's hands, not part of a set. Raising a quantity is not a change this
 * offers (the owner's choice): a new order does that at today's price.
 */
import { useId, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, LoaderCircle, Minus, PackageSearch, Plus, Trash2 } from "lucide-react";
import { Thumb } from "@/components/product/Thumb";
import { useTranslation } from "@/hooks/useTranslation";
import { formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import type { Detail } from "@/components/account/LineReturn";
import type { ChangeQuote } from "@shared/commerce/orderChanges";

const CARD = "mt-3 rounded-2xl border border-[#d5dfeb] bg-white p-4";
const STEP = "grid size-11 place-items-center rounded-full border border-[#d5dfeb] bg-white text-[#0a285a] disabled:opacity-40 pointer-fine:size-8";

export function OrderModify({ reference, detail, onDone, onCancel }: {
  reference: string;
  detail: Detail;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t, tError, locale } = useTranslation();
  const ids = useId();
  const utils = trpc.useUtils();
  const lines = detail.lines.filter(line => line.changeable);
  const [wanted, setWanted] = useState<Record<number, number>>({});
  const [quote, setQuote] = useState<ChangeQuote | null>(null);
  const [asking, setAsking] = useState(false);
  const money = (amount: string) => formatMoney(amount, { currencyCode: detail.order.currency, locale });

  const changes = lines
    .filter(line => wanted[line.id] !== undefined && wanted[line.id] !== line.quantity)
    .map(line => ({ lineId: line.id, quantity: wanted[line.id] }));

  const set = (lineId: number, quantity: number) => {
    setQuote(null);
    setWanted(current => ({ ...current, [lineId]: quantity }));
  };

  const review = async () => {
    if (!changes.length) return;
    setAsking(true);
    try {
      setQuote(await utils.orders.changeQuote.fetch({ reference, changes }));
    } catch (error) {
      toast.error(tError(error instanceof Error ? error.message : ""));
    } finally {
      setAsking(false);
    }
  };

  const apply = trpc.orders.change.useMutation({
    onSuccess: () => {
      toast.success(t("orders.changeDone"));
      onDone();
    },
    onError: error => {
      toast.error(tError(error.message));
      /* The figure moved under the shopper: ask again, never apply at a price nobody saw. */
      if (error.message === "orders.changeMoved") void review();
    },
  });

  const title = (lineId: number) => detail.lines.find(line => line.id === lineId)?.productTitle ?? "";

  return (
    <section aria-labelledby={`${ids}-title`} className={CARD}>
      <h4 id={`${ids}-title`} className="text-[14px] font-extrabold text-[#0a285a]">{t("orders.modify")}</h4>
      <p className="mt-1 text-[12px] leading-5 ink-muted">{t("orders.modifyNote")}</p>
      <ul className="mt-3 space-y-3">
        {lines.map(line => {
          const now = wanted[line.id] ?? line.quantity;
          return (
            <li key={line.id} className="flex items-center gap-3 rounded-xl border border-[#e7edf5] p-3">
              <Thumb src={line.photo ?? null} alt="" className="size-12 shrink-0 rounded-lg border border-[#e7edf5] bg-white object-contain" icon={<PackageSearch className="size-4" />} />
              <div className="min-w-0 flex-1">
                <p dir="auto" className="line-clamp-2 text-[13px] font-bold leading-5 text-[#0a285a]">{line.productTitle}</p>
                <p className="text-[12px] ink-muted">{now === 0 ? t("orders.modifyRemoving") : t("orders.modifyOrdered", { count: line.quantity })}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label={t("orders.modifyQuantity", { item: line.productTitle })}>
                <button type="button" onClick={() => set(line.id, Math.max(0, now - 1))} disabled={now === 0} aria-label={now === 1 ? t("orders.modifyRemove") : t("orders.modifyLess")} className={STEP}>
                  {now === 1 ? <Trash2 className="size-4" aria-hidden /> : <Minus className="size-4" aria-hidden />}
                </button>
                <span className="w-7 text-center text-[15px] font-extrabold tabular-nums text-[#0a285a]" aria-live="polite">{now}</span>
                <button type="button" onClick={() => set(line.id, Math.min(line.quantity, now + 1))} disabled={now >= line.quantity} aria-label={t("orders.modifyMore")} className={STEP}>
                  <Plus className="size-4" aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {quote ? (
        <div role="status" className="mt-4 rounded-xl bg-[#f4f6fa] p-4 text-[13px] leading-6 text-[#1f2a44]">
          <p className="font-extrabold text-[#0a285a]">{t("orders.quoteTitle")}</p>
          <ul className="mt-1 space-y-0.5">
            {quote.lines.map(line => (
              <li key={line.lineId}>
                <bdi>{title(line.lineId)}</bdi>: {line.to === 0 ? t("orders.quoteRemoved") : t("orders.quoteFromTo", { from: line.from, to: line.to })}
              </li>
            ))}
            {quote.addedFees.map((fee, index) => (
              <li key={`fee-${index}`}>
                {fee.waived
                  ? t("orders.quoteFeeWaived", { store: `⁨${fee.vendorName}⁩` })
                  : t("orders.quoteFee", { store: `⁨${fee.vendorName}⁩`, fee: money(fee.fee) })}
              </li>
            ))}
            {quote.codeLost ? <li>{t("orders.quoteCodeLost", { amount: money(quote.discountBefore) })}</li> : null}
            {!quote.codeLost && quote.discountAfter !== quote.discountBefore ? <li>{t("orders.quoteCodeLess", { amount: money(quote.discountAfter) })}</li> : null}
            {Number(quote.giftCardBack) > 0 ? <li>{t("orders.quoteGiftBack", { amount: money(quote.giftCardBack) })}</li> : null}
            {Number(quote.pointsBack) > 0 ? <li>{t("orders.quotePointsBack", { points: Math.round(Number(quote.pointsBack) * 1000) })}</li> : null}
          </ul>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[14px] font-extrabold text-[#0a285a]">
            {t("orders.quoteOwed")}
            <span className="ink-muted line-through decoration-1">{money(quote.owedBefore)}</span>
            <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
            <span>{money(quote.owedAfter)}</span>
          </p>
          <p className="mt-1 text-[12px] ink-muted">{t("orders.quoteStock")}</p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {quote ? (
          <button
            type="button"
            onClick={() => apply.mutate({ reference, changes, expectOwed: quote.owedAfter })}
            disabled={apply.isPending}
            className="glass-navy type-control pressable inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 disabled:opacity-60 pointer-fine:min-h-9"
          >
            {apply.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            {t("orders.changeConfirm")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void review()}
            disabled={!changes.length || asking}
            className="glass-navy type-control pressable inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 disabled:opacity-50 pointer-fine:min-h-9"
          >
            {asking ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            {t("orders.changeReview")}
          </button>
        )}
        <button type="button" onClick={onCancel} className="glass type-control pressable min-h-11 rounded-full px-4 py-2 pointer-fine:min-h-9">
          {t("orders.keepOrder")}
        </button>
      </div>
      {!changes.length ? <p className="mt-2 text-[12px] ink-muted">{t("orders.modifyNothingYet")}</p> : null}
    </section>
  );
}
