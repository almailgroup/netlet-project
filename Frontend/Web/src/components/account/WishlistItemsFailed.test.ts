import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";

/* What each read answers in this test, by its procedure's path. */
const reads: Record<string, unknown> = {};

vi.mock("@/lib/trpc", () => {
  const mutation = { mutate: () => {}, isPending: false };
  const node = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get(_target, key: string) {
        if (key === "useMutation") return () => mutation;
        if (key === "useQuery") return () => reads[path.join(".")];
        if (key === "useUtils") return () => node([]);
        if (key === "then") return undefined;
        return node([...path, key]);
      },
      apply() { return node(path); },
    });
  return { trpc: node([]) };
});
vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: "en", isArabic: false }),
}));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
/* The products on the list could not be read. */
const productsFailed = {
  query: { isError: true, data: undefined, isPlaceholderData: false, refetch: () => {} },
  products: [],
  byId: new Map(),
  settled: false,
  missing: 0,
  waiting: false,
};
vi.mock("@/hooks/useCatalog", () => ({ useProductsByIds: () => productsFailed }));

const { ListDetail } = await import("./WishlistManager");

const ok = (data: unknown) => ({ data, isLoading: false, isPending: false, isError: false, error: null, refetch: () => {} });
const failed = { data: undefined, isLoading: false, isPending: false, isError: true, error: { message: "down" }, refetch: () => {} };

function draw() {
  return renderToStaticMarkup(
    createElement(Router, { ssrPath: "/saved" }, createElement(ListDetail, { listId: 7, onBack: () => {} })),
  );
}

describe("a wishlist whose products could not be read", () => {
  /* It drew each item with no name under a photo that pulsed for good, and
     Add from Saved said "nothing saved" over saved products. */
  it("says so with Try again, and nothing waits for good", () => {
    reads["wishlists.get"] = ok({
      list: { id: 7, title: "Birthday", visibility: "private", ownerName: null },
      items: [{ id: 1, productId: "11", note: null, giftFrom: null }],
    });
    reads["customer.saved.list"] = ok(["22"]);
    const html = draw();
    expect(html).toContain("account.sectionFailed");
    expect(html).toContain("home.refreshCatalog");
    expect(html).not.toContain("wish.nothingSaved");
    expect(html).not.toContain("animate-pulse");
  });

  it("says Saved could not be read rather than that nothing is saved", () => {
    reads["wishlists.get"] = ok({
      list: { id: 7, title: "Birthday", visibility: "private", ownerName: null },
      items: [],
    });
    reads["customer.saved.list"] = failed;
    const html = draw();
    expect(html).toContain("account.sectionFailed");
    expect(html).not.toContain("wish.nothingSaved");
  });
});
