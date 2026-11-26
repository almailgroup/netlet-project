import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/* What the address book's read answers, what the account is and where it
   delivers, set by each case. */
const state = vi.hoisted(() => ({
  book: {} as Record<string, unknown>,
  zone: null as string | null,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: { customer: { addresses: { list: { useQuery: () => state.book } } } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("@/contexts/CustomerContext", () => ({
  useCustomer: () => ({ deliveryZoneId: state.zone, deliveryZone: null }),
}));
vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, isArabic: false }),
}));

const { DeliveryAddressCard } = await import("./DeliveryAddressCard");

const home = {
  id: 8, label: "Home", contactName: "Noura", contactPhone: "50000000", governorate: "hawalli",
  addressLine: "Salmiya, block 4", addressNotes: null, parts: null, pin: null,
};

function draw() {
  return renderToStaticMarkup(createElement(DeliveryAddressCard, { open: false, onOpen: () => {}, onClose: () => {} }));
}

describe("DeliveryAddressCard", () => {
  beforeEach(() => {
    state.zone = null;
  });

  /* The book failing to answer was an outline that pulsed for good, and the
     dialog's was too: a shopper waited on something that was never coming. */
  it("says the book could not be read, with Try again, never an outline or 'choose an address'", () => {
    state.book = { isError: true, isSuccess: false, data: undefined, refetch: () => {} };
    const html = draw();
    expect(html).toContain("delivery.loadFailed");
    expect(html).toContain("home.refreshCatalog");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toContain("cart.chooseAddress");
  });

  it("draws an outline while the book is first asked", () => {
    state.book = { isError: false, isSuccess: false, data: undefined, refetch: () => {} };
    const html = draw();
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("delivery.loadFailed");
  });

  it("asks for an address when the book answered with none", () => {
    state.book = { isError: false, isSuccess: true, data: [], refetch: () => {} };
    const html = draw();
    expect(html).toContain("cart.chooseAddress");
    expect(html).not.toContain("delivery.loadFailed");
  });

  /* A refresh that failed keeps what was read: React Query leaves the data
     and turns `isSuccess` false, which made the card an outline again. */
  it("keeps the address in use when a refresh behind it fails", () => {
    state.zone = "hawalli";
    state.book = { isError: true, isSuccess: false, data: [home], refetch: () => {} };
    const html = draw();
    expect(html).toContain("Home");
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toContain("delivery.loadFailed");
  });
});
