/**
 * What a tick circle in the bag does when it is unticked, on the owner's word
 * ("automatically move products to Save for Later when unchecked in the
 * cart"): the lines leave the bag for Saved — the hearts, which the cart lists
 * under Checkout as "Saved for later" with Move to cart — rather than staying
 * in the bag left out of this checkout. `untickPlan` in
 * `Shared/commerce/cartChoice.ts` decides which lines and whether Undo can put
 * them back; a line whose product the bag does not say is left out of
 * checkout as before.
 *
 * A move, not a removal, so it asks nothing first ("Removing asks first"
 * leaves moves alone); the toast says where they went and, where every line
 * can be added again as it was, offers Undo. The circle pressed is gone by the
 * next frame, so the keyboard goes to the page rather than to `<body>`.
 */
import { useCallback } from "react";
import { toast } from "sonner";
import { useCart } from "@/contexts/CartContext";
import { useCustomer } from "@/contexts/CustomerContext";
import { useTranslation } from "@/hooks/useTranslation";
import { lineTitle } from "@/lib/lineTitle";
import { untickPlan } from "@shared/commerce/cartChoice";

export function useUntickToSaved() {
  const { cart, choose, removeItem, addItem } = useCart();
  const { savedIds, saveForLater, unsave } = useCustomer();
  const { t, isArabic } = useTranslation();

  return useCallback((lineIds: string[]) => {
    const items = cart?.items ?? [];
    const plan = untickPlan(items, lineIds);
    if (plan.leave.length) choose(plan.leave, false);
    if (!plan.move.length) return;

    const moving = new Set(plan.move);
    const moved = items.filter(item => moving.has(item.lineId));
    const wasSaved = new Set(plan.productIds.filter(id => savedIds.includes(id)));
    for (const productId of plan.productIds) saveForLater(productId);
    let said = false;
    for (const line of moved) {
      void removeItem(line.lineId).catch(() => {
        if (said) return;
        said = true;
        toast.error(t("cart.updateFailed"));
      });
    }
    window.setTimeout(() => document.getElementById("main")?.focus({ preventScroll: true }), 0);

    const message = moved.length === 1
      ? t("cart.savedForLater", { name: lineTitle(moved[0], isArabic) })
      : t("cart.movedToSaved", { count: moved.length });
    toast.success(message, plan.undoable ? {
      action: {
        label: t("cart.undo"),
        onClick: () => {
          for (const productId of plan.productIds) if (!wasSaved.has(productId)) unsave(productId);
          for (const line of moved) {
            void addItem(line.variantId, line.quantity, { reveal: false }).catch(() => toast.error(t("cart.addFailed")));
          }
        },
      },
    } : undefined);
  }, [addItem, cart?.items, choose, isArabic, removeItem, saveForLater, savedIds, t, unsave]);
}
