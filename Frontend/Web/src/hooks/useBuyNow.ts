/**
 * Buy now (3.2.9): put the item in the basket and go straight to checkout —
 * from the product page, the preview and the card alike.
 *
 * One function because four pages had a copy, and the copies shared three
 * faults: each opened the bag drawer on the way past, each then reloaded the
 * whole app with `window.location.assign` — a second or more on a phone, on the
 * press that exists to be fast — and each took `variants[0]` even when that
 * one was sold out and the next was not.
 *
 * The bag is skipped, not the basket: the item goes in like any other, so
 * leaving checkout finds it waiting rather than gone.
 */
import { useCallback } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useCart } from "@/contexts/CartContext";
import { useTranslation } from "@/hooks/useTranslation";
import type { Product } from "@shared/commerce/types";

export function useBuyNow() {
  const { addItem } = useCart();
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  return useCallback(
    async (product: Product, quantity = 1, variantId?: string) => {
      const variant = variantId
        ? product.variants.find(entry => entry.id === variantId)
        : product.variants.find(entry => entry.availableForSale);
      if (!variant?.availableForSale) {
        toast.error(t("cart.itemUnavailable"));
        return;
      }
      /* Checkout opens at once on the bag drawn ahead, and waits for the
         server to have the item before an order can be placed. */
      const added = addItem(variant.id, quantity, { reveal: false, product });
      navigate("/checkout");
      try {
        await added;
      } catch {
        toast.error(t("cart.buyFailed"));
      }
    },
    [addItem, navigate, t],
  );
}
