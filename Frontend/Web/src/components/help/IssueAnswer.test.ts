import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";

vi.mock("@/lib/trpc", () => {
  const mutation = { mutate: () => {}, mutateAsync: async () => ({}), isPending: false };
  const node = (): unknown =>
    new Proxy(() => {}, {
      get(_target, key: string) {
        if (key === "useMutation") return () => mutation;
        if (key === "useUtils") return () => node();
        if (key === "then") return undefined;
        return node();
      },
      apply() { return node(); },
    });
  return { trpc: node() };
});
vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, tError: (key: string) => key, locale: "en", isArabic: false }),
}));
vi.mock("@/hooks/useDateFormat", () => ({ useDateFormat: () => () => "1 Nov" }));

const { IssueAnswer } = await import("./IssueCentre");

function draw(answer: Record<string, unknown>) {
  return renderToStaticMarkup(createElement(Router, { ssrPath: "/help" }, createElement(IssueAnswer, {
    answer: { isLoading: false, isError: false, error: null, data: undefined, refetch: () => {}, ...answer } as never,
    pickingItem: false,
    reference: "NL-20261101-QRTVW",
    issue: "late",
    lineId: null,
    done: [],
    onPickItem: () => {},
    onOpen: () => {},
    onDone: () => {},
  })));
}

describe("help's answer to an issue", () => {
  /* An answer that could not be read left a sentence and no way on: the
     person was drawn only beside an answer. */
  it("keeps a person one press away when the answer could not be read", () => {
    const html = draw({ isError: true, error: { message: "error.serverProblem" } });
    expect(html).toContain("error.serverProblem");
    expect(html).toContain("home.refreshCatalog");
    expect(html).toContain("orderHelp.toPerson");
    expect(html).toContain("orderHelp.personNext");
  });

  it("offers no person while the answer is being read", () => {
    const html = draw({ isLoading: true });
    expect(html).not.toContain("home.refreshCatalog");
    expect(html).not.toContain("orderHelp.toPerson");
  });
});
