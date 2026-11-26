import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";

vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: "en", isArabic: false }),
}));

const { PreviewTile } = await import("./AccountHome");

function tile(props: Record<string, unknown>) {
  return renderToStaticMarkup(createElement(Router, { ssrPath: "/account" }, createElement(PreviewTile, {
    href: "/account/orders", title: "My orders", photos: [], loading: false, empty: "orders.emptyTitle", waiting: null, ...props,
  } as never)));
}

describe("the account home's tiles", () => {
  /* A read that failed was drawn as the tile's empty line: "No orders yet"
     over an account with orders. */
  it("says the tile could not load, never its empty line, when its read failed", () => {
    const html = tile({ failed: "account.tileFailed" });
    expect(html).toContain("account.tileFailed");
    expect(html).not.toContain("orders.emptyTitle");
  });

  it("says the empty line once the account is known to hold none", () => {
    const html = tile({});
    expect(html).toContain("orders.emptyTitle");
    expect(html).not.toContain("account.tileFailed");
  });

  it("draws what it holds even when asking again failed", () => {
    const html = tile({ photos: ["/media/a.webp"], failed: "account.tileFailed" });
    expect(html).not.toContain("account.tileFailed");
    expect(html).not.toContain("orders.emptyTitle");
  });

  it("draws an outline while it is first read", () => {
    const html = tile({ loading: true });
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("orders.emptyTitle");
  });
});
