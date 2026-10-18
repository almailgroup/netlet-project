import { readStored, removeStored, writeStored } from "@/lib/browserStore";
import { appPath } from "@/lib/basePath";
import { navigateWhenReady } from "@/lib/readyNavigation";
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
 *   `Shared/commerce/types` — which store is behind it is invisible.
 */

const CART_STORAGE_KEY = "commerce:cart-id";

/* Through `lib/browserStore`, because a browser with site data blocked throws
   on the getter rather than answering null — and a guest cart that cannot be
   remembered is a cart to rebuild, not a page to crash. */
const readStoredCartId = () => readStored(CART_STORAGE_KEY);

function writeStoredCartId(value: string | null) {
  if (value) writeStored(CART_STORAGE_KEY, value);
  else removeStored(CART_STORAGE_KEY);
}

type CartContextValue = {
  cart: Cart | null;
  isOpen: boolean;
  loading: boolean;
  /**
   * The bag is on its way and its contents are not known yet — a stored bag
   * still loading, or the first item being added. The drawer said "your bag is
   * empty" in that gap, which is the one thing a shopper who just pressed Add
   * cannot be told.
   */
  settling: boolean;
  itemCount: number;
  openCart: () => void;
  closeCart: () => void;
  /**
   * Add a line to the bag.
   *
   * `reveal` decides whether the drawer opens on top. It does by default,
   * because on a product page the drawer *is* the confirmation. On the gift
   * list it is not: somebody choosing three presents for one person would
   * have to dismiss the whole bag between each, so that page passes false and
   * confirms with a toast instead.
   */
  /**
   * `addonIds` are the optional extras the shopper ticked (3.1.2). Ids only:
   * the price is the catalog's, and anything a browser says about money is
   * discarded server-side.
   */
  addItem: (variantId: string, quantity?: number, reveal?: boolean, addonIds?: string[], bundleId?: number) => Promise<void>;
  updateQuantity: (lineId: string, quantity: number) => Promise<void>;
  removeItem: (lineId: string) => Promise<void>;
  /** Where this line goes (3.2.6). Null puts it back on the order's address. */
  setDestination: (lineId: string, addressId: number | null) => Promise<void>;
  clearCart: () => void;
  /**
   * Read the bag again from the server. The context holds its own copy, so
   * invalidating the query cache does not reach it: after an order was placed
   * the header went on saying "Cart (1)" and the drawer held what had just
   * been bought, until a reload.
   */
  refreshCart: () => Promise<void>;
  proceedToCheckout: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cartId, setCartId] = useState<string | null>(() => readStoredCartId());
  const [cart, setCart] = useState<Cart | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  /* A stored bag still on its way from the server: not empty, not yet known. */
  const [hydrating, setHydrating] = useState(() => readStoredCartId() !== null);

  const utils = trpc.useUtils();
  const { isAuthenticated } = useAuth();
  const accountProfile = trpc.customer.profile.get.useQuery(undefined, { enabled: isAuthenticated });
  const updateProfile = trpc.customer.profile.update.useMutation();
  const accountCartHydrated = useRef(false);

  /* Whether this tab has seen a signed-in shopper, so a sign-out can be told
     apart from a guest who never signed in. */
  const wasSignedIn = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      accountCartHydrated.current = false;
      /*
       * Signing out leaves the bag with the account, not on the device. It
       * stayed in this browser, so whoever used it next saw the last shopper's
       * bag — with their agreed and member prices on it — and signing in as
       * somebody else pointed that account at it. The account keeps the bag
       * and hands it back at the next sign-in.
       */
      if (wasSignedIn.current) {
        wasSignedIn.current = false;
        writeStoredCartId(null);
        setCartId(null);
        setCart(null);
      }
      return;
    }
    wasSignedIn.current = true;
    if (!accountProfile.data || accountCartHydrated.current) return;
    accountCartHydrated.current = true;
    // The bag filled before signing in wins over an older one on the account:
    // it is the one the shopper is looking at — when it can become theirs.
    // The server claims an unowned bag and refuses one that is somebody
    // else's, and answers with the bag the account has either way.
    if (cartId) {
      updateProfile.mutate({ cartId }, {
        onSuccess: profile => {
          const kept = profile?.cartId ?? null;
          if (kept !== cartId) {
            setCartId(kept);
            writeStoredCartId(kept);
          } else {
            /* Claimed: read it again, so prices that follow the shopper —
               an agreed price, a member's — appear in the bag now. */
            void utils.commerce.cart.get.fetch({ cartId }, { staleTime: 0 }).then(fresh => { if (fresh) setCart(fresh); });
          }
        },
      });
    } else if (accountProfile.data.cartId) {
      setCartId(accountProfile.data.cartId);
      writeStoredCartId(accountProfile.data.cartId);
    }
  }, [accountProfile.data, cartId, isAuthenticated, updateProfile, utils.commerce.cart.get]);

  // Re-hydrate cart on mount or whenever cartId changes.
  useEffect(() => {
    if (!cartId) {
      setCart(null);
      setHydrating(false);
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
        if (!cancelled) {
          setLoading(false);
          setHydrating(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cartId, utils.commerce.cart.get]);

  const itemCount = cart?.itemCount ?? 0;

  const openCart = useCallback(() => setIsOpen(true), []);
  const closeCart = useCallback(() => setIsOpen(false), []);

  const addItem = useCallback(
    async (variantId: string, quantity: number = 1, reveal: boolean = true, addonIds: string[] = [], bundleId?: number) => {
      setLoading(true);
      try {
        if (!cartId || !cart) {
          const created = await utils.client.commerce.cart.create.mutate({
            lines: [{ variantId, quantity, addonIds, bundleId }],
          });
          if (!created) return;
          setCart(created);
          setCartId(created.id);
          writeStoredCartId(created.id);
          if (isAuthenticated) updateProfile.mutate({ cartId: created.id });
        } else {
          const updated = await utils.client.commerce.cart.addLines.mutate({
            cartId,
            lines: [{ variantId, quantity, addonIds, bundleId }],
          });
          setCart(updated);
        }
        if (reveal) setIsOpen(true);
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

  /**
   * Send one line to a different door (3.2.6).
   *
   * Through the same context as every other line change, so the bag the whole
   * app reads is the one that came back — the delivery quote moves when a line
   * moves, since a parcel is a seller *and* a destination, and a page holding
   * a stale quote would show a total the bill then disagrees with.
   */
  const setDestination = useCallback(
    async (lineId: string, addressId: number | null) => {
      if (!cartId) return;
      setLoading(true);
      try {
        const updated = await utils.client.commerce.cart.setDestination.mutate({ cartId, lineId, addressId });
        if (updated) setCart(updated);
      } finally {
        setLoading(false);
      }
    },
    [cartId, utils.client]
  );

  const refreshCart = useCallback(async () => {
    if (!cartId) return;
    const fresh = await utils.commerce.cart.get.fetch({ cartId }, { staleTime: 0 }).catch(() => null);
    if (fresh) setCart(fresh);
  }, [cartId, utils.commerce.cart.get]);

  const clearCart = useCallback(() => {
    writeStoredCartId(null);
    setCartId(null);
    setCart(null);
    if (isAuthenticated) updateProfile.mutate({ cartId: null });
  }, [isAuthenticated, updateProfile]);

  // Checkout is a NetLet page now, not an external host, so this navigates
  // in place rather than opening a tab. The drawer closes first: coming back
  // from checkout to a drawer still hanging open is disorienting.
  /*
   * In-app, not a reload: `window.location.assign` threw the whole app away
   * and fetched it again on the press that leads to paying — the fault Buy now
   * had. This provider sits outside the router (it wraps it), so it navigates
   * the browser's own history with the base path on, which the router then
   * reads like any other move — waiting for checkout's code first, as every
   * link does (`readyNavigation`), so the bag never gives way to a blank.
   */
  const proceedToCheckout = useCallback(() => {
    if (!cart?.items.length) return;
    setIsOpen(false);
    navigateWhenReady(appPath(cart.checkoutUrl));
  }, [cart]);

  const settling = hydrating || (loading && !cart?.items.length);

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      isOpen,
      loading,
      settling,
      itemCount,
      openCart,
      closeCart,
      addItem,
      updateQuantity,
      removeItem,
      setDestination,
      clearCart,
      refreshCart,
      proceedToCheckout,
    }),
    [
      cart,
      isOpen,
      loading,
      settling,
      itemCount,
      openCart,
      closeCart,
      addItem,
      updateQuantity,
      removeItem,
      setDestination,
      clearCart,
      refreshCart,
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
