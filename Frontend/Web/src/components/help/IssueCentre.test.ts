import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, tError: (key: string) => key, locale: "en", isArabic: false }),
}));
vi.mock("@/hooks/useDateFormat", () => ({ useDateFormat: () => () => "1 Nov" }));

const { OrderChoices } = await import("./IssueCentre");

function draw(orders: Record<string, unknown>) {
  return renderToStaticMarkup(createElement(OrderChoices, {
    orders: { isLoading: false, isError: false, refetch: () => {}, ...orders } as never,
    onChoose: () => {},
  }));
}

describe("help's order picker", () => {
  /* A list that could not be read was an empty list with no way on — and in
     the app it said "You have no orders yet". */
  it("says the orders could not be read, with Try again, never 'no orders'", () => {
    const html = draw({ isError: true, data: undefined });
    expect(html).toContain("help.ordersFailed");
    expect(html).toContain("home.refreshCatalog");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("help.noOrders");
  });

  it("says there are none once the account is known to have none", () => {
    const html = draw({ data: { rows: [] } });
    expect(html).toContain("help.noOrders");
    expect(html).not.toContain("help.ordersFailed");
  });

  it("keeps the orders already drawn when asking again fails", () => {
    const html = draw({
      isError: true,
      data: { rows: [{ reference: "NL-20261101-QRTVW", placedAt: "2026-11-01T10:00:00Z", summary: { photos: [], first: { title: "Brass lamp" } } }] },
    });
    expect(html).toContain("Brass lamp");
    expect(html).not.toContain("help.ordersFailed");
  });
});
