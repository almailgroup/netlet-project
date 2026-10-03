/**
 * The shopper's standing orders (3.1.19), and every way to stop one.
 *
 * Each card says when the next delivery is, what it will cost now against the
 * price agreed to, and what the last run did — "skipped, it was out of stock"
 * is something a shopper needs to read here rather than discover by a parcel
 * not arriving. Skip, pause and stop are one press each, and stop asks first,
 * because it is the one that cannot be undone.
 *
 * A subscription paused because the price rose shows both prices and asks the
 * shopper to accept the new one. That is the whole of the price promise made
 * on the product page: the run would not charge more, so somebody has to say
 * yes here before it does.
 */
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { QueryGate } from "@/components/admin/QueryGate";
import { Thumb } from "@/components/product/Thumb";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { compareMoney } from "@shared/money";
import type { PauseReason } from "@shared/commerce/subscriptions";
import type { MessageKey } from "@shared/i18n/dictionary";
import type { AppRouter } from "../../../../server/routers";
import type { inferRouterOutputs } from "@trpc/server";

type Subscription = inferRouterOutputs<AppRouter>["subscriptions"]["mine"][number];

const PAUSED: Record<PauseReason, MessageKey> = {
  byShopper: "subscriptions.pausedByYou",
  priceRose: "subscriptions.pausedPrice",
  noAddress: "subscriptions.pausedAddress",
  unavailable: "subscriptions.pausedUnavailable",
  refused: "subscriptions.pausedRefused",
};

export function AccountSubscriptions() {
  const { t } = useTranslation();
  const mine = trpc.subscriptions.mine.useQuery();
  return (
    <QueryGate queries={[mine]}>
      {() => {
        const rows = mine.data ?? [];
        if (rows.length === 0) return <p className="rounded-2xl border border-[#e6e9ef] bg-white px-5 py-6 text-sm text-[#536b8c]">{t("subscriptions.none")}</p>;
        return <ul className="space-y-3">{rows.map(row => <Card key={row.id} sub={row} />)}</ul>;
      }}
    </QueryGate>
  );
}

function Card({ sub }: { sub: Subscription }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const date = useDateFormat();
  const utils = trpc.useUtils();
  const [stopping, setStopping] = useState(false);
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });
  const day = (value: string) => date(`${value}T12:00:00Z`);
  const change = trpc.subscriptions.change.useMutation({
    onSuccess: () => { setStopping(false); toast.success(t("subscriptions.saved")); void utils.subscriptions.mine.invalidate(); },
    onError: error => { setStopping(false); toast.error(tError(error.message)); },
  });
  const act = (payload: Parameters<typeof change.mutate>[0]["change"]) => change.mutate({ id: sub.id, change: payload });
  const cancelled = sub.status === "cancelled";
  const rose = sub.pausedReason === "priceRose" && sub.priceNow !== null && compareMoney(sub.priceNow, sub.priceCeiling) > 0;

  return (
    <li className="rounded-2xl border border-[#e6e9ef] bg-white p-4 text-[12px] text-[#0a285a]">
      <div className="flex gap-3">
        <Thumb src={sub.image} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-extrabold">
            {sub.productHandle && !cancelled
              ? <Link href={`/products/${sub.productHandle}`} className="underline underline-offset-2"><bdi>{sub.productTitle}</bdi></Link>
              : <bdi>{sub.productTitle}</bdi>}
            {sub.variantTitle && sub.variantTitle !== "Default" ? <span className="font-bold ink-muted"> · <bdi>{sub.variantTitle}</bdi></span> : null}
          </p>
          <p className="mt-0.5">
            {t("subscriptions.cadence", { count: String(sub.quantity), every: t(sub.intervalWeeks === 1 ? "subscribe.weekly" : "subscribe.weeks", { count: String(sub.intervalWeeks) }) })}
            {sub.addressLabel ? <> · <bdi>{sub.addressLabel}</bdi></> : null}
          </p>
          <p className="mt-0.5 ink-muted">
            {cancelled
              ? t("subscriptions.stopped")
              : sub.status === "paused"
                ? t(PAUSED[sub.pausedReason ?? "byShopper"])
                : t("subscriptions.next", { date: day(sub.nextRunOn) })}
          </p>
          {!cancelled ? (
            <p className="mt-0.5 ink-muted">
              {sub.priceNow
                ? t("subscriptions.prices", { now: amount(sub.priceNow), ceiling: amount(sub.priceCeiling) })
                : t("subscriptions.ceilingOnly", { ceiling: amount(sub.priceCeiling) })}
            </p>
          ) : null}
          {sub.lastOutcome === "outOfStock" && sub.lastRunOn ? <p className="mt-0.5 font-bold text-[#8c2f22]">{t("subscriptions.lastOutOfStock", { date: day(sub.lastRunOn) })}</p> : null}
          {sub.lastOutcome === "placed" && sub.lastRunOn ? <p className="mt-0.5 ink-muted">{t("subscriptions.lastPlaced", { date: day(sub.lastRunOn) })}</p> : null}
        </div>
      </div>

      {!cancelled ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {rose && sub.priceNow ? (
            <button type="button" disabled={change.isPending} onClick={() => act({ action: "acceptPrice", price: sub.priceNow! })} className="glass-navy pressable type-control rounded-full px-4 py-2">
              {t("subscriptions.acceptPrice", { price: amount(sub.priceNow) })}
            </button>
          ) : null}
          {sub.status === "active" ? (
            <>
              <button type="button" disabled={change.isPending} onClick={() => act({ action: "skip" })} className="glass pressable type-control rounded-full px-4 py-2">{t("subscriptions.skip")}</button>
              <button type="button" disabled={change.isPending} onClick={() => act({ action: "pause" })} className="glass pressable type-control rounded-full px-4 py-2">{t("subscriptions.pause")}</button>
            </>
          ) : !rose && sub.priceNow ? (
            <button type="button" disabled={change.isPending} onClick={() => act({ action: "resume" })} className="glass pressable type-control rounded-full px-4 py-2">{t("subscriptions.resume")}</button>
          ) : null}
          <button type="button" disabled={change.isPending} onClick={() => setStopping(true)} className="glass pressable type-control rounded-full px-4 py-2">{t("subscriptions.stop")}</button>
        </div>
      ) : null}

      <ConfirmDialog
        open={stopping}
        tone="danger"
        title={t("subscriptions.stopTitle", { product: sub.productTitle })}
        body={t("subscriptions.stopBody")}
        confirmLabel={t("subscriptions.stop")}
        pending={change.isPending}
        onClose={() => setStopping(false)}
        onConfirm={() => act({ action: "cancel" })}
      />
    </li>
  );
}
