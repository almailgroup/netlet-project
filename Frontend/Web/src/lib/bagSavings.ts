/**
 * What the shopper chose to take off the bag at checkout — a discount code, a
 * gift card and whether to spend points (`BagSavings`), on the owner's word.
 *
 * Kept for the tab (`browserStore`'s session helpers) and for one bag: a code
 * chosen for a bag that has since gone is not carried onto the next. Nothing
 * here is worth anything by itself — the server quotes each code against the
 * bag and checks all three again when the order is placed.
 */
import { readSession, removeSession, writeSession } from "@/lib/browserStore";
import { useSyncExternalStore } from "react";

export type Savings = { code: string; giftCard: string; usePoints: boolean };

const KEY = "netlet.bagSavings";
const NONE: Savings = { code: "", giftCard: "", usePoints: false };

type Stored = Savings & { cartId: string };

let cached: { raw: string | null; value: Stored | null } | null = null;
const listeners = new Set<() => void>();

function read(): Stored | null {
  const raw = readSession(KEY);
  if (cached && cached.raw === raw) return cached.value;
  let value: Stored | null = null;
  try {
    const parsed = raw ? JSON.parse(raw) as Partial<Stored> : null;
    if (parsed && typeof parsed.cartId === "string") {
      value = {
        cartId: parsed.cartId,
        code: typeof parsed.code === "string" ? parsed.code.slice(0, 40) : "",
        giftCard: typeof parsed.giftCard === "string" ? parsed.giftCard.slice(0, 40) : "",
        usePoints: parsed.usePoints === true,
      };
    }
  } catch {
    value = null;
  }
  cached = { raw, value };
  return value;
}

/** What this tab chose for the bag `cartId`, or nothing chosen. */
export function savingsFor(cartId: string | null | undefined): Savings {
  const stored = read();
  return stored && cartId && stored.cartId === cartId ? stored : NONE;
}

/** Change what is chosen for `cartId`; an empty choice forgets the bag. */
export function setSavings(cartId: string, change: Partial<Savings>) {
  const next = { ...savingsFor(cartId), ...change, cartId };
  if (!next.code && !next.giftCard && !next.usePoints) removeSession(KEY);
  else writeSession(KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The choices for the bag, redrawn when they change on this page. */
export function useSavings(cartId: string | null | undefined): Savings {
  const stored = useSyncExternalStore(subscribe, read, () => null);
  return stored && cartId && stored.cartId === cartId ? stored : NONE;
}
