import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";

/* What the profile's details read answers, set by each case. Every other
   procedure answers nothing yet: this is about the details rows alone. */
const state = vi.hoisted(() => ({ details: {} as Record<string, unknown>, ways: null as Record<string, unknown> | null }));

vi.mock("@/lib/trpc", () => {
  const quiet = { data: undefined, isError: false, isSuccess: false, isLoading: true, refetch: () => {} };
  const mutation = { mutate: () => {}, mutateAsync: async () => {}, isPending: false, reset: () => {} };
  /* Any path down the client: `customer.details.get.useQuery` answers the
     case's state, anything else a read still waiting or a mutation unused. */
  const node = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get(_target, key: string) {
        if (key === "useQuery") return () => (path.join(".") === "customer.details.get" ? state.details : path.join(".") === "auth.myProviders" && state.ways ? state.ways : quiet);
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
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false, user: null }) }));
vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: "en", isArabic: false }),
}));
vi.mock("@/hooks/useDateFormat", () => ({ useDateFormat: () => () => "" }));

const { ProfileManager } = await import("./ProfileManager");

const user = { id: 2, email: "noura@example.com", phone: null, name: "Noura Al-Sabah", role: "user" };

function draw() {
  return renderToStaticMarkup(createElement(Router, { ssrPath: "/account/details" }, createElement(ProfileManager, { user })));
}

describe("ProfileManager's details", () => {
  /* While the details were read, and when the read failed, the phone and
     the gender and birthday read "Not added" — over a number the account
     holds — and their Edit opened an editor on blanks. */
  it("never says 'Not added' over details that could not be read, and offers Try again", () => {
    state.details = { isError: true, isSuccess: false, data: undefined, refetch: () => {} };
    const html = draw();
    expect(html).toContain("account.sectionFailed");
    expect(html).toContain("home.refreshCatalog");
    expect(html).not.toContain("profile.notAdded");
  });

  it("draws a quiet outline while the details are first read", () => {
    state.details = { isError: false, isSuccess: false, data: undefined, refetch: () => {} };
    const html = draw();
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("profile.notAdded");
    expect(html).not.toContain("account.sectionFailed");
  });

  it("says 'Not added' once the account is known to hold none", () => {
    state.details = {
      isError: false,
      isSuccess: true,
      data: { firstName: null, lastName: null, phone: null, gender: null, birthday: null },
      refetch: () => {},
    };
    expect(draw()).toContain("profile.notAdded");
  });

  it("keeps details already drawn when asking again fails", () => {
    state.details = {
      isError: true,
      isSuccess: false,
      data: { firstName: "Noura", lastName: "Al-Sabah", phone: "55001122", gender: "female", birthday: null },
      refetch: () => {},
    };
    const html = draw();
    expect(html).toContain("5500 1122");
    expect(html).not.toContain("account.sectionFailed");
  });
});

describe("ProfileManager's password row", () => {
  const read = { isError: false, isSuccess: true, data: { firstName: "Noura", lastName: null, phone: null, gender: null, birthday: null }, refetch: () => {} };

  /* It said "A password is set" with Change over an Apple, Google or phone
     account while how it signs in was read, and for good when that failed. */
  it("never says a password is set before it knows", () => {
    state.details = read;
    state.ways = { isError: true, isSuccess: false, data: undefined, refetch: () => {} };
    const failed = draw();
    expect(failed).not.toContain("profile.passwordIsSet");
    expect(failed).toContain("account.sectionFailed");
    state.ways = { isError: false, isSuccess: false, data: undefined, refetch: () => {} };
    expect(draw()).not.toContain("profile.passwordIsSet");
  });

  it("says no password for an account with none, and a password for one with one", () => {
    state.details = read;
    state.ways = { isError: false, isSuccess: true, data: { password: false, apple: true, google: false, phone: false }, refetch: () => {} };
    expect(draw()).toContain("profile.noPassword");
    state.ways = { isError: false, isSuccess: true, data: { password: true, apple: false, google: false, phone: false }, refetch: () => {} };
    expect(draw()).toContain("profile.passwordIsSet");
    state.ways = null;
  });
});
