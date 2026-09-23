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
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { canRecordCollection } from "@shared/commerce/payment";
import { FULFILMENT_STATES, nextStates, type FulfilmentState } from "@shared/commerce/fulfilment";
import { isDefaultVariantTitle } from "@shared/commerce/fromInventory";
import type { MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";
import { Banknote, PackageCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
  return <AdminShell need="product.view">{() => <Orders />}</AdminShell>;
}

function Orders() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const list = trpc.orders.forSeller.useQuery({ page }, { placeholderData: previous => previous });

  return (
    <>
      <h1 className="text-xl font-extrabold">{t("admin.orders")}</h1>
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

function OrderRow({ row, open, onToggle }: { row: Row; open: boolean; onToggle: () => void }) {
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
        <span className="shrink-0 font-extrabold text-[#0a285a]"><bdi dir="ltr">{money({ amount: row.orderTotal, currencyCode: "KWD" })}</bdi></span>
      </button>

      {open ? <OrderDetail orderId={row.id} /> : null}
    </div>
  );
}

function OrderDetail({ orderId }: { orderId: number }) {
  const { t } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const detail = trpc.orders.forSellerDetail.useQuery({ orderId });
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
                  <p className="text-[11px] font-extrabold tracking-[.06em] ink-muted uppercase">{t("admin.orderDeliverTo")}</p>
                  <p className="mt-1 text-[13px] leading-6 text-[#0a285a]">
                    <span dir="auto">{order.contactName ?? t("admin.orderNoName")}</span>
                    <br />
                    <span dir="auto">{order.addressLine ?? t("admin.orderNoAddress")}</span>
                    {order.addressNotes ? <><br /><span dir="auto" className="ink-muted">{order.addressNotes}</span></> : null}
                  </p>
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
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[#e7edf5] px-3 py-1 text-[11px] font-extrabold text-[#0a285a]">
                        {t(FULFILMENT_LABEL[line.fulfilment as FulfilmentState])}
                      </span>
                      {/* The states it may move to, each its own button: a
                          select needs a second press to commit and a seller
                          marking twenty parcels shipped presses forty times. */}
                      {nextStates(line.fulfilment as FulfilmentState).map(state => (
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
            </>
          );
        }}
      </QueryGate>
    </div>
  );
}

export { FULFILMENT_STATES };
