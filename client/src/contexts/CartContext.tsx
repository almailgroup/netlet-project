import { appPath } from "@/lib/basePath";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import type { Cart } from "@shared/commerce/types";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Storefront cart context.
 *
 * - Talks ONLY to backend-agnostic `commerce.*` tRPC procedures.
 * - Persists the cart id in localStorage and rehydrates on mount, and mirrors
 *   it onto the account so a bag survives moving to another device.
 * - Exposes a tiny imperative surface to UI: addItem, updateQuantity,
 *   removeItem, openCart, proceedToCheckout. Everything is typed against
 *   `shared/commerce/types` — which store is behind it is invisible.
 */

const CART_STORAGE_KEY = "commerce:cart-id";

function readStoredCartId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(CART_STORAGE_KEY);
}

function writeStoredCartId(value: string | null) {
  if (typeof window === "undefined") return;
  if (value) window.localStorage.setItem(CART_STORAGE_KEY, value);
  else window.localStorage.removeItem(CART_STORAGE_KEY);
}

type CartContextValue = {
  cart: Cart | null;
  isOpen: boolean;
  loading: boolean;
  itemCount: number;
  openCart: () => void;
  closeCart: () => void;
  addItem: (variantId: string, quantity?: number) => Promise<void>;
  updateQuantity: (lineId: string, quantity: number) => Promise<void>;
  removeItem: (lineId: string) => Promise<void>;
  clearCart: () => void;
  proceedToCheckout: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cartId, setCartId] = useState<string | null>(() => readStoredCartId());
  const [cart, setCart] = useState<Cart | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const utils = trpc.useUtils();
  const { isAuthenticated } = useAuth();
  const accountProfile = trpc.customer.profile.get.useQuery(undefined, { enabled: isAuthenticated });
  const updateProfile = trpc.customer.profile.update.useMutation();
  const accountCartHydrated = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      accountCartHydrated.current = false;
      return;
    }
    if (!accountProfile.data || accountCartHydrated.current) return;
    accountCartHydrated.current = true;
    // The bag filled before signing in wins over an older one on the account:
    // it is the one the shopper is looking at.
    if (cartId) {
      updateProfile.mutate({ cartId });
    } else if (accountProfile.data.cartId) {
      setCartId(accountProfile.data.cartId);
      writeStoredCartId(accountProfile.data.cartId);
    }
  }, [accountProfile.data, cartId, isAuthenticated, updateProfile]);

  // Re-hydrate cart on mount or whenever cartId changes.
  useEffect(() => {
    if (!cartId) {
      setCart(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    utils.commerce.cart.get
      .fetch({ cartId })
      .then(c => {
        if (cancelled) return;
        if (c) setCart(c);
        else {
          // Stored cart id no longer valid — drop it.
          writeStoredCartId(null);
          setCartId(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        writeStoredCartId(null);
        setCartId(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cartId, utils.commerce.cart.get]);

  const itemCount = cart?.itemCount ?? 0;

  const openCart = useCallback(() => setIsOpen(true), []);
  const closeCart = useCallback(() => setIsOpen(false), []);

  const addItem = useCallback(
    async (variantId: string, quantity: number = 1) => {
      setLoading(true);
      try {
        if (!cartId || !cart) {
          const created = await utils.client.commerce.cart.create.mutate({
            lines: [{ variantId, quantity }],
          });
          if (!created) return;
          setCart(created);
          setCartId(created.id);
          writeStoredCartId(created.id);
          if (isAuthenticated) updateProfile.mutate({ cartId: created.id });
        } else {
          const updated = await utils.client.commerce.cart.addLines.mutate({
            cartId,
            lines: [{ variantId, quantity }],
          });
          setCart(updated);
        }
        setIsOpen(true);
      } finally {
        setLoading(false);
      }
    },
    [cart, cartId, isAuthenticated, updateProfile, utils.client]
  );

  const updateQuantity = useCallback(
    async (lineId: string, quantity: number) => {
      if (!cartId) return;
      setLoading(true);
      try {
        const updated = await utils.client.commerce.cart.updateLines.mutate({
          cartId,
          lines: [{ lineId, quantity }],
        });
        if (updated) setCart(updated);
      } finally {
        setLoading(false);
      }
    },
    [cartId, utils.client]
  );

  const removeItem = useCallback(
    async (lineId: string) => {
      if (!cartId) return;
      setLoading(true);
      try {
        const updated = await utils.client.commerce.cart.removeLines.mutate({
          cartId,
          lineIds: [lineId],
        });
        setCart(updated);
      } finally {
        setLoading(false);
      }
    },
    [cartId, utils.client]
  );

  const clearCart = useCallback(() => {
    writeStoredCartId(null);
    setCartId(null);
    setCart(null);
    if (isAuthenticated) updateProfile.mutate({ cartId: null });
  }, [isAuthenticated, updateProfile]);

  // Checkout is a NetLet page now, not an external host, so this navigates
  // in place rather than opening a tab. The drawer closes first: coming back
  // from checkout to a drawer still hanging open is disorienting.
  const proceedToCheckout = useCallback(() => {
    if (!cart?.items.length) return;
    setIsOpen(false);
    window.location.assign(appPath(cart.checkoutUrl));
  }, [cart]);

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      isOpen,
      loading,
      itemCount,
      openCart,
      closeCart,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
      proceedToCheckout,
    }),
    [
      cart,
      isOpen,
      loading,
      itemCount,
      openCart,
      closeCart,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
      proceedToCheckout,
    ]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
