import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/* "Save for later" took the line out of the bag whether or not the save
   had taken, so a refused save kept the product nowhere. */
const state = vi.hoisted(() => ({ kept: false, removed: [] as string[], saidSaved: 0 }));

vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => { state.saidSaved += 1; } } }));
vi.mock("@/hooks/useTranslation", () => ({ useTranslation: () => ({ t: (key: string) => key, tError: (m: string) => m, locale: "en", isArabic: false }) }));
vi.mock("@/hooks/useMemberCode", () => ({ useMemberCode: () => null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/hooks/useOverlay", () => ({ focusWhereTheShopperIs: () => {} }));
vi.mock("@/components/ui/ConfirmRemoval", () => ({ useAskRemoveFromCart: () => async () => true }));
vi.mock("@/components/cart/LinePopover", () => ({ LinePopover: () => null }));
vi.mock("@/components/product/ProductCard", () => ({ shareProduct: async () => {} }));
vi.mock("@/contexts/CartContext", () => ({
  useCart: () => ({
    removeItem: async (lineId: string) => { state.removed.push(lineId); },
    addItem: async () => {},
  }),
}));
vi.mock("@/contexts/CustomerContext", () => ({
  useCustomer: () => ({
    savedIds: [],
    saveForLater: async () => state.kept,
    chooseWishlist: () => {},
    unsave: () => {},
  }),
}));

/* The line hands focus on once it has left, after a tick. */
vi.stubGlobal("window", { setTimeout: (run: () => void) => setTimeout(run, 0) });

const { useLineActions } = await import("./LineMenu");

const item = { lineId: "L1", productId: "P1", variantId: "V1", quantity: 2, productHandle: "lamp" } as never;

async function saveForLater() {
  let actions: { key: string; run: () => void }[] = [];
  function Probe() {
    actions = useLineActions(item, "Brass lamp");
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  actions.find(action => action.key === "later")!.run();
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe("a line's Save for later", () => {
  it("keeps the line in the bag when the save did not take", async () => {
    state.kept = false;
    state.removed = [];
    state.saidSaved = 0;
    await saveForLater();
    expect(state.removed).toEqual([]);
    expect(state.saidSaved).toBe(0);
  });

  it("takes the line out once it is kept", async () => {
    state.kept = true;
    state.removed = [];
    state.saidSaved = 0;
    await saveForLater();
    expect(state.removed).toEqual(["L1"]);
    expect(state.saidSaved).toBe(1);
  });
});
