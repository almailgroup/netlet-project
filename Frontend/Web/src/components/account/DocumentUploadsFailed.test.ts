import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/* What myDocuments answers in this test. */
let documents: unknown;

vi.mock("@/lib/trpc", () => {
  const mutation = { mutate: () => {}, isPending: false };
  const node = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get(_target, key: string) {
        if (key === "useMutation") return () => mutation;
        if (key === "useQuery") return () => documents;
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
}));
vi.mock("@/components/ui/ConfirmRemoval", () => ({ useConfirmRemoval: () => async () => false }));

const { DocumentUploads } = await import("./DocumentUploads");

const draw = () => renderToStaticMarkup(createElement(DocumentUploads, { saved: true, editable: true }));

describe("an application's papers that could not be read", () => {
  /* Every row offered "Upload" as though nothing had been sent. */
  it("says so with Try again rather than offering every paper again", () => {
    documents = { data: undefined, isError: true, isPlaceholderData: false, refetch: () => {} };
    const html = draw();
    expect(html).toContain("account.sectionFailed");
    expect(html).toContain("home.refreshCatalog");
    expect(html).not.toContain("documents.upload");
  });

  it("offers each paper once the list is read", () => {
    documents = { data: [], isError: false, refetch: () => {} };
    expect(draw()).toContain("documents.upload");
  });
});
