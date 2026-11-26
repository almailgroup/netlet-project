import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";

vi.mock("@/lib/trpc", () => {
  const mutation = { mutate: () => {}, isPending: false };
  const node = (): unknown =>
    new Proxy(() => {}, {
      get(_target, key: string) {
        if (key === "useMutation") return () => mutation;
        if (key === "then") return undefined;
        return node();
      },
    });
  return { trpc: node() };
});
vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: "en", isArabic: false }),
}));

const { PhoneCard } = await import("./WishlistManager");

function draw(current: string | null | undefined, failed = false) {
  return renderToStaticMarkup(
    createElement(Router, { ssrPath: "/saved" }, createElement(PhoneCard, { current, failed, onRetry: () => {}, onSaved: () => {} })),
  );
}

describe("the wishlists' phone card", () => {
  /* It drew the "add a number" form over a number the account holds
     whenever the read had not come back. */
  it("says the number could not be read, with Try again, rather than asking for one", () => {
    const html = draw(undefined, true);
    expect(html).toContain("account.sectionFailed");
    expect(html).toContain("home.refreshCatalog");
    expect(html).not.toContain("wish.phoneSave");
  });

  it("asks for nothing while the number is read", () => {
    const html = draw(undefined);
    expect(html).not.toContain("wish.phoneSave");
    expect(html).not.toContain("account.sectionFailed");
  });

  it("asks for a number once the account is known to hold none", () => {
    expect(draw(null)).toContain("wish.phoneSave");
  });

  it("shows the number the account holds", () => {
    const html = draw("55001122");
    expect(html).toContain("wish.phoneClear");
    expect(html).not.toContain("wish.phoneSave");
  });
});
