/**
 * The orders a seller has to act on.
 *
 * Requirement 3.2.8, and the half of 3.2.2 that had nothing behind it:
 * `listOrdersFor`, `getOrderFor`, `setLineFulfilment` and `recordCashCollected`
 * were all written the day the tables landed and **nothing could call them**.
 * That is the same gap `listOrdersForUser` had before the shopper's router
 * existed, with a sharper cost — without this page nobody can mark a parcel
 * shipped or a driver's cash collected, so `delivered_at` is never set, a
 * review never opens, a payout never starts and a referral never pays.
 *
 * **Fulfilment is per line and the page is built that way.** An order from
 * three sellers can be fully paid while two have shipped nothing, and partial
 * shipment within one seller is ordinary — so there is a control on each line
 * and none on the order. What the order carries is the payment, which is the
 * other lifecycle and genuinely whole-order: cash is collected once, for the
 * basket, by one driver.
 *
 * Scope is the server's. A vendor sees the orders holding their lines and only
 * those lines; an admin sees every order whole.
 */
import { useFeature } from "@/hooks/useFeature";
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { canRecordCollection } from "@shared/commerce/payment";
import type { Flag as FraudFlag, RiskLevel } from "@shared/commerce/fraudSignals";
import { can, type Actor } from "@shared/inventory/permissions";
import { FULFILMENT_STATES, nextStates, type FulfilmentState } from "@shared/commerce/fulfilment";
import { mayMoveLine } from "@shared/commerce/netletFulfilment";
import { isDefaultVariantTitle } from "@shared/commerce/fromInventory";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";
import { Banknote, PackageCheck, ShieldAlert, Warehouse } from "lucide-react";
import { CLAIM_WINDOW_DAYS, claimCeiling, MAX_CLAIM_DESCRIPTION } from "@shared/commerce/damageClaims";
import { useState } from "react";
import { toast } from "sonner";
import { PinLink } from "@/components/map/PinLink";

const FULFILMENT_LABEL: Record<FulfilmentState, MessageKey> = {
  pending: "admin.fulfilPending",
  preparing: "admin.fulfilPreparing",
  shipped: "admin.fulfilShipped",
  delivered: "admin.fulfilDelivered",
  cancelled: "admin.fulfilCancelled",
  returned: "admin.fulfilReturned",
};

const PAYMENT_LABEL: Record<string, MessageKey> = {
  pending_payment: "admin.orderPendingPayment",
  paid: "admin.orderPaid",
  cancelled: "admin.orderCancelled",
  refunded: "admin.orderRefunded",
};

export default function AdminOrders() {
  usePageMeta(privatePageMeta("Orders"));
  return <AdminShell need="product.view">{actor => <Orders actor={actor} />}</AdminShell>;
}

function Orders({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const list = trpc.orders.forSeller.useQuery({ page }, { placeholderData: previous => previous });

  /*
   * How much attention each order wants (3.6.5), over the page already on
   * screen. Admin-only: the signals name other accounts' behaviour, so the
   * server refuses a vendor and the question is not asked on their behalf.
   */
  const ids = (list.data?.rows ?? []).map(row => row.id);
  const risk = trpc.orders.risk.useQuery({ ids }, { enabled: ids.length > 0 && can(actor, "platform.viewAll") });
  const riskFor = (id: number) => risk.data?.find(entry => entry.orderId === id);

  return (
    <>
      <h1 className="text-[22px] leading-8 font-extrabold sm:text-[24px]">{t("admin.orders")}</h1>
      <p className="mt-1 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("admin.ordersNote")}</p>

      <QueryGate queries={[list]}>
        {() => {
          const rows = list.data?.rows ?? [];
          if (rows.length === 0) {
            return (
              <div className="mt-5 rounded-2xl border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-14 text-center">
                <p className="text-sm font-extrabold">{t("admin.ordersEmpty")}</p>
              </div>
            );
          }
          return (
            <div className="mt-5 space-y-2">
              {rows.map(row => (
                <OrderRow
                  key={row.id}
                  row={row}
                  risk={riskFor(row.id)}
                  open={open === row.id}
                  onToggle={() => setOpen(open === row.id ? null : row.id)}
                />
              ))}
              {list.data ? <Pager page={list.data} onPage={setPage} /> : null}
            </div>
          );
        }}
      </QueryGate>
    </>
  );
}

/*
 * The vendor's own figure, not the shopper's basket total. `listOrdersFor`
 * decides which it is — an admin sees the order, a seller sees their own
 * lines — because a shared basket's grand total covers a rival's goods.
 */
type Row = {
  id: number;
  reference: string;
  status: string;
  paymentMethod: string | null;
  placedAt: Date;
  orderTotal: string;
  vendorCount: number;
};

const SIGNAL_LABEL: Record<string, MessageKey> = {
  newAccountHighValue: "admin.riskNewAccount",
  addressManyAccounts: "admin.riskAddress",
  rapidOrders: "admin.riskRapid",
  refundHistory: "admin.riskRefunds",
  highValueCash: "admin.riskCash",
  firstOrderLargeQuantity: "admin.riskQuantity",
};

type OrderRisk = { orderId: number; risk: RiskLevel; flags: FraudFlag[] };

/**
 * A signal's evidence, with its money formatted.
 *
 * The signals are pure and carry figures as decimal strings, which is right —
 * `shared/` has no currency formatter and should not — but a bare "481.500" on
 * a page where every other figure reads "KWD 481.500" looks like a different
 * kind of number.
 */
function moneyDetail(
  detail: Record<string, number | string>,
  money: (value: { amount: string; currencyCode: string }) => string,
): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(detail).map(([key, value]) =>
      key === "total" ? [key, money({ amount: String(value), currencyCode: "KWD" })] : [key, value],
    ),
  );
}

function OrderRow({ row, risk, open, onToggle }: { row: Row; risk?: OrderRisk; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();

  return (
    <div className="rounded-2xl border border-[#e6e9ef] bg-white">
      {/*
        A disclosure rather than a second page. An order is read in order to do
        something to one of its lines, and a round trip through a detail route
        for a two-line order is three clicks to press one button.
      */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="pressable flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-4 text-start"
      >
        <div className="min-w-0 flex-1">
          <p className="font-bold text-[#0a285a]"><bdi dir="ltr">{row.reference}</bdi></p>
          <p className="mt-0.5 text-[11px] ink-muted">
            {formatDate(row.placedAt)}
            {row.vendorCount > 1 ? <> · {t("admin.orderSellers", { count: row.vendorCount })}</> : null}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-extrabold ${
          row.status === "paid" ? "bg-[#e3efe4] text-[#2f5d33]" : "bg-[#e7edf5] text-[#0a285a]"
        }`}>
          {t(PAYMENT_LABEL[row.status] ?? "admin.orderPendingPayment")}
        </span>
        {/* A badge only when there is something to say: "low" on every row is
            an alert that never stops firing, which teaches people to stop
            reading the one that matters. */}
        {risk && risk.risk !== "low" ? (
          <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-extrabold ${
            risk.risk === "high" ? "bg-[#8c2f22] text-white" : "bg-[#fff0ab] text-[#0a285a]"
          }`}>
            {t(risk.risk === "high" ? "admin.riskHigh" : "admin.riskWatch")}
          </span>
        ) : null}
        <span className="shrink-0 font-extrabold text-[#0a285a]"><bdi dir="ltr">{money({ amount: row.orderTotal, currencyCode: "KWD" })}</bdi></span>
      </button>

      {/* The evidence, not the verdict: "four accounts have used this address"
          is something an administrator can disagree with, and "risk: high" is
          not. Nothing here has held the order — it is a reason to look. */}
      {open && risk && risk.flags.length > 0 ? (
        <ul className="border-t border-[#eef1f6] px-4 py-3">
          {risk.flags.map(flag => (
            <li
              key={flag.signal}
              className={`text-[12px] leading-5 ${flag.serious ? "font-extrabold text-[#8c2f22]" : "text-[#536b8c]"}`}
            >
              · {t(SIGNAL_LABEL[flag.signal] ?? "admin.riskWatch", moneyDetail(flag.detail, money))}
            </li>
          ))}
        </ul>
      ) : null}

      {open ? <OrderDetail orderId={row.id} /> : null}
    </div>
  );
}

function OrderDetail({ orderId }: { orderId: number }) {
  const { t } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const detail = trpc.orders.forSellerDetail.useQuery({ orderId });
  /* Already in the cache: the shell asked it before drawing the page. */
  const me = trpc.inventory.me.useQuery();
  const utils = trpc.useUtils();

  const refresh = () => {
    void utils.orders.forSellerDetail.invalidate({ orderId });
    void utils.orders.forSeller.invalidate();
  };
  const setFulfilment = trpc.orders.setFulfilment.useMutation({
    onSuccess: () => { toast.success(t("admin.fulfilmentSaved")); refresh(); },
    onError: error => toast.error(error.message),
  });
  const markCollected = trpc.orders.markCollected.useMutation({
    /* `recorded: false` is a real answer — somebody else pressed it first, or
       the order was never a cash one — so it is reported rather than shown as
       a success the page cannot back up. */
    onSuccess: reply => {
      if (reply.recorded) toast.success(t("admin.collectedSaved"));
      else toast.error(t("admin.collectedAlready"));
      refresh();
    },
    onError: error => toast.error(error.message),
  });

  return (
    <div className="border-t border-[#eef1f6] p-4">
      <QueryGate queries={[detail]}>
        {() => {
          const found = detail.data;
          if (!found) return <p className="text-[13px] text-[#536b8c]">{t("admin.orderGone")}</p>;
          const { order, lines } = found;

          return (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  {order.subscriptionId ? (
                    <p className="mb-2 inline-flex rounded-full bg-[#e7edf5] px-3 py-1 text-[11px] font-extrabold text-[#0a285a]">{t("subscriptions.repeatOrder")}</p>
                  ) : null}
                  <p className="text-[11px] font-extrabold tracking-[.06em] ink-muted uppercase">{t("admin.orderDeliverTo")}</p>
                  <p className="mt-1 text-[13px] leading-6 text-[#0a285a]">
                    <span dir="auto">{order.contactName ?? t("admin.orderNoName")}</span>
                    <br />
                    <span dir="auto">{order.addressLine ?? t("admin.orderNoAddress")}</span>
                    {order.addressNotes ? <><br /><span dir="auto" className="ink-muted">{order.addressNotes}</span></> : null}
                  </p>
                  <p className="mt-1"><PinLink pin={order.deliveryPin} /></p>
                </div>

                {/* Cash is collected once, for the basket — the one thing on
                    this page that is genuinely about the order rather than a
                    line. Absent unless it applies, rather than disabled. */}
                {canRecordCollection(order) ? (
                  <button
                    type="button"
                    disabled={markCollected.isPending}
                    onClick={() => markCollected.mutate({ orderId })}
                    className="glass-navy type-control pressable inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 disabled:opacity-60"
                  >
                    <Banknote className="size-4" aria-hidden /> {t("admin.markCollected")}
                  </button>
                ) : null}
              </div>

              <ul className="mt-4 space-y-2">
                {lines.map(line => (
                  <li key={line.id} className="rounded-xl border border-[#eef1f6] bg-[#fbfcfe] p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="font-bold text-[#0a285a]">
                        <span dir="auto">{line.productTitle}</span>
                        {line.variantTitle && !isDefaultVariantTitle(line.variantTitle) ? <span dir="auto" className="ink-muted"> · {line.variantTitle}</span> : null}
                      </p>
                      <p className="text-[13px] font-extrabold text-[#0a285a]">
                        <bdi dir="ltr">{line.quantity} × {money({ amount: line.unitPrice, currencyCode: "KWD" })}</bdi>
                      </p>
                    </div>
                    {/* What was bought with it (3.1.2). The seller is who turns
                        up to fit the thing, so this is not decoration. */}
                    {line.addons.length > 0 ? (
                      <ul className="mt-1 space-y-0.5">
                        {line.addons.map(addon => (
                          <li key={addon.id} dir="auto" className="text-[12px] ink-accent">
                            + {addon.label} · <bdi dir="ltr">{money({ amount: addon.price, currencyCode: "KWD" })}</bdi>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {/* Where this one went (3.2.6), when it did not go where
                        the rest of the order went. The seller packs the
                        parcels, so two lines for two doors are two parcels —
                        and a desk that does not say so sends both to one. */}
                    {line.destination ? (
                      <p className="mt-1 text-[12px] font-bold ink-accent" dir="auto">
                        {t("address.lineWent", { label: line.destination.label })}
                        {line.destination.addressLine ? (
                          <span className="ink-muted"> · {line.destination.addressLine}</span>
                        ) : null}
                      </p>
                    ) : null}
                    {line.destination?.pin ? <p className="mt-1"><PinLink pin={line.destination.pin} /></p> : null}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[#e7edf5] px-3 py-1 text-[11px] font-extrabold text-[#0a285a]">
                        {t(FULFILMENT_LABEL[line.fulfilment as FulfilmentState])}
                      </span>
                      {/* The states it may move to, each its own button: a
                          select needs a second press to commit and a seller
                          marking twenty parcels shipped presses forty times. */}
                      {/* Off NetLet's shelf (4.2): NetLet picks and packs it,
                          so the seller is told rather than offered buttons the
                          server would refuse. */}
                      {me.data && me.data.kind !== "customer" && !mayMoveLine(line.centreId ?? null, me.data.kind) ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold ink-muted">
                          <Warehouse className="size-3.5" aria-hidden />{t("fulfilment.netletPacks")}
                        </span>
                      ) : nextStates(line.fulfilment as FulfilmentState).map(state => (
                        <button
                          key={state}
                          type="button"
                          disabled={setFulfilment.isPending}
                          onClick={() => setFulfilment.mutate({ lineId: line.id, fulfilment: state })}
                          className="glass type-control pressable rounded-full px-3 py-1 disabled:opacity-60"
                        >
                          {t(FULFILMENT_LABEL[state])}
                        </button>
                      ))}
                      {line.deliveredAt ? (
                        <span className="text-[11px] ink-muted">
                          <PackageCheck className="me-1 inline size-3.5" aria-hidden />
                          {t("admin.deliveredOn", { date: formatDate(line.deliveredAt) })}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>

              {/* Damage in transit (3.4.2). Here rather than on the claims page
                  because the lines are here, and a seller who hears a box broke
                  is looking at the order, not at a list of claims. */}
              {me.data && can(me.data, "delivery.fileClaim") ? (
                <TransitDamage
                  orderId={orderId}
                  lines={lines.filter(line => line.fulfilment === "shipped" || line.fulfilment === "delivered" || (line.fulfilment === "returned" && line.deliveredAt))}
                />
              ) : null}
            </>
          );
        }}
      </QueryGate>
    </div>
  );
}

/**
 * Report a parcel damaged in transit, as the seller or as NetLet.
 *
 * Only lines that left the shelf are offered — a box still on the seller's
 * own shelf is not a delivery company's to pay for. Everything else (which
 * parcel, which company, how much is the most it can be, whether the window is
 * still open) is the server's, and a refusal names what to fix.
 */
function TransitDamage({ orderId, lines }: { orderId: number; lines: { id: number; productTitle: string; lineTotal: string }[] }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<number[]>([]);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const ceiling = claimCeiling(lines.filter(line => chosen.includes(line.id)));
  const claimsOn = useFeature("damageClaims");

  const file = trpc.dispatch.claims.file.useMutation({
    onSuccess: () => {
      toast.success(t("claims.filed"));
      setOpen(false); setChosen([]); setAmount(""); setDescription(""); setEvidenceUrl("");
      void utils.dispatch.claims.list.invalidate();
    },
    onError: error => toast.error(isMessageKey(error.message) ? t(error.message, { days: String(CLAIM_WINDOW_DAYS) }) : tError(error.message)),
  });

  /* Switched off (2.3): no new claims; open ones are answered on /admin/claims. */
  if (lines.length === 0 || !claimsOn) return null;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pressable mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-extrabold text-[#8c2f22] hover:bg-[#fdeceb]"
      >
        <ShieldAlert className="size-3.5" aria-hidden />{t("claims.reportHeading")}
      </button>
    );
  }

  return (
    <form
      className="mt-4 rounded-xl border border-[#f3d2cc] bg-white p-4"
      onSubmit={event => {
        event.preventDefault();
        file.mutate({ orderId, lineIds: chosen, amount: amount.trim() || ceiling, description, evidenceUrl: evidenceUrl.trim() || null });
      }}
    >
      <h3 className="text-sm font-extrabold text-[#0a285a]">{t("claims.reportHeading")}</h3>
      <p className="mt-1 text-[12px] leading-5 text-[#536b8c]">{t("claims.reportNote")}</p>
      <fieldset className="mt-3">
        <legend className="text-[11px] font-extrabold text-[#536b8c]">{t("claims.whichItems")}</legend>
        {lines.map(line => (
          <label key={line.id} className="mt-1 flex items-center gap-2 text-[13px] text-[#0a285a]">
            <input
              type="checkbox"
              checked={chosen.includes(line.id)}
              onChange={event => setChosen(event.target.checked ? [...chosen, line.id] : chosen.filter(id => id !== line.id))}
              className="size-4 accent-[#0a285a]"
            />
            <span dir="auto" className="min-w-0 flex-1 truncate">{line.productTitle}</span>
            <bdi dir="ltr" className="text-[12px] text-[#536b8c]">{money({ amount: line.lineTotal, currencyCode: "KWD" })}</bdi>
          </label>
        ))}
      </fieldset>
      <label className="mt-3 block">
        <span className="block text-[11px] font-extrabold text-[#536b8c]">{t("claims.amountLabel")}</span>
        <input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" dir="ltr" placeholder={ceiling} className="glass-field mt-1 w-40 rounded-full px-4 py-2 text-sm" />
        <span className="mt-1 block text-[11px] text-[#536b8c]">{t("claims.amountHint", { amount: money({ amount: ceiling, currencyCode: "KWD" }) })}</span>
      </label>
      <label className="mt-3 block">
        <span className="block text-[11px] font-extrabold text-[#536b8c]">{t("claims.descriptionLabel")}</span>
        <textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={MAX_CLAIM_DESCRIPTION} rows={3} dir="auto" required className="glass-field mt-1 w-full rounded-2xl px-4 py-2.5 text-sm" />
      </label>
      <label className="mt-3 block">
        <span className="block text-[11px] font-extrabold text-[#536b8c]">{t("claims.evidenceLabel")}</span>
        <input value={evidenceUrl} onChange={event => setEvidenceUrl(event.target.value)} type="url" dir="ltr" placeholder="https://" className="glass-field mt-1 w-full rounded-full px-4 py-2 text-sm" />
      </label>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" disabled={file.isPending || chosen.length === 0} className="glass-navy type-control pressable rounded-full px-4 py-2 disabled:opacity-60">
          {t("claims.submit")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="glass type-control pressable rounded-full px-4 py-2">
          {t("claims.cancel")}
        </button>
      </div>
    </form>
  );
}

export { FULFILMENT_STATES };
