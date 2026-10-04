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
import { readStored, writeStored } from "@/lib/browserStore";
import type { Cart, CartItem, Money } from "@shared/commerce/types";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "../../../server/routers";
import { demoCategories, demoHealth, demoInventoryActor, demoInventoryProducts, demoLowStock, demoOverview, demoStockHistory } from "@/lib/demoInventory";
import { demoCatalog, demoProductByHandle, demoVariant } from "./demoCatalog";
import { DEFAULT_PAGE_SIZE } from "@shared/pagination";
import { MIN_CASH_OUT_POINTS, referralCodeFor } from "@shared/commerce/referral";
import { allOn, FEATURE_KEYS } from "@shared/features";

const CART_STORAGE_KEY = "netlet-demo-cart";
const CURRENCY = "KWD";

/* ------------------------------------------------------------------ cart --- */

/** Cart totals are summed in fils (integer minor units) to avoid float drift. */
function toFils(value: Money): number {
  return Math.round(Number.parseFloat(value.amount) * 1000);
}

function fromFils(fils: number): Money {
  return { amount: (fils / 1000).toFixed(3), currencyCode: CURRENCY };
}

function emptyCart(id: string): Cart {
  return {
    id,
    // The same path the server returns. It has to match: the bag's "continue"
    // button navigates to whatever this says, so an empty string here is a
    // button that silently does nothing.
    checkoutUrl: "/checkout",
    items: [],
    itemCount: 0,
    subtotal: fromFils(0),
    /* The demo catalogue's sellers charge nothing to deliver, which is the
       same branch a real store with no fee recorded takes — not a special
       case, so the empty state the bag draws is the honest one. */
    delivery: { perVendor: [], total: fromFils(0) },
    /* The demo's sellers take cash, which is the default a store that has
       recorded nothing gets — not a special case. */
    cod: { available: true as const },
    recovery: { remind: false as const },
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
    delivery: { perVendor: [], total: fromFils(0) },
    cod: { available: true as const },
    recovery: { remind: false as const },
    total: fromFils(subtotalFils),
  };
}

function readCart(): Cart | null {
  const raw = readStored(CART_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Cart;
  } catch {
    return null;
  }
}

function writeCart(cart: Cart): Cart {
  // Storage unavailable (private mode / blocked site data) — the cart still
  // works for this page view, it just won't survive a reload.
  writeStored(CART_STORAGE_KEY, JSON.stringify(cart));
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
    // The demo catalog is counted throughout; see demoCatalog.ts.
    measure: { unit: "each" as const, stepAmount: 1 },
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

/**
 * A whole fixture list, in the paged shape the server now answers with.
 *
 * The demo never has enough rows to need a second page, but the *shape* has to
 * match or the portal reads `.rows` off an array and renders nothing — which
 * is exactly the drift this file exists to avoid.
 */
const onePage = <T>(rows: T[]) => ({ rows, total: rows.length, page: 1, pageSize: DEFAULT_PAGE_SIZE });

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
        // A quantity of 0 removes the line, matching the cart contract.
        .filter(item => item.quantity > 0);
      return writeCart(recalculate({ ...cart, items }));
    }
    case "commerce.cart.removeLines": {
      const cart = requireCart(String(input.cartId));
      const lineIds = (input.lineIds ?? []) as string[];
      const items = cart.items.filter(item => !lineIds.includes(item.lineId));
      return writeCart(recalculate({ ...cart, items }));
    }
    /*
     * Sending a line to another door (3.2.6) needs an address book, and a book
     * needs an account. Nobody is signed in here, so the bag comes back
     * unchanged — which is exactly what a real deployment answers a guest, and
     * the control is never drawn to ask in the first place.
     */
    case "commerce.cart.setDestination":
      return requireCart(String(input.cartId));

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
    /* Nobody is signed in, so there is no address book to keep — which is the
       same answer a real deployment gives a guest, through the same branch
       rather than a special case. */
    case "customer.addresses.list":
      return [];
    /*
     * Nobody can buy anything in the demo — there is no payment anywhere yet,
     * and the demo catalog is invented besides — so the honest answer is an
     * empty page rather than a fabricated order history. A demo order would be
     * a receipt for a product that does not exist, at a price nobody paid.
     */
    /*
     * The demo has fixtures and no signals — nobody is signed in and no bag
     * survives a reload — so the honest answer is the shop's own shelf marked
     * `personalised: false`, which is exactly what the real server returns for
     * a shopper it knows nothing about. Inventing a taste profile to make the
     * demo look clever would be the invented catalog problem twice over.
     */
    case "recommendations.forMe":
      return {
        items: demoCatalog.slice(0, 8).map(product => ({ product, score: 0, reasons: [] })),
        personalised: false,
        terms: [],
        refinedByModel: false,
      };
    case "orders.list":
      return onePage([]);
    case "orders.get":
      return null;

    /*
     * Wishlists in the demo are empty rather than invented, and that is the
     * one honest answer here. Every other fixture is a made-up product; a
     * made-up *gift list* would be a made-up person with a made-up phone
     * number, and the whole feature is about a real number resolving to a real
     * shopper. An empty state demonstrates the page; a fake Noura would
     * demonstrate a lie.
     */
    /*
     * Reviews in a demo are empty rather than invented, for the reason the
     * wishlists are: every review in this system is a verified purchase, and
     * a fixture full of made-up ones would be demonstrating the one thing the
     * table exists to make impossible.
     */
    /*
     * Empty in a demo, and honestly so: this rail is a claim about what real
     * shoppers did, and a fixture would be inventing that claim. The component
     * draws nothing when there is no evidence, which is exactly right here.
     */
    case "together.forProduct":
      return [];

    /*
     * Off in a demo, and the panel is absent rather than broken.
     *
     * There is no key in a static build and no server to hold one, so a panel
     * that rendered would be a box that answers nothing — the dead control
     * this codebase refuses everywhere else. `available: false` is the same
     * answer a real deployment with no key gives, so the demo exercises the
     * real branch rather than a special case.
     */
    /*
     * Empty in a demo, and honestly so: the demo portal signs in as a vendor
     * `manager`, who cannot reach `platform.viewAll` — so the link is not in
     * the navigation and this is unreachable. Answered anyway, because a
     * procedure the demo cannot name throws the day the fixture's role
     * changes.
     */
    case "finance.report":
      return { totals: { gross: "0.000", refunded: "0.000", net: "0.000", commission: "0.000", vendorNet: "0.000", paidLines: 0, refundedLines: 0 }, vendors: [], months: [], truncated: false };

    /*
     * Price requests (3.1.13) in a demo with no backend. `openOn` answers an
     * empty list, so the panel is absent on every product rather than drawn
     * over a button nothing can answer — the same call the assistant makes
     * below. The rest are answered anyway, because a procedure the demo cannot
     * name throws the day the fixture opts a product in.
     */
    /* Requirement 3.3.8's reads. The demo portal signs in as a vendor
       `manager`, who cannot reach `platform.viewAll`, so neither is reachable
       — answered anyway, because a procedure the demo cannot name throws the
       day the fixture's role changes. */
    /* The demo portal signs in as a vendor `manager`, so the selling section
       on /account is genuinely reachable there and names the fixture's store. */
    case "inventory.products.setDeliverySpeed":
    case "inventory.products.setAttributes":
    case "inventory.products.setSizeClass":
    case "inventory.products.setSizeChart":
      return { ok: true };

    case "inventory.myStore":
      return { id: 1, name: "Demo Store" };

    case "inventory.sellerChanges":
      return { rows: [], unseen: 0, seenAt: null };
    case "inventory.markAuditSeen":
      return { ok: true };

    /* The demo has no server to place an order against, and saying it
       succeeded would be the dishonesty the Publish button avoids. */
    case "orders.place":
      throw new Error("checkout.placeFailed");

    /* Reading the file is pure and happens in the browser, so the demo's
       import page previews a real spreadsheet — only the write has nowhere to
       go, and saying it succeeded would be the lie the Publish button avoids. */
    /*
     * The review queue's own checks are pure and would run happily here, but
     * the demo's fixtures hold no pending products for them to run over — so
     * the honest answer is an empty list rather than invented findings.
     */
    case "inventory.products.flags":
      return [];
    /* No key in a demo build, which is the branch a real deployment without
       one takes too rather than a special case. */
    case "inventory.products.modelFlag":
      return { available: false, flag: null };
    case "inventory.products.modelReviewAvailable":
      return { available: false };

    /* The demo portal can draw the extras editor and cannot save it, the same
       branch every other write there takes. */
    case "inventory.products.setAddons":
      throw new Error("admin.saveFailed");

    case "inventory.products.bulkCreate":
      throw new Error("admin.saveFailed");

    /* The demo's fixtures hold no bundles, and inventing one would put a set
       on the shelf that cannot be bought. */
    case "commerce.bundlesForVariant":
    case "inventory.bundles.list":
      return [];
    case "inventory.bundles.save":
    case "inventory.bundles.setActive":
      throw new Error("admin.saveFailed");

    /* The demo signs in as a vendor `manager` who already has a store, so the
       honest answer is that they have no application waiting. */
    case "inventory.applications.mine":
      return null;
    case "inventory.applications.list":
      return { rows: [], total: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE };
    case "inventory.applications.waiting":
      return 0;
    case "inventory.applications.save":
    case "inventory.applications.submit":
    case "inventory.applications.approve":
    case "inventory.applications.reject":
      throw new Error("admin.saveFailed");

    /* No codes and no cards in the fixtures, and inventing one would be a
       code somebody types into a real shop and finds does not exist. */
    case "orders.quoteVoucher":
      return { ok: false, reason: "voucher.unknown" };
    case "orders.vouchers":
      return { codes: [], cards: [] };
    case "orders.saveDiscountCode":
    case "orders.createGiftCard":
      throw new Error("admin.saveFailed");

    /* The demo signs in as a vendor, and the signals are admin-only — so the
       page never asks. Answered anyway, because a procedure the demo cannot
       name is one that throws the day somebody signs in as an admin. */
    case "orders.risk":
      return [];

    /* The demo signs in as a vendor `manager` and its fixtures hold no orders,
       so the seller's desk is reachable and honestly empty — which is also the
       only state it could have without an order to act on. */
    case "orders.forSeller":
      return { rows: [], total: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE };
    case "orders.forSellerDetail":
      return null;
    case "orders.setFulfilment":
      throw new Error("orders.lineGone");
    case "orders.markCollected":
      return { recorded: false };
    /* A demo shopper has no orders, so there is no parcel to rate or claim
       on — the server's own answer to a reference it cannot find. */
    /* Messages (3.8). The demo shopper is a guest with nobody to talk to, and
       the demo manager's store has no shoppers, so every inbox is empty and a
       send is refused the way a real server refuses a product it cannot find. */
    /* The switchboard (2.3): everything on, which is what a database nobody
       has touched means. The demo manager cannot reach the page, so the list
       and the setter are unreachable — answered anyway, as the others are. */
    case "features.states":
      return allOn();
    case "features.list":
      return FEATURE_KEYS.map(key => ({ key, enabled: true, updatedAt: null, updatedByEmail: null }));
    case "features.set":
      throw new Error("platform.configure");
    /* Payout runs (3.3.21): nothing is ever paid in the demo, so nothing is
       due and nothing has been sent. Recording is NetLet's and the demo
       manager is refused, as a real one would be. */
    case "finance.payoutBatches":
      return [];
    case "finance.payoutHistory":
      return { rows: [], total: 0, page: 1, pageSize: 20 };
    case "finance.recordPayout":
      throw new Error("payouts.record");
    /* Subscribe & Save (3.1.19): the demo shopper is a guest with no address
       book, and no demo seller offers standing orders. */
    /* No model in the demo: the photo panel says nothing is looking yet. */
    case "search.photoAvailable":
      return { available: false };
    case "search.photo":
      return { kind: "unavailable" };
    /* Talking to NetLet (3.5.1): the demo shopper is a guest and the demo
       portal is a seller, so neither has conversations with NetLet. */
    case "support.mine":
      return [];
    case "support.unread":
    case "support.waiting":
      return 0;
    case "support.inbox":
      return { rows: [], total: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE };
    case "support.open":
    case "support.thread":
    case "support.reply":
    case "support.resolve":
    case "support.staffThread":
    case "support.staffReply":
    case "support.staffResolve":
      throw new Error("support.notFound");
    /* Live tracking (3.4.3): nothing is ever on the road in the demo. */
    case "orders.tracking":
      return [];
    case "dispatch.mySharing":
      return { sharing: false, recordedAt: null };
    case "dispatch.sharePosition":
    case "dispatch.stopSharing":
      throw new Error("tracking.notDriver");
    case "subscriptions.mine":
      return [];
    case "subscriptions.overview":
      return { active: 0, paused: 0, due: 0, scheduled: false };
    case "subscriptions.create":
    case "subscriptions.change":
    case "subscriptions.runDue":
      throw new Error("subscriptions.notOffered");
    /* Placements (3.3.15): nobody has paid for one in the demo, so the
       shelves are absent; booking is an owner's and the demo is a manager. */
    case "ads.sponsored":
      return [];
    case "ads.list":
      return { rows: [], total: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE };
    case "ads.quote":
    case "ads.book":
    case "ads.cancel":
      throw new Error("ads.notYours");
    /* Affiliates (3.7): the demo shopper is a guest, so there is no account to
       join with and no link anybody arrived through. */
    case "affiliates.lookup":
    case "affiliates.mine":
      return null;
    case "affiliates.waiting":
      return 0;
    case "affiliates.list":
      return { rows: [], total: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE };
    case "affiliates.join":
    case "affiliates.payout":
    case "affiliates.update":
      throw new Error("affiliate.notFound");
    /* Invoices (3.6.6): nothing is ever paid in the demo, so nothing is
       invoiced — the server's own answer to a number it cannot find. */
    case "invoices.verify":
      return null;
    case "invoices.get":
      throw new Error("invoice.notFound");
    case "invoices.list":
      return { rows: [], total: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE };
    /* Returns (3.2.8): no orders in the demo, so nothing to send back. */
    case "returns.fit":
      return { tooSmall: 0, tooLarge: 0 };
    case "returns.list":
      return [];
    case "returns.waiting":
      return 0;
    case "orders.requestReturn":
    case "orders.cancelReturn":
    case "returns.decide":
    case "returns.collect":
    case "returns.receive":
    case "returns.refundPaid":
      throw new Error("returns.notFound");
    case "chat.mine":
    case "chat.seller.list":
      return [];
    case "chat.unread":
    case "chat.seller.unread":
      return 0;
    case "chat.thread":
    case "chat.seller.thread":
    case "chat.send":
    case "chat.seller.reply":
      throw new Error("chat.notFound");
    case "orders.rateDelivery":
    case "orders.claimDamage":
      throw new Error("parcel.notFound");

    case "offers.openOn":
      return [];
    case "offers.mine":
      return null;
    case "offers.list":
      return [];
    case "offers.inbox":
      return { rows: [], total: 0, page: 1, pageSize: 50 };
    case "offers.waiting":
      return 0;
    case "offers.storeOpen":
      return false;
    case "offers.request":
    case "offers.withdraw":
    case "offers.answer":
    case "offers.decline":
    case "offers.setStoreOpen":
    case "offers.setProductOpen":
      return { ok: true };

    /*
     * The demo has a shopper with no history, so the honest balance is zero —
     * and a demo that handed out points would be inventing a payout. The code
     * is real, because it is derived from an account id rather than stored.
     */
    case "rewards.mine":
      return {
        code: referralCodeFor(1),
        balance: 0,
        spendValue: "0.000",
        cashOutValue: "0.000",
        cashOut: { ok: false, shortBy: MIN_CASH_OUT_POINTS },
        minimumCashOut: MIN_CASH_OUT_POINTS,
        invited: 0,
        qualified: 0,
        entries: [],
      };
    /* Nothing to cash out, and the page refuses before asking. */
    case "rewards.cashOut":
      throw new Error("rewards.cannotCashOut");
    case "rewards.pendingCashOuts":
      return [];
    case "rewards.settleCashOut":
      return { settled: false };

    /* The demo signs in as a vendor `manager`; the payouts read is scoped to
       their own store, so it is reachable and honestly empty. */
    case "finance.payouts":
      return { vendors: [], owed: "0.000", truncated: false };
    case "finance.payoutsDue":
      return [];
    case "finance.platformLicensed":
      return [];

    case "assistant.available":
      return { available: false };
    /* Unreachable while `available` is false — the panel is never drawn — but
       answered anyway, because a procedure the demo cannot name is a procedure
       that throws the day somebody flips the switch above. */
    case "assistant.ask":
      return { kind: "unavailable" };

    case "reviews.forProduct":
      return { items: [], summary: null, total: 0 };
    case "reviews.mine":
      return [];
    case "reviews.write":
      return 1;
    case "reviews.edit":
    case "reviews.remove":
    case "reviews.reply":
    case "reviews.setHidden":
      return undefined;

    case "wishlists.mine":
      return [];
    case "wishlists.get":
      return { list: { id: 1, title: "", visibility: "private" as const, ownerName: null }, items: [] };
    case "wishlists.shareLink":
    case "wishlists.phone":
    case "wishlists.byToken":
      return null;
    case "wishlists.findByPhone":
      return [];
    case "wishlists.create":
      return 1;
    case "wishlists.setPhone":
      return null;
    case "wishlists.update":
    case "wishlists.remove":
    case "wishlists.addItem":
    case "wishlists.removeItem":
    case "wishlists.claim":
    case "wishlists.release":
      return undefined;
    // Nobody is signed in to be waiting, so the demand line stays off.
    case "customer.follows.demand":
      return 0;
    case "customer.profile.update":
    case "customer.saved.set":
    case "customer.notifications.set":
    case "customer.follows.set":
    /* The book needs an account and the demo has none, so these are accepted
       and discarded like every other write here. */
    case "customer.addresses.add":
    case "customer.addresses.update":
    case "customer.addresses.remove":
      return { success: true } as const;

    /*
     * The dispatch board (2.2, 3.4.2). The demo signs in as a vendor manager,
     * and a seller reaches no part of dispatch at all — so the honest answer is
     * the one a real deployment gives them: not a courier, and an empty board.
     * The page then draws nothing, through the same branch rather than a
     * special case.
     */
    case "dispatch.me":
      return { kind: "vendor" as const };
    case "dispatch.board":
      return { parcels: [], truncated: false };
    case "dispatch.waiting":
      return 0;
    case "dispatch.couriers.list":
    case "dispatch.couriers.members":
      return [];
    /* Ratings and claims (3.4.2, 3.4.4): the demo's vendor manager files
       claims and reads its own, which in a demo with no orders is none. */
    case "dispatch.scores":
      return { scores: [], recent: [] };
    case "dispatch.claims.list":
    case "dispatch.claims.ledger":
      return [];
    case "dispatch.claims.openCount":
      return 0;
    case "dispatch.claims.file":
      throw new Error("parcel.notFound");
    case "dispatch.claims.respond":
    case "dispatch.claims.decide":
      return { success: true } as const;
    case "dispatch.assign":
    case "dispatch.move":
    case "dispatch.couriers.create":
    case "dispatch.couriers.setStatus":
    case "dispatch.couriers.addMember":
    case "dispatch.couriers.removeMember":
      return { success: true } as const;

    /* The admin portal. The demo has no server, so it answers as a vendor manager
       against fixtures — see demoInventory.ts. Writes are accepted and
       discarded; nothing here is persisted. */
    case "inventory.me":
      return demoInventoryActor;
    case "inventory.categories":
      return demoCategories;
    case "inventory.products.list":
      return onePage(demoInventoryProducts.filter(row =>
        !(input as { status?: string })?.status || row.status === (input as { status?: string }).status));
    case "inventory.storefront.list":
      return demoInventoryProducts;
    case "inventory.products.get":
      return demoInventoryProducts.find(row => row.id === (input as { id: number })?.id) ?? null;
    case "inventory.vendors.list":
      return onePage([]);
    case "inventory.vendors.members":
      return [];
    /* Admin-only, like the list above: the demo actor is a vendor manager and
       the route refuses before this is reached. */
    case "inventory.vendors.get":
      return null;
    /* The demo actor is a vendor manager, so the counts are that vendor's and
       the platform-wide vendor numbers are zero — the same shape the server
       returns for a vendor, rather than an admin's view a manager never has. */
    case "inventory.overview":
      return demoOverview;
    case "inventory.lowStock":
      return onePage(demoLowStock);
    case "inventory.stockHistory":
      return demoStockHistory;
    /* Derived from the same fixtures the product list renders, so the panel
       and the table behind it cannot disagree. */
    case "inventory.health":
      return demoHealth;
    case "inventory.storefront.byHandle":
      return demoInventoryProducts.find(row => row.handle === (input as { handle: string })?.handle) ?? null;
    /* Admin-only, and the demo actor is a vendor manager — so an empty list is
       the honest answer rather than invented evidence. The route refuses
       before this is reached anyway. */
    case "inventory.audit":
      return [];
    /* People is admin-only. A demo vendor manager cannot reach the page at
       all, so the list is empty rather than invented. */
    case "inventory.people.list":
      return onePage([]);
    /*
     * Creating returns a row the editor can navigate to. The other writes are
     * accepted and discarded — but every one the portal can reach has to be
     * here, or a button in the demo throws instead of doing nothing, which is
     * worse than either.
     */
    /*
     * Creating hands back an id the editor can actually open. Inventing a new
     * one would navigate to a product no fixture has, so the demo's own
     * "New product" would land on "not found" — a dead end that looks like a
     * bug in the portal rather than a limit of the demo.
     */
    case "inventory.products.create":
      return { ...demoInventoryProducts[0], title: (input as { title?: string })?.title ?? "New product", status: "draft" };
    case "inventory.products.update":
    case "inventory.products.setImages":
    case "inventory.products.setStatus":
    case "inventory.products.review":
    case "inventory.variants.save":
    case "inventory.variants.adjustStock":
    case "inventory.people.setAdmin":
    case "inventory.people.addToVendor":
    case "inventory.people.removeFromVendor":
    case "inventory.products.setCommission":
    case "inventory.vendors.create":
    case "inventory.vendors.updateProfile":
    case "auth.updateName":
    case "auth.changeEmail":
    case "auth.changePassword":
    case "inventory.vendors.addNewMember":
    case "inventory.vendors.sendPasswordReset":
    case "inventory.vendors.setBadges":
    case "inventory.vendors.setCommission":
    case "inventory.vendors.setStatus":
    case "inventory.vendors.setMemberRole":
    case "inventory.vendors.removeMember":
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
