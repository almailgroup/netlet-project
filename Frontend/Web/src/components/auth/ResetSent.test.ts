import { describe, expect, it, vi } from "vitest";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/* The reset's "check your email" page drew no refusal, so a "Send it again"
   the server refused (the throttle) or that never reached it changed nothing
   and said nothing. */
vi.mock("@/lib/trpc", () => {
  const node = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get(_target, key: string) {
        if (key === "useMutation") return () => ({ mutate: () => {}, isPending: false });
        if (key === "useQuery") return () => ({ data: undefined, isLoading: false, isError: false });
        if (key === "useUtils") return () => node([]);
        if (key === "then") return undefined;
        return node([...path, key]);
      },
      apply() { return node(path); },
    });
  return { trpc: node([]) };
});
vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, tError: (message: string) => `said:${message}`, locale: "en", isArabic: false, dir: "ltr" }),
}));

const { ResetSent } = await import("./AuthForm");

function page(refusal: string | null) {
  return renderToStaticMarkup(createElement(ResetSent, {
    email: "noura@shop.test",
    Heading: "h1",
    headingId: "reset-sent",
    wait: 0,
    sending: false,
    refusal,
    headingRef: createRef<HTMLHeadingElement>(),
    onResend: () => {},
    onDifferent: () => {},
    onBack: () => {},
    onSignedIn: () => {},
    onVerify: () => {},
  }));
}

describe("the reset's sent page", () => {
  it("says a refused Send it again", () => {
    const html = page("auth.tooManyAttempts");
    expect(html).toContain('role="alert"');
    expect(html).toContain("said:auth.tooManyAttempts");
  });

  it("says nothing while nothing was refused", () => {
    expect(page(null)).not.toContain("said:");
  });
});
