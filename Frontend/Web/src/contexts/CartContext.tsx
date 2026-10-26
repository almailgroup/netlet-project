import { readStored, removeStored, writeStored } from "@/lib/browserStore";
import { appPath } from "@/lib/basePath";
import { navigateWhenReady } from "@/lib/readyNavigation";
import { trpc } from "@/lib/trpc";
import { applyBagOp, ghostLine, realLineId, type BagOp } from "@/lib/bagOps";
import { useAuth } from "@/hooks/useAuth";
import type { Cart, Product } from "@shared/commerce/types";
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
 *
 * **A press changes the bag at once; the server's answer settles it.** Every
 * change goes into one queue and is sent in order, one at a time, so two fast
 * presses on plus cannot land the wrong way round; the bag drawn is the
 * server's last answer with every press still waiting applied over it
 * (`lib/bagOps.ts`). A refusal drops that press and reads the bag again, and
 * the promise each change returns still rejects, so the caller's toast is
 * unchanged. Presses on plus that have not been sent yet are folded into one.
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

type AddOptions = {
  /**
   * Whether the drawer opens on top. It does by default, because on a product
   * page the drawer *is* the confirmation. On the gift list it is not:
   * somebody choosing three presents for one person would have to dismiss the
   * whole bag between each, so that page passes false and confirms with a
   * toast instead.
   */
  reveal?: boolean;
  /**
   * The optional extras the shopper ticked (3.1.2). Ids only: the price is the
   * catalog's, and anything a browser says about money is discarded
   * server-side.
   */
  addonIds?: string[];
  bundleId?: number;
  /**
   * The product the press was on, so its plain line can be drawn in the bag
   * before the server has made it. Without it the count still moves at once
   * and the line appears with the answer.
   */
  product?: Product;
};

/** A change waiting its turn: one of the bag's presses, a line's door, or a fresh read. */
type Change =
  | BagOp
  | { kind: "destination"; lineId: string; addressId: number | null }
  | { kind: "speed"; lineId: string; choice: "regular" | "fast" }
  | { kind: "refresh" };

type Entry = { change: Change; sent: boolean; done: Promise<void>; resolve: () => void; reject: (error: unknown) => void };

function entryFor(change: Change): Entry {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const done = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  /* Nobody awaiting a refresh should see an unhandled rejection. */
  done.catch(() => undefined);
  return { change, sent: false, done, resolve, reject };
}

type CartContextValue = {
  cart: Cart | null;
  isOpen: boolean;
  /** A read or a change is with the server. */
  loading: boolean;
  /**
   * The bag drawn includes presses the server has not answered yet, so the
   * delivery and the total are the last ones it gave. The summary draws them
   * as updating, and checkout waits for it to clear before an order is placed.
   */
  syncing: boolean;
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
  /** Add a line to the bag. Resolves when the server has it; the bag shows it at once. */
  addItem: (variantId: string, quantity?: number, options?: AddOptions) => Promise<void>;
  updateQuantity: (lineId: string, quantity: number) => Promise<void>;
  removeItem: (lineId: string) => Promise<void>;
  /** Where this line goes (3.2.6). Null puts it back on the order's address. */
  setDestination: (lineId: string, addressId: number | null) => Promise<void>;
  /** Fast or regular for this line (3.2.5); the quote moves with it. */
  setDeliveryChoice: (lineId: string, choice: "regular" | "fast") => Promise<void>;
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
  const [cartId, setCartIdState] = useState<string | null>(() => readStoredCartId());
  /* The bag as the server last answered it; what is drawn adds the presses still waiting. */
  const [serverCart, setServerCartState] = useState<Cart | null>(null);
  const [waiting, setWaiting] = useState<Change[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  /* A stored bag still on its way from the server: not empty, not yet known. */
  const [hydrating, setHydrating] = useState(() => readStoredCartId() !== null);

  const utils = trpc.useUtils();
  const { isAuthenticated } = useAuth();
  const accountProfile = trpc.customer.profile.get.useQuery(undefined, { enabled: isAuthenticated });
  const updateProfile = trpc.customer.profile.update.useMutation();
  const accountCartHydrated = useRef(false);

  /* What the queue reads when a change is sent, which may be long after it was pressed. */
  const cartIdRef = useRef(cartId);
  const serverCartRef = useRef<Cart | null>(null);
  const signedInRef = useRef(isAuthenticated);
  signedInRef.current = isAuthenticated;
  const updateProfileRef = useRef(updateProfile);
  updateProfileRef.current = updateProfile;
  const queue = useRef<Entry[]>([]);
  const pumping = useRef(false);
  /* Changes wait for a stored bag to be read, or the first Add would start a second bag. */
  const hydration = useRef<Promise<void>>(Promise.resolve());

  const setCartId = useCallback((value: string | null) => {
    cartIdRef.current = value;
    writeStoredCartId(value);
    setCartIdState(value);
  }, []);
  const setServerCart = useCallback((value: Cart | null) => {
    serverCartRef.current = value;
    setServerCartState(value);
  }, []);

  /* Whether this tab has seen a signed-in shopper, so a sign-out can be told
     apart from a guest who never signed in. */
  const wasSignedIn = useRef(false);

  /** Send one change and answer with the bag the server now has. */
  const send = useCallback(async (change: Change): Promise<Cart | null> => {
    const id = cartIdRef.current;
    const current = serverCartRef.current;
    const client = utils.client.commerce.cart;
    switch (change.kind) {
      case "add": {
        const lines = [{ variantId: change.variantId, quantity: change.quantity, addonIds: change.addonIds, bundleId: change.bundleId }];
        const updated = id ? await client.addLines.mutate({ cartId: id, lines }) : null;
        if (updated) return updated;
        /* No bag yet, or the stored one has gone: this press starts one. */
        const created = await client.create.mutate({ lines });
        if (!created) return current;
        serverCartRef.current = created;
        setCartId(created.id);
        if (signedInRef.current) updateProfileRef.current.mutate({ cartId: created.id });
        return created;
      }
      case "set":
      case "remove": {
        const lineId = realLineId(current, change.lineId);
        if (!id || !lineId) return current;
        const updated = change.kind === "set"
          ? await client.updateLines.mutate({ cartId: id, lines: [{ lineId, quantity: change.quantity }] })
          : await client.removeLines.mutate({ cartId: id, lineIds: [lineId] });
        return updated ?? current;
      }
      case "destination": {
        const lineId = realLineId(current, change.lineId);
        if (!id || !lineId) return current;
        return (await client.setDestination.mutate({ cartId: id, lineId, addressId: change.addressId })) ?? current;
      }
      case "speed": {
        const lineId = realLineId(current, change.lineId);
        if (!id || !lineId) return current;
        return (await client.setDeliveryChoice.mutate({ cartId: id, lineId, choice: change.choice })) ?? current;
      }
      case "refresh": {
        if (!id) return current;
        return (await utils.commerce.cart.get.fetch({ cartId: id }, { staleTime: 0 }).catch(() => null)) ?? current;
      }
    }
  }, [setCartId, utils]);

  /** Send what is waiting, one change at a time, in the order pressed. */
  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    let refused = false;
    while (queue.current.length) {
      const entry = queue.current[0];
      entry.sent = true;
      try {
        await hydration.current;
        const next = await send(entry.change);
        queue.current.shift();
        setServerCart(next);
        setWaiting(queue.current.map(waitingEntry => waitingEntry.change));
        entry.resolve();
      } catch (error) {
        queue.current.shift();
        setWaiting(queue.current.map(waitingEntry => waitingEntry.change));
        refused = true;
        entry.reject(error);
      }
    }
    pumping.current = false;
    /* A refusal may have been half done — a dropped connection after the
       server wrote — so the bag is read again rather than assumed. */
    if (refused && cartIdRef.current) {
      const fresh = await utils.commerce.cart.get.fetch({ cartId: cartIdRef.current }, { staleTime: 0 }).catch(() => null);
      if (fresh && !queue.current.length) setServerCart(fresh);
    }
  }, [send, setServerCart, utils.commerce.cart.get]);

  const enqueue = useCallback((change: Change): Promise<void> => {
    /* Presses on one line's stepper that have not gone yet are one change. */
    const last = queue.current.at(-1);
    if (last && !last.sent && last.change.kind === "set" && (change.kind === "set" || change.kind === "remove") && last.change.lineId === change.lineId) {
      last.change = change;
      setWaiting(queue.current.map(entry => entry.change));
      return last.done;
    }
    const entry = entryFor(change);
    queue.current.push(entry);
    setWaiting(queue.current.map(waitingEntry => waitingEntry.change));
    void pump();
    return entry.done;
  }, [pump]);

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
        setCartId(null);
        setServerCart(null);
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
          if (kept !== cartId) setCartId(kept);
          /* Claimed: read it again, so prices that follow the shopper —
             an agreed price, a member's — appear in the bag now. */
          else void enqueue({ kind: "refresh" });
        },
      });
    } else if (accountProfile.data.cartId) {
      setCartId(accountProfile.data.cartId);
    }
  }, [accountProfile.data, cartId, enqueue, isAuthenticated, setCartId, setServerCart, updateProfile]);

  // Re-hydrate cart on mount or whenever cartId changes.
  useEffect(() => {
    if (!cartId) {
      setServerCart(null);
      setHydrating(false);
      return;
    }
    /* The bag this tab just made is already the one drawn. */
    if (serverCartRef.current?.id === cartId) {
      setHydrating(false);
      return;
    }
    let cancelled = false;
    setHydrating(true);
    const read = utils.commerce.cart.get
      .fetch({ cartId })
      .then(c => {
        if (cancelled) return;
        if (c) setServerCart(c);
        // Stored cart id no longer valid — drop it.
        else setCartId(null);
      })
      .catch(() => {
        if (!cancelled) setCartId(null);
      })
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });
    hydration.current = read;
    return () => {
      cancelled = true;
    };
  }, [cartId, setCartId, setServerCart, utils.commerce.cart.get]);

  const cart = useMemo(
    () => waiting.reduce<Cart | null>((bag, change) => (change.kind === "destination" || change.kind === "speed" || change.kind === "refresh" ? bag : applyBagOp(bag, change)), serverCart),
    [serverCart, waiting],
  );
  const itemCount = cart?.itemCount ?? 0;
  const syncing = waiting.some(change => change.kind !== "refresh");
  const loading = hydrating || waiting.length > 0;

  const openCart = useCallback(() => setIsOpen(true), []);
  const closeCart = useCallback(() => setIsOpen(false), []);

  const addItem = useCallback(
    (variantId: string, quantity: number = 1, { reveal = true, addonIds = [], bundleId, product }: AddOptions = {}) => {
      /* Only the plain line can be drawn ahead: an extra or a set is priced by the server. */
      const ghost = product && !addonIds.length && bundleId === undefined ? ghostLine(product, variantId, quantity) : null;
      const done = enqueue({ kind: "add", variantId, quantity, ghost, addonIds, bundleId });
      if (reveal) setIsOpen(true);
      return done;
    },
    [enqueue]
  );

  const updateQuantity = useCallback(
    (lineId: string, quantity: number) => (quantity <= 0 ? enqueue({ kind: "remove", lineId }) : enqueue({ kind: "set", lineId, quantity })),
    [enqueue]
  );

  const removeItem = useCallback((lineId: string) => enqueue({ kind: "remove", lineId }), [enqueue]);

  /**
   * Send one line to a different door (3.2.6).
   *
   * Through the same queue as every other line change, so the bag the whole
   * app reads is the one that came back — the delivery quote moves when a line
   * moves, since a parcel is a seller *and* a destination, and a page holding
   * a stale quote would show a total the bill then disagrees with.
   */
  const setDestination = useCallback(
    (lineId: string, addressId: number | null) => enqueue({ kind: "destination", lineId, addressId }),
    [enqueue]
  );

  /* Through the queue for `setDestination`'s reason: the delivery quote moves with it. */
  const setDeliveryChoice = useCallback(
    (lineId: string, choice: "regular" | "fast") => enqueue({ kind: "speed", lineId, choice }),
    [enqueue]
  );

  /* In the queue, so a read cannot overtake a change still on its way. */
  const refreshCart = useCallback(() => enqueue({ kind: "refresh" }).catch(() => undefined), [enqueue]);

  const clearCart = useCallback(() => {
    setCartId(null);
    setServerCart(null);
    if (isAuthenticated) updateProfile.mutate({ cartId: null });
  }, [isAuthenticated, setCartId, setServerCart, updateProfile]);

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
   * Presses still on their way go with it: checkout draws the same bag and
   * waits for them before it lets an order be placed.
   */
  const proceedToCheckout = useCallback(() => {
    if (!cart?.items.length) return;
    setIsOpen(false);
    navigateWhenReady(appPath(cart.checkoutUrl));
  }, [cart]);

  const settling = hydrating || (syncing && !cart?.items.length);

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      isOpen,
      loading,
      syncing,
      settling,
      itemCount,
      openCart,
      closeCart,
      addItem,
      updateQuantity,
      removeItem,
      setDestination,
      setDeliveryChoice,
      clearCart,
      refreshCart,
      proceedToCheckout,
    }),
    [
      cart,
      isOpen,
      loading,
      syncing,
      settling,
      itemCount,
      openCart,
      closeCart,
      addItem,
      updateQuantity,
      removeItem,
      setDestination,
      setDeliveryChoice,
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
