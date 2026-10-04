/**
 * Orders and returns, on the shopper's own account page.
 *
 * One section rather than two, because a return is something you do *to* an
 * order — not a separate pile of things. Splitting them means finding the same
 * order twice, once to look at it and once to send it back, and a "Returns"
 * tab that is empty for everybody who has never returned anything is a tab
 * that teaches people not to look.
 *
 * Three states, never two. `QueryGate` is the same gate the admin portal uses
 * and for the same reason: a refused or broken query rendering as "no orders
 * yet" is the worst of the three answers, because it reads as working and
 * quietly tells somebody their purchase history is gone.
 *
 * **What a return is allowed to be is not decided here.** `returnStateFor` is
 * pure and shared, the server resolves it with the server's own clock, and
 * this file only draws the answer. The page cannot offer a return the API
 * would refuse, which is the same arrangement as the password floor.
 */
import { QueryGate } from "@/components/admin/QueryGate";
import { Pager } from "@/components/admin/Pager";
import { Thumb } from "@/components/product/Thumb";
import { ParcelCare } from "@/components/account/ParcelCare";
import { LineReturn } from "@/components/account/LineReturn";
import { useFeature } from "@/hooks/useFeature";
import { formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { useDateFormat } from "@/hooks/useDateFormat";
import { RETURN_WINDOW_DAYS } from "@shared/commerce/returns";
import type { MessageKey } from "@shared/i18n/dictionary";
import { ChevronDown, FileText, PackageSearch, RotateCcw } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import { TrackParcels } from "@/components/account/TrackParcels";

/**
 * The words for each state, and its colour.
 *
 * Text first and colour second — never colour alone. A row of coloured dots
 * tells somebody with any degree of colour blindness nothing at all, and tells
 * a screen reader less than that. Every pill below carries its own label.
 */
const PAYMENT: Record<string, { label: MessageKey; className: string }> = {
  pending_payment: { label: "orders.statusPendingPayment", className: "bg-[#fff0ab] text-[#705523]" },
  paid: { label: "orders.statusPaid", className: "bg-[#d8ead8] text-[#2f5d33]" },
  cancelled: { label: "orders.statusCancelled", className: "bg-[#e7edf5] text-[#536b8c]" },
  refunded: { label: "orders.statusRefunded", className: "bg-[#e7edf5] text-[#536b8c]" },
};

const FULFILMENT: Record<string, { label: MessageKey; className: string }> = {
  pending: { label: "orders.linePending", className: "bg-[#e7edf5] text-[#536b8c]" },
  preparing: { label: "orders.linePreparing", className: "bg-[#fff0ab] text-[#705523]" },
  shipped: { label: "orders.lineShipped", className: "bg-[#dbe7fb] text-[#274b86]" },
  delivered: { label: "orders.lineDelivered", className: "bg-[#d8ead8] text-[#2f5d33]" },
  cancelled: { label: "orders.lineCancelled", className: "bg-[#fdeceb] text-[#8c2f22]" },
  returned: { label: "orders.lineReturned", className: "bg-[#e7edf5] text-[#536b8c]" },
};

function Pill({ label, className }: { label: string; className: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold ${className}`}>{label}</span>;
}

export function AccountOrders() {
  const { t, locale } = useTranslation();
  const [page, setPage] = useState(1);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const formatDate = useDateFormat();

  const list = trpc.orders.list.useQuery({ page });

  return (
    <QueryGate queries={[list]}>
      {() => {
        const data = list.data;
        if (!data || data.total === 0) return <EmptyOrders />;

        return (
          <>
            {/*
              A real list, so assistive tech announces "list, 3 items" before
              reading them. A stack of <article>s in a <div> is three unrelated
              things that happen to be near each other.
            */}
            <ul className="space-y-3">
              {data.rows.map(order => {
                const payment = PAYMENT[order.status] ?? PAYMENT.pending_payment;
                const open = openRef === order.reference;
                return (
                  <li key={order.id} className="rounded-[1.35rem] border border-[#d5dfeb] bg-white">
                    <h3 className="sr-only">
                      {t("orders.orderHeading", { reference: order.reference })}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setOpenRef(open ? null : order.reference)}
                      aria-expanded={open}
                      aria-controls={`order-${order.id}-lines`}
                      className="pressable flex w-full items-start justify-between gap-4 rounded-[1.35rem] p-5 text-start"
                    >
                      <span className="min-w-0">
                        <span className="type-label block ink-muted">{t("orders.reference")}</span>
                        {/*
                          The reference is Latin on an Arabic page — NL-20260915-QRTVW
                          reads left to right while the line it sits on does not. `bdi`
                          isolates the run without throwing the whole line to the far
                          edge, which is what `dir` on the block would do and what
                          `markup.test.ts` refuses.
                        */}
                        <span className="type-product mt-0.5 block text-base text-[#0a285a]">
                          <bdi dir="ltr">{order.reference}</bdi>
                        </span>
                        <span className="mt-1 block text-xs ink-muted">{formatDate(order.placedAt)}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="flex flex-col items-end gap-2">
                          <Pill label={t(payment.label)} className={payment.className} />
                          {/* What it owes now — the figure the driver asks for — and
                              a plain sentence when that differs from what was placed.
                              Not a strikethrough: that is how this shop advertises a
                              permitted saving, and a cancelled sofa is not one. */}
                          <span className="text-sm font-extrabold text-[#0a285a]">
                            {formatMoney(order.owed?.owed ?? order.grandTotal, { currencyCode: order.currency, locale })}
                          </span>
                          {order.owed?.reduced ? (
                            <span className="text-[11px] font-semibold ink-muted">{t("orders.cancelledNotCharged")}</span>
                          ) : null}
                        </span>
                        <ChevronDown className={`size-5 shrink-0 ink-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                      </span>
                    </button>

                    <div id={`order-${order.id}-lines`} hidden={!open} className="border-t border-[#e7edf5] px-5 py-4">
                      {open ? <OrderLines reference={order.reference} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            <Pager page={data} onPage={setPage} />
          </>
        );
      }}
    </QueryGate>
  );
}

/**
 * The lines of one order, fetched only when it is opened.
 *
 * Per order rather than with the list, because the return state is computed
 * per line against the server's clock and a list of fifty orders would resolve
 * fifty windows nobody has asked to see.
 */
function OrderLines({ reference }: { reference: string }) {
  const { t, locale } = useTranslation();
  const returnsOn = useFeature("returns");
  const detail = trpc.orders.get.useQuery({ reference });
  const formatDate = useDateFormat();

  return (
    <QueryGate queries={[detail]}>
      {() => {
        const data = detail.data;
        if (!data) return <p className="text-sm ink-muted">{t("orders.detailMissing")}</p>;

        return (
          <>
          <ul className="space-y-4">
            {data.lines.map(line => {
              const fulfilment = FULFILMENT[line.fulfilment] ?? FULFILMENT.pending;
              return (
                <li key={line.id} className="flex gap-3">
                  <Thumb src={null} alt="" className="size-14 shrink-0 rounded-xl" icon={<PackageSearch className="size-5" />} />
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="type-product truncate text-sm text-[#0a285a]">{line.productTitle}</p>
                    {line.variantTitle ? <p dir="auto" className="truncate text-xs ink-muted">{line.variantTitle}</p> : null}
                    {/* Where this one went (3.2.6), when it did not go where
                        the rest of the order went — read off the line's own
                        frozen copy, so it still says so after the address has
                        been edited or deleted. */}
                    {line.destination ? <p dir="auto" className="truncate text-xs ink-accent">{t("address.lineWent", { label: line.destination.label })}</p> : null}
                    <p className="mt-1 text-xs ink-muted">
                      {t("orders.quantityAndPrice", {
                        quantity: String(line.quantity),
                        price: formatMoney(line.unitPrice, { currencyCode: data.order.currency, locale }),
                      })}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Pill label={t(fulfilment.label)} className={fulfilment.className} />
                      {/*
                        The return affordance draws only where a return is
                        actually open. Everywhere else it says why, which is the
                        useful half: "delivered 20 days ago" and "not paid for"
                        are different problems and a greyed-out button is
                        neither of them.
                      */}
                      {line.returnState.returnable ? (
                        <span className="inline-flex items-start gap-1.5 text-[11px] font-extrabold text-[#2f5d33]">
                          <RotateCcw className="mt-px size-3.5 shrink-0 rtl:-scale-x-100" aria-hidden />
                          {t("returns.openUntil", {
                            date: formatDate(line.returnState.closesAt),
                            days: String(line.returnState.daysLeft),
                          })}
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold ink-muted">{t(line.returnState.reason)}</span>
                      )}
                    </div>
                    <LineReturn reference={reference} currency={data.order.currency} line={line} requests={data.returns} />
                  </div>
                </li>
              );
            })}

            {/* How a return works, said once at the foot. Each line carries its
                own button where a return is open; this is the policy behind it. */}
            <li className="rounded-xl bg-[#e7edf5] p-4">
              <p className="text-xs leading-5 ink-muted">{t(returnsOn ? "returns.howTo" : "returns.howToPaused", { days: String(data.windowDays) })}</p>
            </li>
          </ul>
          {/* The invoice and any credit notes (3.6.6), once the money has
              been collected — the moment the sale completes. */}
          {data.documents.length > 0 ? (
            <section aria-labelledby={`docs-${reference}`} className="mt-5 border-t border-[#e7edf5] pt-4">
              <h4 id={`docs-${reference}`} className="type-label ink-muted">{t("invoice.documents")}</h4>
              <ul className="mt-2 flex flex-wrap gap-2">
                {data.documents.map(document => (
                  <li key={document.number}>
                    <Link href={`/invoices/${document.number}`} className="glass type-control pressable inline-flex items-center gap-1.5 rounded-full px-3 py-1.5">
                      <FileText className="size-3.5" aria-hidden />
                      {t(document.kind === "credit_note" ? "invoice.creditNoteNumber" : "invoice.invoiceNumber", { number: document.number })}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {/* Live tracking (3.4.3), while anything is on the road. */}
          {data.lines.some(line => line.fulfilment === "shipped") ? <TrackParcels reference={reference} /> : null}
          <ParcelCare reference={reference} currency={data.order.currency} parcels={data.parcels} />
          </>
        );
      }}
    </QueryGate>
  );
}

/**
 * No orders.
 *
 * It names the reason rather than leaving a blank panel to imply the history
 * failed to load or that NetLet forgot them. Nothing can be bought yet —
 * payments are the next phase — and saying so is the same honesty the
 * order-tracking card and the search panels already carry.
 */
function EmptyOrders() {
  const { t } = useTranslation();
  return (
    <div className="rounded-[1.35rem] border border-[#d5dfeb] bg-white p-6 sm:p-8">
      <span className="grid size-12 place-items-center rounded-2xl bg-[#e7edf5] text-[#0a285a]">
        <PackageSearch className="size-6" />
      </span>
      <h3 className="type-product mt-4 text-lg text-[#0a285a]">{t("orders.emptyTitle")}</h3>
      <p className="mt-2 max-w-prose text-sm leading-6 ink-muted">{t("orders.emptyBody")}</p>
      <p className="mt-4 max-w-prose text-xs leading-5 ink-muted">{t("returns.emptyNote", { days: String(RETURN_WINDOW_DAYS) })}</p>
    </div>
  );
}
