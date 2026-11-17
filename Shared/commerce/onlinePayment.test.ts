import { describe, expect, it } from "vitest";
import {
  formatHandoverCode,
  HANDOVER_ALPHABET,
  HANDOVER_CODE_LENGTH,
  handoverCodeFrom,
  handoverPayment,
  handoverScanPath,
  handoverToken,
  isOnlineMethod,
  normaliseHandoverCode,
  onlinePayWindow,
  parseHandoverToken,
  scanHandsOver,
  tokenFromScan,
} from "./onlinePayment.js";

const cash = { status: "pending_payment", paymentMethod: "cod" };

describe("when an order may be paid online", () => {
  it("is open for a cash order with something still to come, the driver's way included", () => {
    expect(onlinePayWindow(cash, [{ fulfilment: "pending" }])).toEqual({ open: true });
    expect(onlinePayWindow(cash, [{ fulfilment: "shipped" }, { fulfilment: "delivered" }])).toEqual({ open: true });
    /* A line a store cancelled does not hold the rest back. */
    expect(onlinePayWindow(cash, [{ fulfilment: "cancelled" }, { fulfilment: "preparing" }])).toEqual({ open: true });
    /* From before a method was recorded: cash. */
    expect(onlinePayWindow({ status: "pending_payment", paymentMethod: null }, [{ fulfilment: "pending" }]).open).toBe(true);
  });

  it("closes once everything has arrived, once it is paid, and once it is over", () => {
    expect(onlinePayWindow(cash, [{ fulfilment: "delivered" }, { fulfilment: "returned" }])).toEqual({ open: false, reason: "orders.payDelivered" });
    expect(onlinePayWindow({ ...cash, status: "paid" }, [{ fulfilment: "shipped" }])).toEqual({ open: false, reason: "orders.payClosed" });
    expect(onlinePayWindow({ ...cash, status: "cancelled" }, [{ fulfilment: "cancelled" }])).toEqual({ open: false, reason: "orders.payClosed" });
    expect(onlinePayWindow(cash, [{ fulfilment: "cancelled" }])).toEqual({ open: false, reason: "orders.payClosed" });
  });

  it("says it is paid already once an online method is on the order", () => {
    expect(onlinePayWindow({ status: "pending_payment", paymentMethod: "knet" }, [{ fulfilment: "pending" }])).toEqual({ open: false, reason: "orders.payAlready" });
    expect(isOnlineMethod("apple_pay")).toBe(true);
    expect(isOnlineMethod("cod")).toBe(false);
  });
});

describe("the code at the door", () => {
  it("is eight characters from an alphabet with nothing to mishear", () => {
    const code = handoverCodeFrom(new Uint8Array([0, 1, 2, 3, 200, 250, 255, 28]));
    expect(code).toHaveLength(HANDOVER_CODE_LENGTH);
    for (const character of code) expect(HANDOVER_ALPHABET).toContain(character);
    for (const unclear of "O0I1LS5") expect(HANDOVER_ALPHABET).not.toContain(unclear);
    expect(formatHandoverCode("ABCDEFGH")).toBe("ABCD EFGH");
  });

  it("reads what a driver types: spaces, dashes, small letters and Arabic digits", () => {
    expect(normaliseHandoverCode(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(normaliseHandoverCode("ab cd ٢٣٤٦")).toBe("ABCD2346");
    /* A letter the alphabet left out is not guessed at. */
    expect(normaliseHandoverCode("ABCDEFG0")).toBeNull();
    expect(normaliseHandoverCode("ABCDEFG")).toBeNull();
  });
});

describe("the token the QR carries", () => {
  const signature = "AbCdEfGhIjKlMnOpQrStUvWx";

  it("names the order and the signature, and nothing else", () => {
    expect(parseHandoverToken(handoverToken(42, signature))).toEqual({ orderId: 42, signature });
    expect(parseHandoverToken(`h1.0.${signature}`)).toBeNull();
    expect(parseHandoverToken(`h1.99999999999.${signature}`)).toBeNull();
    expect(parseHandoverToken("h1.42.short")).toBeNull();
    expect(parseHandoverToken(`h2.42.${signature}`)).toBeNull();
  });

  it("goes in the scan page's fragment, and comes back out of an address or alone", () => {
    const token = handoverToken(42, signature);
    expect(handoverScanPath(token)).toBe(`/admin/dispatch/scan#h=${token}`);
    expect(tokenFromScan(`https://vendor.netlet.net/dispatch/scan#h=${token}`)).toBe(token);
    expect(tokenFromScan(token)).toBe(token);
    expect(tokenFromScan("https://example.com/")).toBeNull();
  });
});

describe("what the scan answers", () => {
  const paid = { method: "knet" as const, amount: "12.000", paidAt: "2026-11-17T10:00:00.000Z", test: true };

  it("is one step when paid online, two when cash is owed", () => {
    const online = handoverPayment({ status: "pending_payment", paymentMethod: "knet" }, paid, "12.000");
    expect(online).toEqual({ kind: "online", method: "knet", test: true });
    expect(scanHandsOver(online)).toBe(true);

    const owed = handoverPayment(cash, null, "8.500");
    expect(owed).toEqual({ kind: "cash", collect: "8.500" });
    expect(scanHandsOver(owed)).toBe(false);
  });

  it("asks for nothing once the cash is in, or nothing is owed", () => {
    expect(handoverPayment({ ...cash, status: "paid" }, null, "8.500")).toEqual({ kind: "settled" });
    expect(handoverPayment(cash, null, "0.000")).toEqual({ kind: "settled" });
  });
});
