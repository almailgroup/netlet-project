import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";

/* On the owner's word: outside editing, a press on an item's words opens
   where it is, and a press on its photo opens its page on the shop. Before,
   both were the product page. */
vi.mock("@/lib/trpc", () => {
  const node = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get(_target, key: string) {
        if (key === "useMutation") return () => ({ mutate: () => {}, isPending: false });
        if (key === "useQuery") return () => ({ data: undefined, isPending: false });
        if (key === "useUtils") return () => node([]);
        if (key === "invalidate") return () => Promise.resolve();
        if (key === "then") return undefined;
        return node([...path, key]);
      },
      apply() { return node(path); },
    });
  return { trpc: node([]) };
});
vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params?.name ? `${key}(${String(params.name)})` : key),
    tError: (message: string) => message,
    locale: "en",
    isArabic: false,
  }),
}));
vi.mock("@/contexts/CartContext", () => ({ useCart: () => ({ cartId: null, adoptCart: async () => {}, addItem: async () => {} }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
/* A wide screen: the bar of the chosen items draws nothing while none is chosen. */
vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => true }));
vi.mock("@/hooks/useDateFormat", () => ({ useShortDayFormat: () => () => "day", useDateFormat: () => () => "day" }));
vi.mock("@/lib/haptics", () => ({ pressHaptic: () => {} }));
const none = () => null;
vi.mock("@/components/ui/ConfirmDialog", () => ({ ConfirmDialog: none }));
vi.mock("@/components/account/TrackParcels", () => ({ TrackParcels: none }));
vi.mock("@/components/account/OrderModify", () => ({ OrderModify: none }));
vi.mock("@/components/account/OrderAddress", () => ({ OrderAddress: none }));
vi.mock("@/components/account/OrderPayment", () => ({ OrderPayment: none }));
vi.mock("@/components/account/OrderHelp", () => ({ OrderHelp: none }));
vi.mock("@/components/account/OrderHandover", () => ({ HandoverCard: none, PaidOnlineNote: none }));
vi.mock("@/components/account/OrderWarranty", () => ({ WarrantyClaims: none, WarrantyForm: none }));
vi.mock("@/components/account/OrderReceipt", () => ({ ReceiptButton: none }));
vi.mock("@/components/account/OrderJourney", () => ({ ItemStatus: none }));
vi.mock("@/components/account/LineReturn", () => ({ LineReturnForm: none, mayRequestReturn: () => false, REASON_LABEL: {} }));

const { OrderAfterSales, OrderLinePhoto, OrderLineTitle } = await import("./OrderActions");

type Detail = Parameters<typeof OrderAfterSales>[0]["detail"];
type Line = Detail["lines"][number];

const line = (over: Partial<Line>): Line => ({
  id: 1,
  productTitle: "Desk lamp",
  productHandle: "desk-lamp",
  fulfilment: "pending",
  quantity: 1,
  variantId: 5,
  changeable: false,
  review: null,
  warrantyEligibility: { allowed: false },
  reviewEligibility: { allowed: false },
  returnState: { returnable: false, reason: "returns.notDelivered" },
  ...over,
} as Line);

/** An order whose one parcel holds the lines named. */
const orderWith = (lines: Line[], tracked: number[]): Detail => ({
  lines,
  steps: {
    placedAt: "2026-11-01T07:00:00.000Z",
    cancelled: tracked.length === 0,
    parcels: tracked.length
      ? [{ key: "a", vendorName: "Acme", destinationLabel: null, fast: false, lineIds: tracked, items: tracked.length, step: "placed", deliveredAt: null, promise: null }]
      : [],
  },
  cancel: { cancellable: false, reason: "orders.cancelClosed" },
  change: { changeable: false },
  changeAddress: { changeable: false },
  paymentChange: { open: false },
  returns: [],
} as unknown as Detail);

function drawn(item: Line, detail: Detail) {
  return renderToStaticMarkup(
    createElement(Router, { ssrPath: "/account/orders" },
      createElement(OrderAfterSales, { reference: "NL-1", detail, onRate: () => {} },
        createElement(OrderLinePhoto, { line: item }, createElement("img", { alt: "" })),
        createElement(OrderLineTitle, { line: item }),
      ),
    ),
  );
}

describe("an opened order's item", () => {
  it("opens where it is from its words, and its page from its photo", () => {
    const item = line({});
    const html = drawn(item, orderWith([item], [1]));
    expect(html).toMatch(/<button (?=[^>]*aria-expanded="false")(?=[^>]*aria-describedby="([^"]+)")[^>]*>Desk lamp<\/button><span id="\1" class="sr-only">orders\.trackItem<\/span>/);
    expect(html).toMatch(/<a (?=[^>]*aria-label="product\.view\(Desk lamp\)")(?=[^>]*href="\/products\/desk-lamp")[^>]*><img/);
    expect(html).not.toMatch(/<a (?=[^>]*dir="auto")[^>]*>Desk lamp/);
  });

  it("opens its page from its words when nothing holds it to track, the photo then for the eye alone", () => {
    const item = line({ fulfilment: "cancelled" });
    const html = drawn(item, orderWith([item, line({ id: 2 })], [2]));
    expect(html).toMatch(/<a (?=[^>]*href="\/products\/desk-lamp")[^>]*>Desk lamp<\/a>/);
    expect(html).toMatch(/<a (?=[^>]*tabindex="-1")(?=[^>]*aria-hidden="true")[^>]*><img/);
    expect(html).not.toContain("orders.trackItem");
  });

  it("still tracks an item the shop no longer shows, with no link from its photo", () => {
    const item = line({ productHandle: null });
    const html = drawn(item, orderWith([item], [1]));
    expect(html).toContain("orders.trackItem");
    expect(html).not.toContain("<a ");
  });
});
