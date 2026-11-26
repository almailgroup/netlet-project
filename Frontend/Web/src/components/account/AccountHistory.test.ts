import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";

/* What reading the history back answers, set by each case; the device holds
   two products' ids throughout. */
const state = vi.hoisted(() => ({ read: {} as Record<string, unknown> }));
vi.mock("@/lib/recentlyViewed", () => ({
  viewedIds: () => ["12", "40"],
  forgetViewed: () => [],
  clearViewed: () => {},
  VIEWED_DAYS: 90,
}));
vi.mock("@/hooks/useCatalog", () => ({ useProductsByIds: () => state.read }));
vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: "en", isArabic: false }),
  useMoney: () => () => "KWD 1.000",
}));
vi.mock("@/components/ui/ConfirmRemoval", () => ({ useConfirmRemoval: () => async () => true }));

const { AccountHistory } = await import("./AccountHistory");

function draw() {
  return renderToStaticMarkup(createElement(Router, { ssrPath: "/account/history" }, createElement(AccountHistory)));
}

const refetch = () => {};

describe("AccountHistory", () => {
  beforeEach(() => {
    state.read = {};
  });

  /* The device holds a history; the shop not answering for it is not an
     empty one. It was the selection row over no rows. */
  it("says the history could not be read back, with Try again", () => {
    state.read = {
      byId: new Map(),
      settled: false,
      query: { isError: true, data: [], isPlaceholderData: true, refetch },
    };
    const html = draw();
    expect(html).toContain("history.loadFailed");
    expect(html).toContain("home.refreshCatalog");
    expect(html).not.toContain("history.empty");
    expect(html).not.toContain("select.all");
  });

  it("is empty when the shop answered and shows none of them", () => {
    state.read = {
      byId: new Map(),
      settled: true,
      query: { isError: false, isSuccess: true, data: [], isPlaceholderData: false, refetch },
    };
    const html = draw();
    expect(html).toContain("history.empty");
    expect(html).not.toContain("history.loadFailed");
  });
});
