import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";

vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: "en", isArabic: false }),
}));

const { OrderListRow } = await import("./AccountOrders");

const ORDER = {
  id: 7,
  reference: "NL-20261012-3NJA9",
  status: "pending_payment",
  currency: "KWD",
  grandTotal: "39.900",
  paymentMethod: "cash_on_delivery",
  placedAt: "2026-10-12T09:00:00.000Z",
  owed: { owed: "39.900", reduced: false },
  summary: {
    lineCount: 8,
    photos: ["/media/a.webp", "/media/b.webp", "/media/c.webp", "/media/d.webp"],
    progress: { kind: "preparing" },
    first: { title: "Blush Heart Necklace Green", variant: null },
  },
};

function row(order: Record<string, unknown> = {}, open = false) {
  return renderToStaticMarkup(createElement(Router, { ssrPath: "/account/orders" }, createElement(OrderListRow, {
    order: { ...ORDER, ...order } as never, open, onToggle: () => {}, onTrack: () => {}, children: null,
  })));
}

describe("an order's row on My orders", () => {
  /* The owner's list: several pictures, the number, the date, the amount and
     how it is paid, and Track order — and nothing else. It led with the first
     item's name ("Blush Heart Necklace Green and 7 more") beside one photo. */
  it("shows several of its pictures and counts the rest", () => {
    const html = row();
    for (const photo of ORDER.summary.photos) expect(html).toContain(photo);
    expect(html).toContain("+4");
  });

  it("names it by its number, its date, its amount and how it is paid, not by an item", () => {
    const html = row();
    expect(html).toContain("NL-20261012-3NJA9");
    expect(html).toContain("orders.orderedOn");
    expect(html).toContain("39.900");
    expect(html).toContain("orders.payOnDelivery");
    expect(html).not.toContain("Blush Heart Necklace");
    expect(html).not.toContain("orders.andMore");
  });

  it("offers Track order, and nothing else to press but the row", () => {
    const html = row();
    expect(html).toContain("orders.track");
    expect(html).not.toContain("orders.requestRefund");
    expect(html).not.toContain("orders.rateItems");
    expect(html.match(/<button/g)).toHaveLength(2);
  });

  it("has nothing to track on an order cancelled whole, nor while it is open", () => {
    expect(row({ status: "cancelled", summary: { ...ORDER.summary, progress: { kind: "cancelled" } } })).not.toContain("orders.track");
    expect(row({}, true)).not.toContain("orders.track");
  });
});
