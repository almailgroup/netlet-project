/**
 * Terminating tRPC link for the static demo build (GitHub Pages).
 *
 * The real client posts every procedure call to `/api/trpc`, served by the
 * Express router in `server/_core/index.ts`. A static host has no such endpoint,
 * so this link resolves the same procedures locally against `demoCatalog`.
 *
 * It is swapped in for `httpBatchLink` in main.tsx only when the build sets
 * VITE_DEMO_MODE, so the normal full-stack build is untouched. Because this link
 * terminates in the browser, no superjson serialization is involved — the values
 * returned here are handed straight to React Query.
 */
import type { Cart, CartItem, Money } from "@shared/commerce/types";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "../../../server/routers";
import { demoCatalog, demoProductByHandle, demoVariant } from "./demoCatalog";

const CART_STORAGE_KEY = "netlet-demo-cart";
const CURRENCY = "KWD";

/* ------------------------------------------------------------------ cart --- */

/** Cart totals are summed in fils (integer minor units) to avoid float drift. */
function toFils(value: Money): number {
  return Math.round(Number.parseFloat(value.amount) * 1000);
}

function fromFils(fils: number): Money {
  return { amount: (fils / 1000).toFixed(2), currencyCode: CURRENCY };
}

function emptyCart(id: string): Cart {
  return {
    id,
    // No real checkout exists in the demo; Checkout.tsx is a local route and the
    // bag's "continue" button navigates there rather than opening this URL.
    checkoutUrl: "",
    items: [],
    itemCount: 0,
    subtotal: fromFils(0),
    total: fromFils(0),
  };
}

function recalculate(cart: Cart): Cart {
  const items = cart.items.map(item => ({
    ...item,
    lineTotal: fromFils(toFils(item.unitPrice) * item.quantity),
  }));
  const subtotalFils = items.reduce(
    (sum, item) => sum + toFils(item.lineTotal),
    0
  );
  return {
    ...cart,
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: fromFils(subtotalFils),
    total: fromFils(subtotalFils),
  };
}

function readCart(): Cart | null {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Cart) : null;
  } catch {
    return null;
  }
}

function writeCart(cart: Cart): Cart {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch {
    // Storage unavailable (private mode / blocked cookies) — the cart still
    // works for this page view, it just won't survive a reload.
  }
  return cart;
}

function requireCart(cartId: string): Cart {
  const stored = readCart();
  if (!stored || stored.id !== cartId) {
    throw new TRPCClientError("This demo cart is no longer available.");
  }
  return stored;
}

function buildLine(variantId: string, quantity: number): CartItem {
  const found = demoVariant(variantId);
  if (!found) throw new TRPCClientError(`Unknown demo variant: ${variantId}`);
  const { product, variant } = found;
  return {
    lineId: `demo-line-${variantId}`,
    variantId,
    productHandle: product.handle,
    productTitle: product.title,
    variantTitle: variant.title,
    image: product.images[0] ?? null,
    unitPrice: variant.price,
    quantity,
    lineTotal: fromFils(toFils(variant.price) * quantity),
  };
}

function addLines(
  cart: Cart,
  lines: Array<{ variantId: string; quantity: number }>
): Cart {
  const items = [...cart.items];
  for (const line of lines) {
    const existing = items.findIndex(item => item.variantId === line.variantId);
    if (existing >= 0) {
      items[existing] = {
        ...items[existing],
        quantity: items[existing].quantity + line.quantity,
      };
    } else {
      items.push(buildLine(line.variantId, line.quantity));
    }
  }
  return recalculate({ ...cart, items });
}

/* ------------------------------------------------------------ procedures --- */

type Input = Record<string, unknown> | undefined;

function resolve(path: string, rawInput: unknown): unknown {
  const input = (rawInput ?? {}) as Input & Record<string, any>;

  switch (path) {
    /* The demo is always a signed-out guest: there is no OAuth provider to
       return to, and CustomerContext/CartContext already have guest fallbacks
       backed by localStorage. Returning null keeps every `enabled:
       isAuthenticated` query switched off rather than failing. */
    case "auth.me":
      return null;
    case "auth.logout":
      return { success: true } as const;

    case "commerce.products.list": {
      const first =
        typeof input.first === "number" ? input.first : demoCatalog.length;
      return demoCatalog.slice(0, first);
    }
    case "commerce.products.byHandle":
      return demoProductByHandle(String(input.handle ?? ""));

    case "commerce.collections.list":
      return [];
    case "commerce.collections.byHandle":
      return null;

    case "commerce.cart.create": {
      const cart = emptyCart(`demo-cart-${Date.now()}`);
      const lines = (input.lines ?? []) as Array<{
        variantId: string;
        quantity: number;
      }>;
      return writeCart(addLines(cart, lines));
    }
    case "commerce.cart.get": {
      const stored = readCart();
      return stored && stored.id === input.cartId ? stored : null;
    }
    case "commerce.cart.addLines": {
      const cart = requireCart(String(input.cartId));
      const lines = (input.lines ?? []) as Array<{
        variantId: string;
        quantity: number;
      }>;
      return writeCart(addLines(cart, lines));
    }
    case "commerce.cart.updateLines": {
      const cart = requireCart(String(input.cartId));
      const updates = (input.lines ?? []) as Array<{
        lineId: string;
        quantity: number;
      }>;
      const items = cart.items
        .map(item => {
          const update = updates.find(
            candidate => candidate.lineId === item.lineId
          );
          return update ? { ...item, quantity: update.quantity } : item;
        })
        // A quantity of 0 removes the line, matching the Shopify cart contract.
        .filter(item => item.quantity > 0);
      return writeCart(recalculate({ ...cart, items }));
    }
    case "commerce.cart.removeLines": {
      const cart = requireCart(String(input.cartId));
      const lineIds = (input.lineIds ?? []) as string[];
      const items = cart.items.filter(item => !lineIds.includes(item.lineId));
      return writeCart(recalculate({ ...cart, items }));
    }

    /* The live version asks Mistral to rewrite the query against the catalog.
       There is no API key in a static build, so fall back to the shopper's own
       words — LiveSearch already filters the catalog locally with them. */
    case "search.refine": {
      const query = String(input.query ?? "").trim();
      const terms = query.split(/\s+/).filter(Boolean).slice(0, 5);
      return { query, terms };
    }

    /* Guest mode means these never fire (they are gated on isAuthenticated),
       but answering with empty state keeps a stray call from surfacing an
       error toast in the demo. */
    case "customer.profile.get":
      return null;
    case "customer.saved.list":
    case "customer.notifications.list":
    case "customer.tracking.list":
    case "customer.follows.list":
      return [];
    // Nobody is signed in to be waiting, so the demand line stays off.
    case "customer.follows.demand":
      return 0;
    case "customer.profile.update":
    case "customer.saved.set":
    case "customer.notifications.set":
    case "customer.follows.set":
      return { success: true } as const;

    default:
      throw new TRPCClientError(`${path} is not available in the static demo.`);
  }
}

export const demoLink: TRPCLink<AppRouter> =
  () =>
  ({ op }) =>
    observable(observer => {
      try {
        observer.next({ result: { data: resolve(op.path, op.input) } });
        observer.complete();
      } catch (error) {
        observer.error(
          error instanceof TRPCClientError
            ? (error as TRPCClientError<AppRouter>)
            : (TRPCClientError.from(
                error as Error
              ) as TRPCClientError<AppRouter>)
        );
      }
      return () => {};
    });
