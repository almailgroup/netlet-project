/**
 * Subscribe & Save on the product page (3.1.19).
 *
 * Drawn only where the store offers standing orders and the switch is on, and
 * never for a pre-order — a standing order for something that does not exist
 * yet is a promise on a promise.
 *
 * It says the one thing that makes a standing order safe to agree to, in the
 * panel rather than in small print: **no delivery is ever charged above the
 * price shown here without asking first.** That is the server's rule — a run
 * pauses rather than charging more — and the panel says it because a shopper
 * deciding whether to hand over a schedule is deciding whether to trust it.
 *
 * Subscribing places nothing today. It records the instruction and the first
 * delivery date, and the account page is where it is skipped, paused or
 * stopped, which the confirmation says.
 */
import { useId, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Repeat } from "lucide-react";
import AuthDialog from "@/components/auth/AuthDialog";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useFeature } from "@/hooks/useFeature";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { addDays, kuwaitToday } from "@shared/commerce/adBookings";
import { MAX_FIRST_RUN_DAYS, MAX_SUBSCRIPTION_QUANTITY, SUBSCRIPTION_INTERVALS, subscriberPrice } from "@shared/commerce/subscriptions";
import type { Product, ProductVariant } from "@shared/commerce/types";
import { multiplyMoney } from "@shared/money";

const field = "glass-field mt-1 h-10 w-full rounded-full px-4 text-sm";

export function SubscribePanel({ product, variant, quantity }: { product: Product; variant: ProductVariant | undefined; quantity: number }) {
  const on = useFeature("subscriptions");
  if (!on || !product.subscription || !variant || variant.preorder || !variant.availableForSale) return null;
  return <Panel percent={product.subscription.savingPercent} variant={variant} quantity={quantity} />;
}

function Panel({ percent, variant, quantity }: { percent: number; variant: ProductVariant; quantity: number }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const { isAuthenticated } = useAuth();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const today = kuwaitToday(new Date());
  const [intervalWeeks, setIntervalWeeks] = useState<number>(2);
  const [addressId, setAddressId] = useState<number | null>(null);
  const [firstRunOn, setFirstRunOn] = useState(addDays(today, 1));

  const unit = subscriberPrice(variant.price.amount, percent);
  const amount = (value: string) => money({ amount: value, currencyCode: variant.price.currencyCode });
  const book = trpc.customer.addresses.list.useQuery(undefined, { enabled: isAuthenticated && open });
  const chosen = addressId ?? book.data?.[0]?.id ?? null;
  const utils = trpc.useUtils();
  const create = trpc.subscriptions.create.useMutation({
    onSuccess: reply => {
      toast.success(t("subscribe.done", { date: formatDate(`${reply.nextRunOn}T12:00:00Z`) }));
      setOpen(false);
      void utils.subscriptions.mine.invalidate();
    },
    onError: error => toast.error(tError(error.message)),
  });
  const count = Math.min(quantity, MAX_SUBSCRIPTION_QUANTITY);

  return (
    <section aria-labelledby={titleId} className="mt-5 rounded-2xl border border-[#d5dfeb] bg-white p-4">
      <h2 id={titleId} className="flex items-center gap-2 text-[14px] font-extrabold text-[#0a285a]">
        <Repeat className="size-4" aria-hidden />
        {percent > 0 ? t("subscribe.titleSave", { percent: String(percent) }) : t("subscribe.title")}
      </h2>
      <p className="mt-1 text-[12px] leading-5 text-[#0a285a]">
        {percent > 0
          ? t("subscribe.priceSave", { price: amount(unit), was: amount(variant.price.amount) })
          : t("subscribe.price", { price: amount(unit) })}
      </p>
      <p className="mt-1 text-[11px] leading-5 ink-muted">{t("subscribe.promise", { price: amount(unit) })}</p>

      {!open ? (
        <button
          type="button"
          onClick={() => (isAuthenticated ? setOpen(true) : setAuthOpen(true))}
          className="glass pressable type-control mt-3 rounded-full px-4 py-2"
        >
          {t(isAuthenticated ? "subscribe.start" : "subscribe.signIn")}
        </button>
      ) : (
        <form
          className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={event => {
            event.preventDefault();
            if (chosen) create.mutate({ variantId: Number(variant.id), quantity: count, intervalWeeks, addressId: chosen, firstRunOn });
          }}
        >
          <label className="block">
            <span className="block text-[11px] font-extrabold ink-muted">{t("subscribe.every")}</span>
            <select aria-label={t("subscribe.every")} value={intervalWeeks} onChange={event => setIntervalWeeks(Number(event.target.value))} className={field}>
              {SUBSCRIPTION_INTERVALS.map(weeks => (
                <option key={weeks} value={weeks}>{t(weeks === 1 ? "subscribe.weekly" : "subscribe.weeks", { count: String(weeks) })}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-extrabold ink-muted">{t("subscribe.firstDelivery")}</span>
            <input type="date" required value={firstRunOn} min={addDays(today, 1)} max={addDays(today, MAX_FIRST_RUN_DAYS)} onChange={event => setFirstRunOn(event.target.value)} className={field} />
          </label>
          <div className="sm:col-span-2">
            {book.data && book.data.length === 0 ? (
              <p className="text-[12px] text-[#0a285a]">
                {t("subscribe.needAddress")}{" "}
                <Link href="/account/addresses" className="font-extrabold ink-accent underline underline-offset-2">{t("subscribe.addAddress")}</Link>
              </p>
            ) : (
              <label className="block">
                <span className="block text-[11px] font-extrabold ink-muted">{t("subscribe.deliverTo")}</span>
                <select aria-label={t("subscribe.deliverTo")} value={chosen ?? ""} onChange={event => setAddressId(Number(event.target.value))} className={field}>
                  {(book.data ?? []).map(address => <option key={address.id} value={address.id}>{address.label}</option>)}
                </select>
              </label>
            )}
          </div>
          <p className="text-[12px] text-[#0a285a] sm:col-span-2">
            {t("subscribe.summary", { count: String(count), total: amount(multiplyMoney(unit, count)) })}
          </p>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" disabled={!chosen || create.isPending} className="glass-navy pressable type-control rounded-full px-5 py-2 disabled:opacity-50">{t("subscribe.confirm")}</button>
            <button type="button" onClick={() => setOpen(false)} className="glass pressable type-control rounded-full px-4 py-2">{t("subscribe.notNow")}</button>
          </div>
        </form>
      )}
      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
    </section>
  );
}
