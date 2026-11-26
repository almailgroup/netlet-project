import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/* A heart the server refused left the heart as it was under the press's own
   "Saved" or "Removed", with nothing after it. */
const shown = vi.hoisted(() => ({ errors: [] as string[] }));
const reads: Record<string, unknown> = { "customer.saved.list": ["7"], "wishlists.wishedIds": ["9"] };

vi.mock("sonner", () => ({ toast: { error: (text: string) => shown.errors.push(text), success: () => {} } }));
vi.mock("@/lib/trpc", () => {
  const node = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get(_target, key: string) {
        if (key === "useQuery") return () => ({ data: reads[path.join(".")], isError: false, isSuccess: true, refetch: () => {} });
        if (key === "useMutation")
          return () => ({
            mutate: (_input: unknown, options?: { onError?: (error: { message: string }) => void }) => options?.onError?.({ message: "Failed to fetch" }),
            mutateAsync: async () => { throw new Error("Failed to fetch"); },
            isPending: false,
          });
        if (key === "useUtils") return () => node([]);
        if (key === "then") return undefined;
        return node([...path, key]);
      },
      apply() { return node(path); },
    });
  return { trpc: node([]) };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true, unknown: false, loading: false, user: { id: 2 }, refresh: () => {} }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: () => {}, clear: () => {} }) }));

const { CustomerProvider, useCustomer } = await import("./CustomerContext");

function customer() {
  let value: ReturnType<typeof useCustomer> | undefined;
  function Probe() {
    value = useCustomer();
    return null;
  }
  renderToStaticMarkup(createElement(CustomerProvider, null, createElement(Probe)));
  return value!;
}

function pressHeart(productId: string) {
  let toggle: ((id: string) => unknown) | undefined;
  function Probe() {
    toggle = useCustomer().toggleSaved;
    return null;
  }
  renderToStaticMarkup(createElement(CustomerProvider, null, createElement(Probe)));
  return toggle!(productId);
}

describe("a heart the server refused", () => {
  it("says so when taking a product out of Saved", () => {
    shown.errors.length = 0;
    expect(pressHeart("7")).toBe("removed");
    expect(shown.errors).toEqual(["NetLet could not be reached. Try again in a moment."]);
  });

  it("says so when taking a product off the wishlists", () => {
    shown.errors.length = 0;
    expect(pressHeart("9")).toBe("unwished");
    expect(shown.errors).toHaveLength(1);
  });

  it("answers that Save for later did not take, and says so", async () => {
    shown.errors.length = 0;
    expect(await customer().saveForLater("12")).toBe(false);
    expect(shown.errors).toEqual(["NetLet could not be reached. Try again in a moment."]);
  });
});
