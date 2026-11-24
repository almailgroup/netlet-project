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
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, LoaderCircle } from "lucide-react";
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

  /** Makes and downloads it; true once the file is handed to the browser. */
  const download = async (detail: Detail): Promise<boolean> => {
    if (making) return false;
    setMaking(true);
    try {
      const { downloadReceipt } = await import("@/lib/orderReceiptPdf");
      await downloadReceipt(documentFor(detail));
      return true;
    } catch {
      toast.error(t("receipt.failed"));
      return false;
    } finally {
      setMaking(false);
    }
  };

  return { making, download };
}

/** How long "Downloaded" stays on the button after the file is handed over. */
const DONE_MS = 2600;

/**
 * The receipt's button at the top of an opened order, on the owner's word
 * ("move the download pdf option from the bottom of the order page to
 * here", a picture with "pdf" beside the order's title). **Enhanced on the
 * owner's word** ("just enhance the pdf option"): a PDF file drawn for NetLet
 * — a page with its corner folded and a red "PDF" tag, the app's same drawing
 * (`PdfFileMark`) — beside "Receipt", where it was a download arrow and the
 * letters "PDF"; "Preparing…" with a turning ring while it is made, then a
 * green tick and "Downloaded" for a moment, said to a screen reader too. Its
 * name is "Download receipt (PDF)", which holds the word drawn (WCAG 2.5.3).
 */
export function ReceiptButton({ detail }: { detail: Detail }) {
  const { t } = useTranslation();
  const receipt = useOrderReceipt();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(false), DONE_MS);
    return () => window.clearTimeout(timer);
  }, [done]);
  const press = async () => {
    setDone(false);
    if (await receipt.download(detail)) setDone(true);
  };
  const state = receipt.making ? "making" : done ? "done" : "idle";
  const faces = [
    { state: "idle", word: t("receipt.button"), icon: <PdfFileMark label={t("receipt.pdf")} /> },
    { state: "making", word: t("receipt.preparing"), icon: <LoaderCircle className="size-[18px] animate-spin text-[#0a285a]" /> },
    {
      state: "done",
      word: t("receipt.downloaded"),
      icon: (
        <span className="receipt-done grid size-[22px] place-items-center rounded-full bg-[#2f7d3a] text-white">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      ),
    },
  ];
  return (
    <>
      <button
        type="button"
        onClick={() => void press()}
        disabled={receipt.making}
        aria-busy={receipt.making}
        aria-label={receipt.making ? t("receipt.making") : t("receipt.download")}
        title={t("receipt.download")}
        data-state={state}
        className={`receipt-button type-control pressable inline-grid min-h-11 shrink-0 items-center rounded-full border ps-2.5 pe-3.5 py-1 disabled:cursor-progress pointer-fine:min-h-9 ${
          done ? "border-[#bfe0c6] bg-[#f1f8f2] text-[#24452a]" : "border-[#e2e7ef] bg-white text-[#0a285a] hover:bg-[#f0f2f5]"
        }`}
      >
        {/* The three faces share one cell, so the button is always as wide as
            the widest and each face sits in its middle: "Downloaded" is longer
            than "Receipt", and a button that grew on the press moved itself
            and, on a narrow row, wrapped the row under the heading. Only the
            face shown draws its picture, so the tick's pop plays as it
            appears and no hidden spinner turns. */}
        {faces.map(face => {
          const shown = face.state === state;
          return (
            <span
              key={face.state}
              aria-hidden
              data-shown={shown ? "" : undefined}
              className={`col-start-1 row-start-1 inline-flex items-center justify-center gap-2 whitespace-nowrap ${shown ? "" : "invisible"}`}
            >
              <span className="grid h-[26px] w-[22px] place-items-center">{shown ? face.icon : null}</span>
              <span data-word>{face.word}</span>
            </span>
          );
        })}
      </button>
      <span role="status" className="sr-only">{done ? t("receipt.downloaded") : ""}</span>
    </>
  );
}

/**
 * A PDF file, drawn for NetLet in a 22 × 26 box: a white page with a navy
 * rim and its top corner folded, two lines of text, and a red tag across its
 * foot reading "PDF" — the Deals bag's red (`#d6201f`), white on it 5.1:1.
 * The tag reaches past the page at the start, as a file's label does; it is
 * a picture of a file, so it is drawn the same way round in Arabic.
 */
export function PdfFileMark({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 22 26" width="22" height="26" fill="none" className="receipt-file" style={{ direction: "ltr" }}>
      <path d="M5 1.5h8.6L19.5 7.4V23a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 23V3A1.5 1.5 0 0 1 5 1.5Z" fill="#fff" stroke="#0a285a" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M13.6 1.5V6a1.4 1.4 0 0 0 1.4 1.4h4.5" stroke="#0a285a" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7 10h7M7 13h9" stroke="#9fb0c8" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="0.75" y="15.5" width="16.5" height="7.5" rx="1.6" fill="#d6201f" />
      <text x="9" y="21.35" textAnchor="middle" fontSize="5.6" fontWeight="800" fill="#fff" fontFamily="Inter, system-ui, sans-serif" letterSpacing="0.3">{label}</text>
    </svg>
  );
}
