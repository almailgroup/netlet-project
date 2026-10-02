import { describe, expect, it } from "vitest";
import { buildCreditNote, buildInvoice, gregorianDate, hijriDate, invoiceNumber, kuwaitYear, seriesFor, type FrozenOrderLine, type InvoiceOrder, type SellerDetails } from "./invoice.js";

const issuer = { name: "NetLet", nameAr: "نت‑لت", licence: "CR-12345", address: "Kuwait City" };

const order = (over: Partial<InvoiceOrder> = {}): InvoiceOrder => ({
  reference: "NL-20261002-QRTVW",
  currency: "KWD",
  email: "noura@shop.test",
  contactName: "Noura",
  contactPhone: "+96550000000",
  addressLine: "Block 4, Street 12",
  paymentMethod: "cod",
  discountValue: "0.000",
  pointsValue: "0.000",
  giftCardValue: "0.000",
  deliveryBreakdown: [
    { vendorId: 1, vendorName: "Acme", fee: "2.000" },
    { vendorId: 2, vendorName: "Beta", fee: "1.500" },
  ],
  ...over,
});

const line = (over: Partial<FrozenOrderLine>): FrozenOrderLine => ({
  vendorId: 1, vendorName: "Acme", destinationLabel: null, productTitle: "Sofa", productTitleAr: "كنبة",
  variantTitle: null, sku: "SOFA", quantity: 1, unitPrice: "240.000", lineTotal: "240.000", fulfilment: "delivered", ...over,
});

const sellers = new Map<number, SellerDetails>([
  [1, { name: "Acme Furniture", nameAr: "أكمي", licence: "MOCI-1", underPlatformLicence: false }],
  [2, { name: "Beta Home", nameAr: null, licence: null, underPlatformLicence: true }],
]);

const build = (o = order(), lines: FrozenOrderLine[] = [line({}), line({ vendorId: 2, vendorName: "Beta", productTitle: "Mug", productTitleAr: null, sku: "MUG", quantity: 2, unitPrice: "4.000", lineTotal: "8.000" })]) =>
  buildInvoice({ number: "INV-2026-000001", issuedAt: new Date("2026-10-02T09:00:00Z"), issuer, order: o, lines, sellers });

describe("numbering", () => {
  it("is a series per kind per Kuwaiti year, six digits wide", () => {
    expect(seriesFor("invoice", new Date("2026-10-02T09:00:00Z"))).toBe("INV-2026");
    expect(seriesFor("credit_note", new Date("2026-10-02T09:00:00Z"))).toBe("CRN-2026");
    expect(invoiceNumber("INV-2026", 42)).toBe("INV-2026-000042");
  });

  it("turns the year at midnight in Kuwait, not in UTC", () => {
    /* 22:30 UTC on 31 December is 01:30 on 1 January in Kuwait. */
    expect(kuwaitYear(new Date("2026-12-31T22:30:00Z"))).toBe(2027);
    expect(kuwaitYear(new Date("2026-12-31T20:30:00Z"))).toBe(2026);
  });
});

describe("an invoice", () => {
  it("names every seller under their own heading, with their registration", () => {
    const invoice = build();
    expect(invoice.sellers.map(seller => [seller.name, seller.licence, seller.underPlatformLicence])).toEqual([
      ["Acme Furniture", "MOCI-1", false],
      ["Beta Home", null, true],
    ]);
    expect(invoice.sellers[0].lines[0]).toMatchObject({ title: "Sofa", titleAr: "كنبة", lineTotal: "240.000" });
    expect(invoice.sellers.map(seller => seller.delivery)).toEqual(["2.000", "1.500"]);
  });

  it("adds up: goods plus delivery less the discount is the total, and the payments settle it", () => {
    const invoice = build(order({ discountValue: "10.000", pointsValue: "5.000", giftCardValue: "20.000" }));
    expect(invoice).toMatchObject({ goods: "248.000", delivery: "3.500", discount: "10.000", total: "241.500" });
    /* Points and a gift card are how it was paid, not a lower price. */
    expect(invoice.paidWith).toEqual({ points: "5.000", giftCard: "20.000", cash: "216.500" });
  });

  it("leaves off a line cancelled before collection, and the delivery of a seller with nothing left", () => {
    const invoice = build(order(), [line({}), line({ vendorId: 2, vendorName: "Beta", productTitle: "Mug", sku: "MUG", lineTotal: "8.000", fulfilment: "cancelled" })]);
    expect(invoice.sellers.map(seller => seller.name)).toEqual(["Acme Furniture"]);
    expect(invoice).toMatchObject({ goods: "240.000", delivery: "2.000", total: "242.000" });
    expect(invoice.paidWith.cash).toBe("242.000");
  });

  it("keeps a removed seller's frozen name rather than inventing details", () => {
    const invoice = build(order({ deliveryBreakdown: [] }), [line({ vendorId: null, vendorName: "Gone Ltd" })]);
    expect(invoice.sellers).toEqual([expect.objectContaining({ name: "Gone Ltd", licence: null, nameAr: null })]);
  });

  it("carries the buyer and the issuer as they were at issue", () => {
    const invoice = build();
    expect(invoice.issuer).toEqual(issuer);
    expect(invoice.buyer).toEqual({ name: "Noura", phone: "+96550000000", email: "noura@shop.test", address: "Block 4, Street 12" });
    expect(invoice.credits).toBeNull();
  });
});

describe("a credit note", () => {
  it("corrects one line of the invoice it names, for the amount refunded", () => {
    const invoice = build();
    const note = buildCreditNote({
      number: "CRN-2026-000001", issuedAt: new Date("2026-10-05T09:00:00Z"), invoice,
      line: line({ vendorId: 2, vendorName: "Beta", productTitle: "Mug", sku: "MUG", quantity: 2, unitPrice: "4.000", lineTotal: "8.000" }),
      amount: "8.000", reason: "invoice.reasonReturn",
    });
    expect(note).toMatchObject({ kind: "credit_note", total: "8.000", goods: "8.000", delivery: "0.000", credits: { invoiceNumber: "INV-2026-000001" } });
    /* The seller as the invoice named them, even if they have renamed since. */
    expect(note.sellers).toEqual([expect.objectContaining({ name: "Beta Home", underPlatformLicence: true })]);
    expect(note.buyer).toEqual(invoice.buyer);
  });
});

describe("dates", () => {
  it("gives the Hijri date in Kuwait alongside the Gregorian one", () => {
    expect(gregorianDate("2026-10-02T09:00:00Z", "en")).toBe("2 October 2026");
    expect(hijriDate("2026-10-02T09:00:00Z", "en")).toMatch(/1448 AH/);
    expect(hijriDate("2026-10-02T09:00:00Z", "ar")).toMatch(/1448/);
  });
});
