/**
 * Paying online for an order placed as cash on delivery, and the driver's
 * check at the door — on the owner's word ("allow customers to change from
 * COD to online payment through the order page … automatically update the
 * payment status in the driver's system … a QR code for the driver to scan as
 * additional payment confirmation").
 *
 * Pure, and shared, for the reason the order arithmetic is: what it decides is
 * whether somebody is asked for money at their door.
 *
 * ## A mockup, on the owner's word
 *
 * NetLet has no payment gateway yet ("build a mockup"), so the only provider
 * is `test`: NetLet's own page that says it takes no money. **A test payment
 * never touches the books** — the order stays `pending_payment`, so the
 * finance panel, payouts, invoices and referral points count nothing, which
 * is the truth: no money moved. It does move the order off cash (its
 * `payment_method` becomes the method chosen), so nobody can record cash
 * against it and the driver's board stops asking for any. A real gateway,
 * when one is connected, is the step that marks the order `paid` on the
 * gateway's word; the table already allows `myfatoorah` and `tap`.
 *
 * **It sits behind a switch that starts off** (`testPayments`): while it is
 * on, any shopper can have an order read "paid online" without paying, so it
 * is for trying the flow and nothing else.
 *
 * ## The window
 *
 * **Until it is delivered**, on the owner's word — paying online while the
 * driver is on the way is the case the board's live update is for. An unpaid
 * cash order with something still to come, and nothing already paid online.
 */
import type { FulfilmentState } from "./fulfilment.js";

export const ONLINE_METHODS = ["knet", "card", "apple_pay"] as const;
export type OnlineMethod = (typeof ONLINE_METHODS)[number];

export function isOnlineMethod(value: unknown): value is OnlineMethod {
  return typeof value === "string" && (ONLINE_METHODS as readonly string[]).includes(value);
}

/** Who took it. Only `test` exists today; the other two are the gateways the
    owner was offered, so connecting one needs no migration. */
export const PAYMENT_PROVIDERS = ["test", "myfatoorah", "tap"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/** One attempt's life: started on the press, then paid, failed or (after a
    cancel) refunded. At most one `paid` per order, by a partial unique index. */
export const PAYMENT_ATTEMPT_STATES = ["started", "paid", "failed", "refunded"] as const;
export type PaymentAttemptState = (typeof PAYMENT_ATTEMPT_STATES)[number];

/** A payment that went through, as the order page and the driver's board show it. */
export type PaidOnline = {
  method: OnlineMethod;
  amount: string;
  paidAt: string;
  /** NetLet's test page took it: no money moved. */
  test: boolean;
};

export type PayRefusal =
  | "orders.payClosed"
  | "orders.payAlready"
  | "orders.payDelivered";

export type PayWindow = { open: true } | { open: false; reason: PayRefusal };

/**
 * May this order still be paid online?
 *
 * Unpaid and taken in cash (or from before a method was recorded); nothing of
 * it paid online already; and something still to come — a line not cancelled,
 * returned or delivered. The server asks again under a lock on the order.
 */
export function onlinePayWindow(
  order: { status: string; paymentMethod: string | null },
  lines: { fulfilment: FulfilmentState | string }[],
): PayWindow {
  if (isOnlineMethod(order.paymentMethod)) return { open: false, reason: "orders.payAlready" };
  if (order.status !== "pending_payment") return { open: false, reason: "orders.payClosed" };
  if (order.paymentMethod !== null && order.paymentMethod !== "cod") return { open: false, reason: "orders.payClosed" };
  const coming = lines.filter(line => line.fulfilment !== "cancelled" && line.fulfilment !== "returned");
  if (coming.length === 0) return { open: false, reason: "orders.payClosed" };
  if (coming.every(line => line.fulfilment === "delivered")) return { open: false, reason: "orders.payDelivered" };
  return { open: true };
}

/* ------------------------------------------------------------ the door --- */

/**
 * The code under the QR, for a driver whose camera cannot read it: eight
 * characters from the order reference's alphabet (no O or 0, no I, 1 or L,
 * no S or 5), because it is read off a stranger's screen at a door.
 */
export const HANDOVER_CODE_LENGTH = 8;
export const HANDOVER_ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ2346789";

/** Eight characters from the first bytes of a signature. */
export function handoverCodeFrom(bytes: Uint8Array): string {
  let code = "";
  for (let index = 0; index < HANDOVER_CODE_LENGTH; index += 1) {
    code += HANDOVER_ALPHABET[(bytes[index] ?? 0) % HANDOVER_ALPHABET.length];
  }
  return code;
}

/** "ABCD EFGH", as it is drawn and read aloud. */
export function formatHandoverCode(code: string): string {
  return code.length === HANDOVER_CODE_LENGTH ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

/**
 * What a driver typed, as a code: capitals, the spaces and dashes gone, and
 * the letters people type for the ones the alphabet left out read as the ones
 * it kept (an O is a 0 nobody meant; the alphabet has neither, so it stays
 * wrong rather than becoming a guess). Null when it cannot be a code.
 */
export function normaliseHandoverCode(typed: string): string | null {
  const folded = typed
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06F0))
    .toUpperCase()
    .replace(/[\s\-–—.]/g, "");
  if (folded.length !== HANDOVER_CODE_LENGTH) return null;
  for (const character of folded) if (!HANDOVER_ALPHABET.includes(character)) return null;
  return folded;
}

/**
 * The token the QR carries: the order's id and a signature, in the address's
 * fragment so no server log or proxy sees it. Parsed here, checked by the
 * server against its secret.
 */
export function parseHandoverToken(token: string): { orderId: number; signature: string } | null {
  const match = /^h1\.(\d{1,10})\.([A-Za-z0-9_-]{16,64})$/.exec(token.trim());
  if (!match) return null;
  const orderId = Number(match[1]);
  if (!Number.isSafeInteger(orderId) || orderId < 1 || orderId > 2_147_483_647) return null;
  return { orderId, signature: match[2]! };
}

/** The token as `parseHandoverToken` reads it. */
export function handoverToken(orderId: number, signature: string): string {
  return `h1.${orderId}.${signature}`;
}

/** Where the QR sends a phone's own camera: the driver's portal, the token in the fragment. */
export function handoverScanPath(token: string): string {
  return `/admin/dispatch/scan#h=${token}`;
}

/** The token out of a scanned address or a scanned bare token. */
export function tokenFromScan(scanned: string): string | null {
  const text = scanned.trim();
  const fragment = /#h=([^&\s]+)/.exec(text);
  const candidate = fragment ? decodeURIComponent(fragment[1]!) : text;
  return parseHandoverToken(candidate) ? candidate : null;
}

/**
 * What the driver's scan answers, and what one press after it does.
 *
 * **Paid online is one step**, on the owner's word ("confirm payment and mark
 * delivered"): the scan itself hands the parcel over. **Cash is two**: the
 * screen says what to collect, and the driver presses once the money is in
 * their hand — a scan before the cash would otherwise mark a parcel delivered
 * that nobody has paid for.
 */
export type HandoverPayment =
  | { kind: "online"; method: OnlineMethod; test: boolean }
  | { kind: "cash"; collect: string }
  | { kind: "settled" };

export function handoverPayment(
  order: { status: string; paymentMethod: string | null },
  paid: PaidOnline | null,
  owed: string,
): HandoverPayment {
  if (paid) return { kind: "online", method: paid.method, test: paid.test };
  if (order.status === "paid" || Number(owed) <= 0) return { kind: "settled" };
  return { kind: "cash", collect: owed };
}

/** Whether a scan alone may hand the parcel over, without a further press. */
export function scanHandsOver(payment: HandoverPayment): boolean {
  return payment.kind !== "cash";
}
