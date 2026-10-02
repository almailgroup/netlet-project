/**
 * Invoices and credit notes (3.6.6), the pure half.
 *
 * What is decided here is a legal statement about money, so it is pure for
 * the reason the order arithmetic is: a rule you can only exercise by
 * collecting cash from a real driver is a rule nobody checks.
 *
 * ## One invoice per order, issued by NetLet
 *
 * A basket from three sellers is one payment and one obligation, and the
 * order-level reductions — a discount code, points, a gift card — apply to the
 * basket rather than to any one seller. Splitting them across three invoices
 * would need an allocation rule nobody has decided, and an invented one would
 * be three statements that do not add up to what the shopper paid. So NetLet
 * issues one invoice for the order, as the marketplace the shopper paid, and
 * every seller is named on it under their own heading with their own
 * commercial registration — or, for a seller trading under NetLet's licence
 * (3.3.16), with that said in words.
 *
 * ## Issued at collection, from the frozen order
 *
 * An invoice says what was sold, so it is issued when the sale completes —
 * when the money is collected — and never at checkout, where a cash order is
 * still only a promise. It is built from the figures the order froze, never
 * from today's catalogue, and a line cancelled before collection is on it no
 * more than it is on the driver's sheet: `isKept` and the door rule are
 * `collection.ts`'s, so the invoice and the cash collected cannot disagree.
 *
 * ## Corrected by credit notes, never edited
 *
 * A refund is a credit note pointing at the invoice, with its own number in its
 * own series. The invoice it corrects is untouched: a document that changes
 * after it was issued is not a record of anything.
 *
 * ## Numbers
 *
 * `INV-2026-000042`: a series per kind per year, gap-free within the series.
 * The year is Kuwait's — UTC+3 all year, no daylight saving — so an order
 * collected at 1am on 1 January in Kuwait is numbered in the new year rather
 * than the old one.
 *
 * ## Both languages, both calendars
 *
 * The document stores facts, not sentences: names in both languages where the
 * seller recorded both, amounts as strings to three decimals, the moment as an
 * ISO timestamp. The page renders Arabic and English labels side by side and
 * the date in both the Gregorian and the Hijri (Umm al-Qura) calendars, so one
 * document reads the same whichever language the reader has the site in.
 */
import { addMoney, fromFils, subtractMoney, toFils } from "../money.js";
import { isKept } from "./collection.js";
import type { FrozenDelivery } from "./delivery.js";
import { settle } from "./vouchers.js";

export const INVOICE_KINDS = ["invoice", "credit_note"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

/** Kuwait does not observe daylight saving, so the offset is a constant. */
const KUWAIT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** The calendar year in Kuwait at this moment. */
export function kuwaitYear(at: Date): number {
  return new Date(at.getTime() + KUWAIT_OFFSET_MS).getUTCFullYear();
}

/** `INV-2026` or `CRN-2026`: the series a document of this kind issued now belongs to. */
export function seriesFor(kind: InvoiceKind, at: Date): string {
  return `${kind === "invoice" ? "INV" : "CRN"}-${kuwaitYear(at)}`;
}

/** `INV-2026-000042`. Six digits is a million documents a year before the width grows. */
export function invoiceNumber(series: string, sequence: number): string {
  return `${series}-${String(sequence).padStart(6, "0")}`;
}

/** Whoever issues the document. NetLet, from configuration. */
export type InvoiceIssuer = {
  name: string;
  nameAr: string | null;
  /** Commercial registration with the Ministry of Commerce, or null when not configured. */
  licence: string | null;
  address: string | null;
};

export type InvoiceLine = {
  title: string;
  titleAr: string | null;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  /** As frozen, add-ons included. */
  lineTotal: string;
};

export type InvoiceSeller = {
  /** Which store, so a credit note can name the seller this invoice named. */
  vendorId: number | null;
  name: string;
  nameAr: string | null;
  licence: string | null;
  underPlatformLicence: boolean;
  lines: InvoiceLine[];
  /** This seller's delivery charge on this document. */
  delivery: string;
};

export type InvoiceDocument = {
  version: 1;
  kind: InvoiceKind;
  number: string;
  /** ISO 8601. */
  issuedAt: string;
  orderReference: string;
  currency: string;
  issuer: InvoiceIssuer;
  buyer: { name: string | null; phone: string | null; email: string; address: string | null };
  sellers: InvoiceSeller[];
  /** Goods, delivery, the order's discount, and what all that comes to. */
  goods: string;
  delivery: string;
  discount: string;
  total: string;
  /** How the total was settled. Points and a gift card are payments, not price. */
  paidWith: { points: string; giftCard: string; cash: string };
  paymentMethod: string | null;
  /** On a credit note: what it corrects, and why. */
  credits: { invoiceNumber: string; reason: string } | null;
};

/** One frozen order line, as `order_items` holds it. */
export type FrozenOrderLine = {
  vendorId: number | null;
  vendorName: string | null;
  destinationLabel: string | null;
  productTitle: string;
  productTitleAr: string | null;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  fulfilment: string;
};

export type SellerDetails = { name: string; nameAr: string | null; licence: string | null; underPlatformLicence: boolean };

export type InvoiceOrder = {
  reference: string;
  currency: string;
  email: string;
  contactName: string | null;
  contactPhone: string | null;
  addressLine: string | null;
  paymentMethod: string | null;
  discountValue: string;
  pointsValue: string;
  giftCardValue: string;
  deliveryBreakdown: FrozenDelivery | null;
};

const sellerKey = (vendorId: number | null, name: string | null) => (vendorId !== null ? `v${vendorId}` : `n${name ?? ""}`);
const doorKey = (vendorId: number | null, label: string | null | undefined) => `${vendorId ?? "none"}|${label ?? ""}`;

/**
 * The invoice for an order whose money has been collected.
 *
 * `sellers` is today's details for each vendor still on file, read once at the
 * moment of issue and frozen into the document from then on; a vendor removed
 * since the sale falls back to the name the line froze, with no registration —
 * an absent fact rather than an invented one.
 */
export function buildInvoice(input: {
  number: string;
  issuedAt: Date;
  issuer: InvoiceIssuer;
  order: InvoiceOrder;
  lines: FrozenOrderLine[];
  sellers: ReadonlyMap<number, SellerDetails>;
}): InvoiceDocument {
  const { order } = input;
  const kept = input.lines.filter(line => isKept(line.fulfilment));

  /* Which doors still have something going to them: the delivery rule
     `stillOwed` applies, so a seller whose every line was cancelled is not
     charged for a van that never came. */
  const doors = new Map<string, { kept: number; gone: number }>();
  for (const line of input.lines) {
    const key = doorKey(line.vendorId, line.destinationLabel);
    const door = doors.get(key) ?? { kept: 0, gone: 0 };
    if (isKept(line.fulfilment)) door.kept += 1; else door.gone += 1;
    doors.set(key, door);
  }

  const groups = new Map<string, InvoiceSeller>();
  const groupFor = (vendorId: number | null, frozenName: string | null): InvoiceSeller => {
    const key = sellerKey(vendorId, frozenName);
    let group = groups.get(key);
    if (!group) {
      const details = vendorId !== null ? input.sellers.get(vendorId) : undefined;
      group = {
        vendorId,
        name: details?.name ?? frozenName ?? "—",
        nameAr: details?.nameAr ?? null,
        licence: details?.licence ?? null,
        underPlatformLicence: details?.underPlatformLicence ?? false,
        lines: [],
        delivery: "0.000",
      };
      groups.set(key, group);
    }
    return group;
  };

  for (const line of kept) {
    groupFor(line.vendorId, line.vendorName).lines.push({
      title: line.productTitle,
      titleAr: line.productTitleAr,
      variantTitle: line.variantTitle,
      sku: line.sku,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
    });
  }

  for (const charge of order.deliveryBreakdown ?? []) {
    const door = doors.get(doorKey(charge.vendorId, charge.destinationLabel));
    if (door && door.kept === 0 && door.gone > 0) continue;
    const group = groupFor(charge.vendorId, charge.vendorName);
    group.delivery = addMoney(group.delivery, charge.fee);
  }

  /* A seller with nothing left on the order and no delivery charge has
     nothing to say on it. */
  const sellers = [...groups.values()].filter(group => group.lines.length > 0 || toFils(group.delivery) > 0n);
  const goods = fromFils(kept.reduce((sum, line) => sum + toFils(line.lineTotal), 0n));
  const delivery = fromFils(sellers.reduce((sum, group) => sum + toFils(group.delivery), 0n));
  const settled = settle({ goods, delivery, discount: order.discountValue, points: order.pointsValue, giftCard: order.giftCardValue });

  return {
    version: 1,
    kind: "invoice",
    number: input.number,
    issuedAt: input.issuedAt.toISOString(),
    orderReference: order.reference,
    currency: order.currency,
    issuer: input.issuer,
    buyer: { name: order.contactName, phone: order.contactPhone, email: order.email, address: order.addressLine },
    sellers,
    goods,
    delivery,
    discount: settled.discount,
    total: subtractMoney(addMoney(goods, delivery), settled.discount),
    paidWith: { points: settled.points, giftCard: settled.giftCard, cash: settled.payable },
    paymentMethod: order.paymentMethod,
    credits: null,
  };
}

/**
 * A credit note for a refunded line, against the invoice it corrects.
 *
 * The parties are copied from the invoice rather than re-read, because the
 * credit note corrects *that* document: the seller it names is the seller the
 * invoice named, even if they have renamed themselves since.
 */
export function buildCreditNote(input: {
  number: string;
  issuedAt: Date;
  invoice: InvoiceDocument;
  line: FrozenOrderLine;
  amount: string;
  reason: string;
}): InvoiceDocument {
  const { invoice, line } = input;
  const original = invoice.sellers.find(seller => seller.vendorId === line.vendorId);
  return {
    ...invoice,
    kind: "credit_note",
    number: input.number,
    issuedAt: input.issuedAt.toISOString(),
    sellers: [{
      vendorId: line.vendorId,
      name: original?.name ?? line.vendorName ?? "—",
      nameAr: original?.nameAr ?? null,
      licence: original?.licence ?? null,
      underPlatformLicence: original?.underPlatformLicence ?? false,
      lines: [{
        title: line.productTitle,
        titleAr: line.productTitleAr,
        variantTitle: line.variantTitle,
        sku: line.sku,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: input.amount,
      }],
      delivery: "0.000",
    }],
    goods: input.amount,
    delivery: "0.000",
    discount: "0.000",
    total: input.amount,
    paidWith: { points: "0.000", giftCard: "0.000", cash: "0.000" },
    credits: { invoiceNumber: invoice.number, reason: input.reason },
  };
}

/** The Hijri (Umm al-Qura) date of a moment, in Kuwait, for the given language. */
export function hijriDate(at: Date | string, locale: "en" | "ar"): string {
  const date = at instanceof Date ? at : new Date(at);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-u-ca-islamic-umalqura-nu-latn" : "en-u-ca-islamic-umalqura", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kuwait",
  }).format(date);
}

/** The Gregorian date of a moment, in Kuwait. */
export function gregorianDate(at: Date | string, locale: "en" | "ar"): string {
  const date = at instanceof Date ? at : new Date(at);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : "en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kuwait",
  }).format(date);
}
