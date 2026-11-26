import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";

/* What the deletion check and the account's ways in answer, set by each
   case; anything else is a read still waiting or a mutation unused. */
const state = vi.hoisted(() => ({ check: {} as Record<string, unknown>, ways: {} as Record<string, unknown> }));

vi.mock("@/lib/trpc", () => {
  const quiet = { data: undefined, isError: false, isSuccess: false, isLoading: true, refetch: () => {} };
  const mutation = { mutate: () => {}, mutateAsync: async () => {}, isPending: false, reset: () => {} };
  const node = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get(_target, key: string) {
        if (key === "useQuery") {
          return () => {
            const name = path.join(".");
            if (name === "auth.deletionCheck") return state.check;
            if (name === "auth.myProviders") return state.ways;
            return quiet;
          };
        }
        if (key === "useMutation") return () => mutation;
        if (key === "useUtils") return () => node([]);
        if (key === "then") return undefined;
        return node([...path, key]);
      },
      apply() {
        return undefined;
      },
    });
  return { trpc: node([]) };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ logout: async () => {}, user: { id: 2, phone: null } }) }));
vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: "en", isArabic: false }),
}));

const { DeleteAccount } = await import("./DeleteAccount");

function draw() {
  return renderToStaticMarkup(createElement(Router, { ssrPath: "/account/details" }, createElement(DeleteAccount)));
}

const answered = (data: unknown) => ({ isError: false, isSuccess: true, isLoading: false, data, refetch: () => {} });
const failed = { isError: true, isSuccess: false, isLoading: false, data: undefined, refetch: () => {} };

describe("DeleteAccount", () => {
  /* With the check unread the delete button was live: pressed, it opened the
     password's confirmation over blockers it had not heard and an Apple
     account whose way in it had not read. */
  it("says the check could not be read, with Try again, rather than a delete button", () => {
    state.check = failed;
    state.ways = answered({ password: true, apple: false, google: false });
    const html = draw();
    expect(html).toContain("account.sectionFailed");
    expect(html).toContain("home.refreshCatalog");
    expect(html).not.toContain("account.deleteStart");
  });

  it("says so too when how the account signs in could not be read", () => {
    state.check = answered({ blockers: [], points: 0 });
    state.ways = failed;
    const html = draw();
    expect(html).toContain("account.sectionFailed");
    expect(html).not.toContain("account.deleteStart");
  });

  it("offers the delete once both are read and nothing stands in the way", () => {
    state.check = answered({ blockers: [], points: 0 });
    state.ways = answered({ password: true, apple: false, google: false });
    const html = draw();
    expect(html).toContain("account.deleteStart");
    expect(html).not.toContain("account.sectionFailed");
  });

  it("names what stands in the way", () => {
    state.check = answered({ blockers: ["orderOpen"], points: 0 });
    state.ways = answered({ password: true, apple: false, google: false });
    expect(draw()).toContain("account.deleteBlocked.orderOpen");
  });
});
