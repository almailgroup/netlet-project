/**
 * Two things My orders draws about an order, on the owner's word ("for the
 * products shown in the orders page, a design for their status of delivery
 * below them … and an export to PDF option that shows all the details of
 * your order in the form of a receipt"): where each item is on its way to the
 * door (drawn under its photo in the opened order, on the owner's word), and
 * what it came to, line by line.
 *
 * Pure and shared, so the website's item status and receipt and the app's
 * (`ItemStatusTile`, `ReceiptRules` in Swift, tested on these cases)
 * cannot say different things. Nothing here is computed afresh: every figure
 * is the one the order froze.
 */
import { compareMoney, isZeroMoney, toFils } from "../money.js";
import { isOnlineMethod } from "./onlinePayment.js";
import type { OrderProgress } from "./orderProgress.js";

/**
 * The journey's stage: a box being got ready, a van on the road, the house
 * reached — or an order that left the road, which draws no road at all.
 * An order part-delivered is still on the way, since something in it is.
 */
export type JourneyStage = "processing" | "onTheWay" | "delivered" | "cancelled" | "returned";

export function journeyStage(progress: Pick<OrderProgress, "kind">): JourneyStage {
  switch (progress.kind) {
    case "received":
    case "preparing":
      return "processing";
    case "onTheWay":
    case "partlyDelivered":
      return "onTheWay";
    case "delivered":
      return "delivered";
    case "cancelled":
      return "cancelled";
    case "returned":
      return "returned";
  }
}

/** The order's figures as it froze them (`orders` columns). */
export type ReceiptOrder = {
  status: string;
  paymentMethod: string | null;
  itemsTotal: string;
  deliveryTotal: string;
  grandTotal: string;
  discountCode: string | null;
  discountValue: string;
  pointsSpent: number;
  pointsValue: string;
  giftCardCode: string | null;
  giftCardValue: string;
};

/**
 * What a line of the sum is. A kind rather than a message key, so the words
 * stay with the pages that draw a receipt and out of the first download.
 */
export type ReceiptRowKind = "subtotal" | "delivery" | "tax" | "discount" | "points" | "giftCard" | "total";

/** One line of the receipt's sum: what it is, its figure, and how it is drawn. */
export type ReceiptRow = {
  kind: ReceiptRowKind;
  amount: string;
  /** A reduction, drawn with a minus before it. */
  minus?: true;
  /** Delivery that cost nothing, drawn as the word for free. */
  free?: true;
  /** The order's total, drawn larger. */
  strong?: true;
  params?: Record<string, string>;
};

/**
 * A gift card's code is a bearer value — whoever reads it can spend what is
 * left on the card — and a receipt is a file that gets forwarded. Only its
 * last four characters are printed.
 */
export function maskedCardCode(code: string): string {
  const clean = code.trim();
  return clean.length <= 4 ? clean : `•••• ${clean.slice(-4)}`;
}

/**
 * The sum, in the till's own order (`settle`): the goods, delivery and tax,
 * then the order's code, the points and the gift card, then the total. A
 * reduction that took nothing is not printed; delivery is, as free.
 */
export function receiptRows(order: ReceiptOrder, tax: { amount: string; rate: string } | null): ReceiptRow[] {
  const rows: ReceiptRow[] = [{ kind: "subtotal", amount: order.itemsTotal }];
  rows.push(isZeroMoney(order.deliveryTotal) ? { kind: "delivery", amount: order.deliveryTotal, free: true } : { kind: "delivery", amount: order.deliveryTotal });
  if (tax && toFils(tax.amount) > 0n) rows.push({ kind: "tax", amount: tax.amount, params: { rate: tax.rate } });
  if (toFils(order.discountValue) > 0n) rows.push({ kind: "discount", amount: order.discountValue, minus: true, params: { code: order.discountCode ?? "" } });
  if (toFils(order.pointsValue) > 0n) rows.push({ kind: "points", amount: order.pointsValue, minus: true, params: { points: String(order.pointsSpent) } });
  if (toFils(order.giftCardValue) > 0n) rows.push({ kind: "giftCard", amount: order.giftCardValue, minus: true, params: { code: order.giftCardCode ? maskedCardCode(order.giftCardCode) : "" } });
  rows.push({ kind: "total", amount: order.grandTotal, strong: true });
  return rows;
}

/**
 * How it stands with the money, the row's own rule (`OrderTotal`): paid,
 * paid online instead, refunded, cancelled, or what is still to pay at the
 * door — which is less than the total once something in it was cancelled.
 */
export type ReceiptPayment =
  | { kind: "paid" }
  | { kind: "paidOnline" }
  | { kind: "refunded" }
  | { kind: "cancelled" }
  | { kind: "onDelivery"; amount: string; reduced: boolean }
  | { kind: "nothingDue" };

export function receiptPayment(order: Pick<ReceiptOrder, "status" | "paymentMethod" | "grandTotal">, owedNow: string): ReceiptPayment {
  if (order.status === "paid") return { kind: "paid" };
  if (order.status === "refunded") return { kind: "refunded" };
  if (order.status === "cancelled") return { kind: "cancelled" };
  if (isOnlineMethod(order.paymentMethod)) return { kind: "paidOnline" };
  if (toFils(owedNow) <= 0n) return { kind: "nothingDue" };
  return { kind: "onDelivery", amount: owedNow, reduced: compareMoney(owedNow, order.grandTotal) < 0 };
}

/** How it was paid: cash on delivery unless an online way was chosen. */
export type ReceiptMethod = "cod" | "knet" | "card" | "applePay";

export function receiptMethod(paymentMethod: string | null): ReceiptMethod {
  switch (paymentMethod) {
    case "knet": return "knet";
    case "card": return "card";
    case "apple_pay": return "applePay";
    default: return "cod";
  }
}

/** The file's name: the shop and the order, so a folder of them sorts. */
export function receiptFileName(reference: string): string {
  return `NetLet-receipt-${reference.replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
}
