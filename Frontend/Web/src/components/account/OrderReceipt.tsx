/**
 * "Download receipt (PDF)" on an opened order, on the owner's word: every
 * detail of the order — its number, when it was placed, where it is, how it
 * is paid, where it goes, each item with its store, quantity, price and code,
 * the till's sum and what is still to pay — as a receipt in the page's
 * language. The words are made here from the order as `orders.get` answers
 * it and the shared rule (`Shared/commerce/orderReceipt.ts`), and
 * `lib/orderReceiptPdf.ts` draws them; the app's `OrderReceipt.swift` makes
 * the same receipt from the same rule.
 */
import { useState } from "react";
import { toast } from "sonner";
import { FileDown, LoaderCircle } from "lucide-react";
import { orderProgress } from "@shared/commerce/orderProgress";
import { receiptFileName, receiptMethod, receiptPayment, receiptRows, type ReceiptMethod, type ReceiptRowKind } from "@shared/commerce/orderReceipt";
import type { MessageKey } from "@shared/i18n/dictionary";
import { rateLabel } from "@shared/commerce/tax";
import { kuwaitDeliveryZones } from "@shared/customer";
import type { FulfilmentState } from "@shared/commerce/fulfilment";
import { useTranslation } from "@/hooks/useTranslation";
import { useDateTimeFormat } from "@/hooks/useDateFormat";
import { formatMoney } from "@/lib/format";
import type { Detail } from "@/components/account/LineReturn";
import { useProgressPhrase } from "@/components/account/OrderJourney";
import type { ReceiptDocument } from "@/lib/orderReceiptPdf";

const ROW_WORDS: Record<ReceiptRowKind, MessageKey> = {
  subtotal: "receipt.subtotal",
  delivery: "receipt.delivery",
  tax: "receipt.tax",
  discount: "receipt.discount",
  points: "receipt.points",
  giftCard: "receipt.giftCard",
  total: "receipt.total",
};

const METHOD_WORDS: Record<ReceiptMethod, MessageKey> = {
  cod: "receipt.methodCod",
  knet: "receipt.methodKnet",
  card: "receipt.methodCard",
  applePay: "receipt.methodApplePay",
};

/** Makes the receipt for an order and downloads it; `making` while it does. */
export function useOrderReceipt() {
  const { t, locale, isArabic } = useTranslation();
  const dateTime = useDateTimeFormat();
  const phrase = useProgressPhrase();
  const [making, setMaking] = useState(false);

  const documentFor = (detail: Detail): ReceiptDocument => {
    const order = detail.order;
    const money = (value: string) => formatMoney(value, { currencyCode: order.currency, locale });
    const progress = orderProgress(order, detail.lines.map(line => ({ fulfilment: line.fulfilment as FulfilmentState, deliveredAt: line.deliveredAt, preordered: line.preordered })));
    const zone = kuwaitDeliveryZones.find(entry => entry.id === order.deliveryZoneId);
    const deliverTo = [
      [order.contactName, order.contactPhone].filter(Boolean).join(" · "),
      order.addressLine ?? "",
      zone ? (isArabic ? zone.labelAr : zone.label) : "",
      order.addressNotes ?? "",
    ].filter(Boolean);

    const items = detail.lines.map(line => {
      const cancelled = line.fulfilment === "cancelled";
      const returned = line.fulfilment === "returned";
      const coded = line.discountCode && Number(line.discountAmount) > 0;
      return {
        title: line.productTitle,
        lines: [
          line.variantTitle && line.variantTitle !== "Default" ? line.variantTitle : "",
          line.vendorName ? t("receipt.soldBy", { store: line.vendorName }) : "",
          t("orders.quantityAndPrice", { quantity: String(line.quantity), price: money(line.unitPrice) }),
        ].filter(Boolean),
        amount: money(line.lineTotal),
        note: cancelled ? t("receipt.lineCancelled")
          : returned ? t("receipt.lineReturned")
          : coded ? t("orders.lineCode", { code: line.discountCode ?? "", amount: money(line.discountAmount) })
          : undefined,
        noteTone: cancelled || returned ? ("warning" as const) : ("saving" as const),
        muted: cancelled,
      };
    });

    const sums = receiptRows(
      {
        status: order.status,
        paymentMethod: order.paymentMethod,
        itemsTotal: order.itemsTotal,
        deliveryTotal: order.deliveryTotal,
        grandTotal: order.grandTotal,
        discountCode: order.discountCode,
        discountValue: order.discountValue,
        pointsSpent: order.pointsSpent,
        pointsValue: order.pointsValue,
        giftCardCode: order.giftCardCode,
        giftCardValue: order.giftCardValue,
      },
      detail.tax,
    ).map(row => ({
      label: t(ROW_WORDS[row.kind], row.kind === "tax" ? { rate: rateLabel(row.params?.rate ?? "0") } : row.params ?? {}),
      amount: row.free ? t("receipt.free") : `${row.minus ? "−" : ""}${money(row.amount)}`,
      strong: row.strong,
    }));

    const payment = receiptPayment(order, detail.owedNow);
    const due = (() => {
      switch (payment.kind) {
        case "paid": return { label: t("receipt.paid"), amount: money(order.grandTotal) };
        case "paidOnline": return { label: t("receipt.paidOnline"), amount: money(order.grandTotal) };
        case "refunded": return { label: t("receipt.refunded"), amount: money(order.grandTotal) };
        case "cancelled": return { label: t("receipt.cancelled"), amount: money("0.000") };
        case "nothingDue": return { label: t("receipt.nothingDue"), amount: money("0.000") };
        case "onDelivery": return { label: t("receipt.toPay"), amount: money(payment.amount), note: payment.reduced ? t("receipt.reduced") : undefined };
      }
    })();

    return {
      rtl: isArabic,
      docTitle: t("receipt.docTitle", { reference: order.reference }),
      title: t("receipt.title"),
      reference: order.reference,
      facts: [
        { label: t("receipt.placed"), lines: [dateTime(order.placedAt)] },
        { label: t("receipt.status"), lines: [phrase(progress)] },
        { label: t("receipt.payment"), lines: [t(METHOD_WORDS[receiptMethod(order.paymentMethod)])] },
        { label: t("receipt.deliverTo"), lines: deliverTo.length ? deliverTo : ["—"] },
      ],
      itemsHeading: t("receipt.items", { count: detail.lines.length }),
      items,
      sums,
      due,
      footer: [t("receipt.thanks"), t("receipt.generated", { date: dateTime(new Date()) }), window.location.host],
      fileName: receiptFileName(order.reference),
    };
  };

  const download = async (detail: Detail) => {
    if (making) return;
    setMaking(true);
    try {
      const { downloadReceipt } = await import("@/lib/orderReceiptPdf");
      await downloadReceipt(documentFor(detail));
    } catch {
      toast.error(t("receipt.failed"));
    } finally {
      setMaking(false);
    }
  };

  return { making, download };
}

/**
 * The receipt's button at the top of an opened order, on the owner's word
 * ("move the download pdf option from the bottom of the order page to
 * here", a picture with "pdf" beside the order's title): "PDF" with a
 * document's download mark, named "Download receipt (PDF)", which holds the
 * word drawn (WCAG 2.5.3). It was a pill in the card at the order's foot.
 */
export function ReceiptButton({ detail }: { detail: Detail }) {
  const { t } = useTranslation();
  const receipt = useOrderReceipt();
  return (
    <button
      type="button"
      onClick={() => void receipt.download(detail)}
      disabled={receipt.making}
      aria-busy={receipt.making}
      aria-label={receipt.making ? t("receipt.making") : t("receipt.download")}
      title={t("receipt.download")}
      className="glass type-control pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 disabled:opacity-70 pointer-fine:min-h-9"
    >
      {receipt.making ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <FileDown className="size-4" aria-hidden />}
      <span aria-hidden>{t("receipt.pdf")}</span>
    </button>
  );
}
