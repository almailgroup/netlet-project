import { describe, expect, it } from "vitest";
import {
  choiceFromRow,
  isTaxed,
  NO_TAX,
  rateLabel,
  rateText,
  rowRateFor,
  splitTax,
  taxCharging,
  taxLines,
  taxOn,
  type TaxRules,
} from "./tax.js";
import { settle } from "./vouchers.js";
import { stillOwed } from "./collection.js";
import { refundFor } from "./returnRequests.js";
import { splitLine, type ChangeLine } from "./orderChanges.js";
import { buildCreditNote, buildInvoice, type FrozenOrderLine, type InvoiceDocument } from "./invoice.js";

const ON: TaxRules = { on: true, ratePercent: "5.00", allProducts: true };

describe("tax added at checkout", () => {
  it("is nothing while the switch is off or the rate is nothing", () => {
    expect(taxCharging(NO_TAX)).toBe(false);
    expect(taxCharging({ ...ON, on: false })).toBe(false);
    expect(taxCharging({ ...ON, ratePercent: "0.00" })).toBe(false);
    expect(isTaxed({ ...ON, on: false }, "taxed")).toBe(false);
    expect(taxLines({ ...ON, on: false }, [{ lineTotal: "10.000", choice: null }]).total).toBe("0.000");
  });

  it("follows the shop's default unless NetLet marked the product", () => {
    expect(isTaxed(ON, null)).toBe(true);
    expect(isTaxed(ON, "exempt")).toBe(false);
    const chosen = { ...ON, allProducts: false };
    expect(isTaxed(chosen, null)).toBe(false);
    expect(isTaxed(chosen, "taxed")).toBe(true);
    expect(isTaxed(chosen, "exempt")).toBe(false);
  });

  it("rounds each line half up to the fil", () => {
    expect(taxOn("10.000", "5.00")).toBe("0.500");
    expect(taxOn("0.010", "5.00")).toBe("0.001"); // 0.0005 rounds up
    expect(taxOn("0.009", "5.00")).toBe("0.000"); // 0.00045 rounds down
    expect(taxOn("24.375", "15.00")).toBe("3.656"); // 3.65625
    expect(taxOn("12.000", "2.50")).toBe("0.300");
    expect(taxOn("-5.000", "5.00")).toBe("0.000");
  });

  it("taxes each line on its own and sums them", () => {
    const { amounts, total } = taxLines(ON, [
      { lineTotal: "10.000", choice: null },
      { lineTotal: "4.000", choice: "exempt" },
      { lineTotal: "0.010", choice: "taxed" },
    ]);
    expect(amounts).toEqual(["0.500", "0.000", "0.001"]);
    expect(total).toBe("0.501");
  });

  it("stores a product's mark as the shop's rate or nothing", () => {
    expect(rowRateFor("taxed")).toBeNull();
    expect(rowRateFor("exempt")).toBe("0.00");
    expect(choiceFromRow(null, true)).toBe("taxed");
    expect(choiceFromRow("0.00", true)).toBe("exempt");
    expect(choiceFromRow("5.00", true)).toBe("taxed");
    expect(choiceFromRow(null, false)).toBeNull();
  });

  it("says the rate as it is frozen and as a person reads it", () => {
    expect(rateText("5")).toBe("5.00");
    expect(rateText("2.5")).toBe("2.50");
    expect(rateText("99")).toBe("30.00"); // the ceiling
    expect(rateLabel("5.00")).toBe("5%");
    expect(rateLabel("2.50")).toBe("2.5%");
  });

  it("splits a frozen line's tax so the parts add up to it", () => {
    expect(splitTax("0.501", "5.00", "6.000")).toEqual({ kept: "0.300", gone: "0.201" });
    // A kept part's own tax can never be more than what was frozen.
    expect(splitTax("0.100", "5.00", "6.000")).toEqual({ kept: "0.100", gone: "0.000" });
  });
});

describe("tax in the till, the driver's figure, a refund and a split", () => {
  it("is added before the code, the points and the card", () => {
    const bill = settle({ goods: "20.000", delivery: "2.000", tax: "1.000", discount: "3.000", points: "1.000", giftCard: "50.000" });
    expect(bill.discount).toBe("3.000");
    expect(bill.points).toBe("1.000");
    expect(bill.giftCard).toBe("19.000");
    expect(bill.payable).toBe("0.000");
    expect(settle({ goods: "20.000", delivery: "2.000", tax: "1.000" }).payable).toBe("23.000");
  });

  it("goes with a line that is no longer coming", () => {
    const owed = stillOwed({ grandTotal: "23.000", deliveryBreakdown: null }, [
      { vendorId: 1, destinationLabel: null, lineTotal: "10.000", tax: "0.500", fulfilment: "cancelled" },
      { vendorId: 1, destinationLabel: null, lineTotal: "10.000", tax: "0.500", fulfilment: "pending" },
    ]);
    expect(owed.owed).toBe("12.500");
    expect(owed.droppedGoods).toBe("10.500");
  });

  it("is handed back with a refunded item", () => {
    expect(refundFor({ lineTotal: "10.000", tax: "0.500" })).toBe("10.500");
    expect(refundFor({ lineTotal: "10.000" })).toBe("10.000");
  });

  it("is split with a lowered line", () => {
    const line: ChangeLine = {
      id: 1, fulfilment: "pending", vendorId: 1, vendorName: "Acme", quantity: 3, unitPrice: "4.000", lineTotal: "12.000",
      commissionPercent: "10.00", commissionFixed: "0.000", commissionAmount: "1.200", vendorNet: "10.800",
      affiliateVendorPercent: null, addonsPerUnit: "0.000", bundleId: null, deliveryChoice: "regular", destinationLabel: null,
      tax: "0.600", taxRate: "5.00",
    };
    const split = splitLine(line, 1)!;
    expect(split.kept.tax).toBe("0.200");
    expect(split.gone.tax).toBe("0.400");
    const untaxed = splitLine({ ...line, tax: undefined, taxRate: null }, 1)!;
    expect(untaxed.kept.tax).toBe("0.000");
  });
});

describe("tax on an invoice and a credit note", () => {
  const line = (over: Partial<FrozenOrderLine> = {}): FrozenOrderLine => ({
    vendorId: 1, vendorName: "Acme", destinationLabel: null, productTitle: "Lamp", productTitleAr: null, variantTitle: null,
    sku: null, quantity: 1, unitPrice: "10.000", lineTotal: "10.000", fulfilment: "delivered", ...over,
  });
  const invoice = () => buildInvoice({
    number: "INV-2026-000001",
    issuedAt: new Date("2026-11-17T10:00:00Z"),
    issuer: { name: "NetLet", nameAr: null, licence: null, address: null },
    order: { reference: "NL-1", currency: "KWD", email: null, contactName: null, contactPhone: null, addressLine: null, paymentMethod: "cod", discountValue: "0.000", pointsValue: "0.000", giftCardValue: "0.000", deliveryBreakdown: [{ vendorId: 1, vendorName: "Acme", fee: "2.000" }] as never },
    lines: [line({ tax: "0.500", taxRate: "5.00" }), line({ productTitle: "Mug", unitPrice: "4.000", lineTotal: "4.000" })],
    sellers: new Map(),
  });

  it("says each taxed line's tax and adds it to the total", () => {
    const document = invoice();
    expect(document.tax).toBe("0.500");
    expect(document.total).toBe("16.500");
    expect(document.paidWith.cash).toBe("16.500");
    expect(document.sellers[0].lines[0].tax).toEqual({ rate: "5.00", amount: "0.500" });
    expect(document.sellers[0].lines[1].tax).toBeUndefined();
  });

  it("credits the item and its tax apart, coming to the refund", () => {
    const note = buildCreditNote({ number: "CN-2026-000001", issuedAt: new Date(), invoice: invoice() as InvoiceDocument, line: line({ tax: "0.500", taxRate: "5.00" }), amount: "10.500", reason: "invoice.reasonReturn" });
    expect(note.goods).toBe("10.000");
    expect(note.tax).toBe("0.500");
    expect(note.total).toBe("10.500");
  });

  it("is absent from an untaxed order's document", () => {
    const document = buildInvoice({
      number: "INV-2026-000002",
      issuedAt: new Date(),
      issuer: { name: "NetLet", nameAr: null, licence: null, address: null },
      order: { reference: "NL-2", currency: "KWD", email: null, contactName: null, contactPhone: null, addressLine: null, paymentMethod: "cod", discountValue: "0.000", pointsValue: "0.000", giftCardValue: "0.000", deliveryBreakdown: null },
      lines: [line()],
      sellers: new Map(),
    });
    expect("tax" in document).toBe(false);
    expect(document.total).toBe("10.000");
  });
});
