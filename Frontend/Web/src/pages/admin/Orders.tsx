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
import { buttonClass, EmptyState, fieldClass, isolate, PageHeader, Pill, SkeletonRows, smallButtonClass, textareaClass } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
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
import { Banknote, ChevronDown, PackageCheck, ShieldAlert, Warehouse } from "lucide-react";
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

/* What pressing does, not where the line ends up: a button reading
   "Cancelled" beside a pill reading "Pending" asked a seller to work out which
   one was the state. */
const MOVE_LABEL: Record<FulfilmentState, MessageKey> = {
  pending: "admin.moveToPending",
  preparing: "admin.moveToPreparing",
  shipped: "admin.moveToShipped",
  delivered: "admin.moveToDelivered",
  cancelled: "admin.moveToCancelled",
  returned: "admin.fulfilReturned",
};

const FULFILMENT_TONE: Record<FulfilmentState, "neutral" | "navy" | "good" | "danger" | "warning"> = {
  pending: "warning",
  preparing: "navy",
  shipped: "navy",
  delivered: "good",
  cancelled: "neutral",
  returned: "danger",
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
      <PageHeader title={t("admin.orders")} description={t("admin.ordersNote")} />

      {list.isLoading ? (
        <SkeletonRows label={t("admin.loading")} />
      ) : (
        <QueryGate queries={[list]}>
          {() => {
            const rows = list.data?.rows ?? [];
            if (rows.length === 0) return <EmptyState title={t("admin.ordersEmpty")} />;
            return (
              <>
                <ul className="space-y-2">
                  {rows.map(row => (
                    <li key={row.id}>
                      <OrderRow
                        row={row}
                        risk={riskFor(row.id)}
                        open={open === row.id}
                        onToggle={() => setOpen(open === row.id ? null : row.id)}
                      />
                    </li>
                  ))}
                </ul>
                {list.data ? <Pager page={list.data} onPage={setPage} /> : null}
              </>
            );
          }}
        </QueryGate>
      )}
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
 * `Shared/` has no currency formatter and should not — but a bare "481.500" on
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
    <div className={`overflow-hidden rounded-2xl border bg-white ${open ? "border-[#0a285a]/30" : "border-[#e1e7ef]"}`}>
      {/*
        A disclosure rather than a second page. An order is read in order to do
        something to one of its lines, and a round trip through a detail route
        for a two-line order is three clicks to press one button.
      */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 text-start transition hover:bg-[#0a285a]/[.06] sm:px-5"
      >
        {/* A reference is one unbreakable word; the pills and the total wrap
            under it on a phone rather than squeezing it a letter to a line. */}
        <div className="min-w-[12rem] flex-1">
          <p className="text-[15px] font-bold whitespace-nowrap text-[#0a285a]"><bdi dir="ltr">{row.reference}</bdi></p>
          <p className="mt-0.5 text-[13px] ink-muted">
            {formatDate(row.placedAt)}
            {row.vendorCount > 1 ? <> · {t("admin.orderSellers", { count: row.vendorCount })}</> : null}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone={row.status === "paid" ? "good" : row.status === "pending_payment" ? "warning" : "neutral"}>
            {t(PAYMENT_LABEL[row.status] ?? "admin.orderPendingPayment")}
          </Pill>
          {/* A badge only when there is something to say: "low" on every row is
              an alert that never stops firing, which teaches people to stop
              reading the one that matters. */}
          {risk && risk.risk !== "low" ? (
            <Pill tone={risk.risk === "high" ? "danger" : "warning"}>{t(risk.risk === "high" ? "admin.riskHigh" : "admin.riskWatch")}</Pill>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[15px] font-bold text-[#0a285a]">
          {money({ amount: row.orderTotal, currencyCode: "KWD" })}
          <ChevronDown className={`size-4 text-[#536b8c] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </span>
      </button>

      {/* The evidence, not the verdict: "four accounts have used this address"
          is something an administrator can disagree with, and "risk: high" is
          not. Nothing here has held the order — it is a reason to look. */}
      {open && risk && risk.flags.length > 0 ? (
        <ul className="space-y-1 border-t border-[#eef1f5] bg-[#fffaf0] px-4 py-3 sm:px-5">
          {risk.flags.map(flag => (
            <li key={flag.signal} className={`text-[13px] leading-5 ${flag.serious ? "font-semibold text-[#8c2f22]" : "text-[#5c3f0c]"}`}>
              · {t(SIGNAL_LABEL[flag.signal] ?? "admin.riskWatch", moneyDetail(flag.detail, money))}
            </li>
          ))}
        </ul>
      ) : null}

      {open ? <OrderDetail orderId={row.id} reference={row.reference} /> : null}
    </div>
  );
}

function OrderDetail({ orderId, reference }: { orderId: number; reference: string }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const detail = trpc.orders.forSellerDetail.useQuery({ orderId });
  /* Already in the cache: the shell asked it before drawing the page. */
  const me = trpc.inventory.me.useQuery();
  const utils = trpc.useUtils();
  const [cancelling, setCancelling] = useState<{ lineId: number; title: string } | null>(null);
  const [collecting, setCollecting] = useState(false);

  const refresh = () => {
    void utils.orders.forSellerDetail.invalidate({ orderId });
    void utils.orders.forSeller.invalidate();
  };
  /* The server's refusals are message keys ("the cash is in, refund it
     instead"); they were shown raw, as `orders.alreadySettled`. */
  const setFulfilment = trpc.orders.setFulfilment.useMutation({
    onSuccess: () => { setCancelling(null); toast.success(t("admin.fulfilmentSaved")); refresh(); },
    onError: error => { setCancelling(null); toast.error(tError(error.message)); },
  });
  const markCollected = trpc.orders.markCollected.useMutation({
    /* `recorded: false` is a real answer — somebody else pressed it first, or
       the order was never a cash one — so it is reported rather than shown as
       a success the page cannot back up. */
    onSuccess: reply => {
      setCollecting(false);
      if (reply.recorded) toast.success(t("admin.collectedSaved"));
      else toast.error(t("admin.collectedAlready"));
      refresh();
    },
    onError: error => { setCollecting(false); toast.error(tError(error.message)); },
  });
  const movingLine = setFulfilment.isPending ? setFulfilment.variables?.lineId : undefined;

  return (
    <div className="border-t border-[#eef1f5] px-4 py-4 sm:px-5">
      <QueryGate queries={[detail]}>
        {() => {
          const found = detail.data;
          if (!found) return <p className="text-[14px] text-[#536b8c]">{t("admin.orderGone")}</p>;
          const { order, lines } = found;
          /* An administrator sees every line, so knows when this one is the
             last still coming and the order will close; a seller sees only
             their own, and is told the general rule. */
          const closesOrder = found.scope === "admin" && lines.filter(line => line.fulfilment !== "cancelled").length === 1;

          return (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  {order.subscriptionId ? <div className="mb-2"><Pill tone="navy">{t("subscriptions.repeatOrder")}</Pill></div> : null}
                  <p className="text-[13px] font-semibold text-[#536b8c]">{t("admin.orderDeliverTo")}</p>
                  <p className="mt-1 text-[14px] leading-6 text-[#0a285a]">
                    <span dir="auto" className="font-semibold">{order.contactName ?? t("admin.orderNoName")}</span>
                    <br />
                    <span dir="auto">{order.addressLine ?? t("admin.orderNoAddress")}</span>
                    {order.addressNotes ? <><br /><span dir="auto" className="ink-muted">{order.addressNotes}</span></> : null}
                  </p>
                  <p className="mt-1"><PinLink pin={order.deliveryPin} /></p>
                </div>

                {/* Cash is collected once, for the basket — the one thing on
                    this page that is genuinely about the order rather than a
                    line. Absent unless it applies, rather than disabled. It
                    asks first: it settles the order, issues the invoice and
                    ends cancelling. */}
                {canRecordCollection(order) ? (
                  <button type="button" disabled={markCollected.isPending} onClick={() => setCollecting(true)} className={buttonClass.primary}>
                    <Banknote className="size-4" aria-hidden /> {t("admin.markCollected")}
                  </button>
                ) : null}
              </div>

              <h3 className="mt-5 text-[14px] font-bold text-[#0a285a]">{t("admin.orderLines")}</h3>
              <ul className="mt-2 divide-y divide-[#eef1f5] rounded-xl border border-[#e1e7ef]">
                {lines.map(line => {
                  const state = line.fulfilment as FulfilmentState;
                  const netletPacks = me.data && me.data.kind !== "customer" && !mayMoveLine(line.centreId ?? null, me.data.kind);
                  return (
                    <li key={line.id} className="p-3.5">
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                        <p className="min-w-0 text-[14px] font-semibold text-[#0a285a]">
                          <span dir="auto">{line.productTitle}</span>
                          {line.variantTitle && !isDefaultVariantTitle(line.variantTitle) ? <span dir="auto" className="font-normal ink-muted"> · {line.variantTitle}</span> : null}
                        </p>
                        <p className="text-[14px] font-bold text-[#0a285a]">
                          <bdi dir="ltr">{line.quantity} ×</bdi> {money({ amount: line.unitPrice, currencyCode: "KWD" })}
                        </p>
                      </div>
                      {/* What was bought with it (3.1.2). The seller is who turns
                          up to fit the thing, so this is not decoration. */}
                      {line.addons.length > 0 ? (
                        <ul className="mt-1 space-y-0.5">
                          {line.addons.map(addon => (
                            <li key={addon.id} dir="auto" className="text-[13px] ink-accent">
                              + {addon.label} · {money({ amount: addon.price, currencyCode: "KWD" })}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {/* Where this one went (3.2.6), when it did not go where
                          the rest of the order went. The seller packs the
                          parcels, so two lines for two doors are two parcels —
                          and a desk that does not say so sends both to one. */}
                      {line.destination ? (
                        <p className="mt-1 text-[13px] font-semibold ink-accent" dir="auto">
                          {t("address.lineWent", { label: line.destination.label })}
                          {line.destination.addressLine ? <span className="font-normal ink-muted"> · {line.destination.addressLine}</span> : null}
                        </p>
                      ) : null}
                      {line.destination?.pin ? <p className="mt-1"><PinLink pin={line.destination.pin} /></p> : null}

                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <Pill tone={FULFILMENT_TONE[state] ?? "neutral"}>{t(FULFILMENT_LABEL[state])}</Pill>
                        {line.deliveredAt ? (
                          <span className="inline-flex items-center gap-1 text-[12px] ink-muted">
                            <PackageCheck className="size-3.5" aria-hidden />
                            {t("admin.deliveredOn", { date: formatDate(line.deliveredAt) })}
                          </span>
                        ) : null}
                        <span className="flex-1" />
                        {/* Off NetLet's shelf (4.2): NetLet picks and packs it,
                            so the seller is told rather than offered buttons the
                            server would refuse. */}
                        {netletPacks ? (
                          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold ink-muted">
                            <Warehouse className="size-3.5" aria-hidden />{t("fulfilment.netletPacks")}
                          </span>
                        ) : nextStates(state).filter(next => !(order.status === "cancelled" && state === "cancelled")).map(next => (
                          /* The states it may move to, each its own button: a
                             select needs a second press to commit and a seller
                             marking twenty parcels shipped presses forty times.
                             Cancelling asks first: it hands units back and
                             changes what the driver collects. */
                          <button
                            key={next}
                            type="button"
                            disabled={movingLine === line.id}
                            onClick={() => next === "cancelled"
                              ? setCancelling({ lineId: line.id, title: line.productTitle })
                              : setFulfilment.mutate({ lineId: line.id, fulfilment: next })}
                            className={next === "cancelled" ? smallButtonClass.quietDanger : smallButtonClass.secondary}
                          >
                            {t(next === "pending" && state === "cancelled" ? "admin.moveToRestore" : MOVE_LABEL[next])}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
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

              <ConfirmDialog
                open={cancelling !== null}
                title={t("admin.cancelLineTitle", { product: isolate(cancelling?.title ?? "") })}
                body={t(closesOrder ? "admin.cancelLastLineBody" : "admin.cancelLineBody")}
                confirmLabel={t("admin.moveToCancelled")}
                cancelLabel={t("admin.keepLine")}
                tone="danger"
                pending={setFulfilment.isPending}
                onConfirm={() => cancelling && setFulfilment.mutate({ lineId: cancelling.lineId, fulfilment: "cancelled" })}
                onClose={() => setCancelling(null)}
              />
              <ConfirmDialog
                open={collecting}
                title={t("admin.collectedTitle", { reference })}
                body={t("admin.collectedBody")}
                confirmLabel={t("admin.markCollected")}
                icon={<Banknote className="size-5" aria-hidden />}
                pending={markCollected.isPending}
                onConfirm={() => markCollected.mutate({ orderId })}
                onClose={() => setCollecting(false)}
              />
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
      <button type="button" onClick={() => setOpen(true)} className={`${smallButtonClass.quietDanger} mt-4`}>
        <ShieldAlert className="size-4" aria-hidden />{t("claims.reportHeading")}
      </button>
    );
  }

  return (
    <form
      className="mt-4 rounded-xl border border-[#efc6bd] bg-white p-4"
      onSubmit={event => {
        event.preventDefault();
        file.mutate({ orderId, lineIds: chosen, amount: amount.trim() || ceiling, description, evidenceUrl: evidenceUrl.trim() || null });
      }}
    >
      <h3 className="text-[14px] font-bold text-[#0a285a]">{t("claims.reportHeading")}</h3>
      <p className="mt-1 text-[13px] leading-5 text-[#536b8c]">{t("claims.reportNote")}</p>
      <fieldset className="mt-3">
        <legend className="text-[13px] font-semibold text-[#0a285a]">{t("claims.whichItems")}</legend>
        {lines.map(line => (
          <label key={line.id} className="mt-1.5 flex items-center gap-2 text-[14px] text-[#0a285a]">
            <input
              type="checkbox"
              checked={chosen.includes(line.id)}
              onChange={event => setChosen(event.target.checked ? [...chosen, line.id] : chosen.filter(id => id !== line.id))}
              className="size-4 accent-[#0a285a]"
            />
            <span dir="auto" className="min-w-0 flex-1 truncate">{line.productTitle}</span>
            <span className="text-[13px] text-[#536b8c]">{money({ amount: line.lineTotal, currencyCode: "KWD" })}</span>
          </label>
        ))}
      </fieldset>
      <div className="mt-3 grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <div>
          <label htmlFor={`claim-amount-${orderId}`} className="block text-[13px] font-semibold text-[#0a285a]">{t("claims.amountLabel")}</label>
          <input id={`claim-amount-${orderId}`} aria-describedby={`claim-amount-${orderId}-hint`} value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" dir="ltr" placeholder={ceiling} className={`${fieldClass} mt-1.5`} />
          <p id={`claim-amount-${orderId}-hint`} className="mt-1 text-[12px] ink-muted">{t("claims.amountHint", { amount: money({ amount: ceiling, currencyCode: "KWD" }) })}</p>
        </div>
        <div>
          <label htmlFor={`claim-evidence-${orderId}`} className="block text-[13px] font-semibold text-[#0a285a]">{t("claims.evidenceLabel")}</label>
          <input id={`claim-evidence-${orderId}`} value={evidenceUrl} onChange={event => setEvidenceUrl(event.target.value)} type="url" dir="ltr" placeholder="https://" className={`${fieldClass} mt-1.5`} />
        </div>
      </div>
      <label htmlFor={`claim-description-${orderId}`} className="mt-3 block text-[13px] font-semibold text-[#0a285a]">{t("claims.descriptionLabel")}</label>
      <textarea id={`claim-description-${orderId}`} value={description} onChange={event => setDescription(event.target.value)} maxLength={MAX_CLAIM_DESCRIPTION} rows={3} dir="auto" required className={`${textareaClass} mt-1.5`} />
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className={smallButtonClass.secondary}>{t("claims.cancel")}</button>
        <button type="submit" disabled={file.isPending || chosen.length === 0 || !description.trim()} className={smallButtonClass.primary}>{t("claims.submit")}</button>
      </div>
    </form>
  );
}

export { FULFILMENT_STATES };
