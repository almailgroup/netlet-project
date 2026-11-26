import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";

vi.mock("@/lib/trpc", () => {
  const node = (): unknown =>
    new Proxy(() => {}, {
      get(_target, key: string) {
        if (key === "then") return undefined;
        return node();
      },
      apply() { return node(); },
    });
  return { trpc: node() };
});
vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: "en", isArabic: false }),
}));
vi.mock("@/contexts/CustomerContext", () => ({
  useCustomer: () => ({ savedIds: ["11", "12"], saveForLater: () => {}, savedUnread: false, readSavedAgain: () => {} }),
}));
vi.mock("@/components/ui/ConfirmRemoval", () => ({ useConfirmRemoval: () => async () => false }));
vi.mock("@/components/cart/SavedForLater", () => ({
  SavedCard: () => null,
  useSavedMoves: () => ({ move: () => {}, unsave: () => {}, wish: null, said: "" }),
}));
/* The hearts were read; the products behind them could not be. */
vi.mock("@/hooks/useCatalog", () => ({
  useProductsByIds: () => ({
    query: { isError: true, data: undefined, isPlaceholderData: false, refetch: () => {} },
    products: [],
    byId: new Map(),
    settled: false,
    missing: 0,
    waiting: false,
  }),
}));

const { SavedItems } = await import("./Saved");

describe("Saved items whose products could not be read", () => {
  /* It said "nothing saved yet" over two saved products. */
  it("says they could not be loaded, with Try again", () => {
    const html = renderToStaticMarkup(createElement(Router, { ssrPath: "/saved" }, createElement(SavedItems)));
    expect(html).toContain("saved.loadFailed");
    expect(html).toContain("home.refreshCatalog");
    expect(html).not.toContain("saved.emptyTitle");
    expect(html).not.toContain("saved.emptyPrompt");
  });
});
