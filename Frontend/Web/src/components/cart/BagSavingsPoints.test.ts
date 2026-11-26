import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";

/* What each read answers in this test, by its procedure's path. */
const reads: Record<string, unknown> = {};
const quiet = { data: undefined, isError: false, isSuccess: false, isPending: true, refetch: () => {} };

vi.mock("@/lib/trpc", () => {
  const node = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get(_target, key: string) {
        if (key === "useQuery") return () => reads[path.join(".")] ?? quiet;
        if (key === "useMutation") return () => ({ mutate: () => {}, isPending: false });
        if (key === "useUtils") return () => node([]);
        if (key === "then") return undefined;
        return node([...path, key]);
      },
      apply() { return node(path); },
    });
  return { trpc: node([]) };
});
vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, tError: (key: string) => key, locale: "en", isArabic: false }),
  useMoney: () => (amount: string) => amount,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false, user: { id: 2 } }) }));
vi.mock("@/contexts/CartContext", () => ({
  useCart: () => ({
    cart: { id: "c1", subtotal: { amount: "10.000" }, total: { amount: "11.000" }, delivery: { total: { amount: "1.000" } } },
    skip: [],
  }),
}));
vi.mock("@/lib/bagSavings", () => ({
  useSavings: () => ({ code: "", giftCard: "", usePoints: false }),
  setSavings: () => {},
}));

const { useSavingsBill, PointsSwitch } = await import("./BagSavings");

function Box() {
  const bill = useSavingsBill({ withBalance: true });
  return createElement(PointsSwitch, { bill });
}

function draw() {
  return renderToStaticMarkup(createElement(Router, { ssrPath: "/checkout" }, createElement(Box)));
}

describe("checkout's points, when the balance could not be read", () => {
  /* The box pulsed for good on the web, and the app said "no points". */
  it("says so with Try again, never a pulse for good or no points", () => {
    reads["rewards.mine"] = { data: undefined, isError: true, isSuccess: false, isPending: false, isPlaceholderData: false, refetch: () => {} };
    const html = draw();
    expect(html).toContain("account.sectionFailed");
    expect(html).toContain("home.refreshCatalog");
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toContain("cart.noPoints");
  });

  it("keeps a balance already read when asking again fails", () => {
    reads["rewards.mine"] = { data: { balance: 0 }, isError: true, isSuccess: false, isPending: false, isPlaceholderData: false, refetch: () => {} };
    const html = draw();
    expect(html).toContain("cart.noPoints");
    expect(html).not.toContain("account.sectionFailed");
  });

  it("waits quietly while the balance is first read", () => {
    reads["rewards.mine"] = quiet;
    const html = draw();
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("cart.noPoints");
  });
});
