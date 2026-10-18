/**
 * The saved address this device used last.
 *
 * Checkout chose it already — the address picked last is the one picked next —
 * and the delivery area now starts from the same choice, so a signed-in
 * shopper who has an address book is never asked "where do you live" by the
 * header after telling the shop at checkout. One key and one rule, here, so
 * the two cannot pick different addresses. Kept with `browserStore` because it
 * is a per-device convenience: losing it costs one tap.
 */
import { readStored, writeStored } from "@/lib/browserStore";

const KEY = "netlet.checkoutAddress";

export function readLastAddressId(): number | null {
  const id = Number(readStored(KEY));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/* Who to tell when it changes. The header names the chosen address, and
   picking another one in the same governorate changes no other state, so
   nothing else would make it redraw. */
const listeners = new Set<() => void>();

export function rememberAddress(id: number): void {
  writeStored(KEY, String(id));
  listeners.forEach(listener => listener());
}

export function onLastAddressChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The address checkout would choose: the one used last here, else the first in the book. */
export function addressToUse<A extends { id: number }>(book: readonly A[], lastUsed: number | null): A | undefined {
  return book.find(address => address.id === lastUsed) ?? book[0];
}

/**
 * The governorate to start the delivery area from, or null to leave it unset.
 * Only an address that names one counts — an address with no governorate says
 * nothing about where to deliver.
 */
export function zoneFromAddressBook(book: readonly { id: number; governorate?: string | null }[], lastUsed: number | null): string | null {
  const chosen = addressToUse(book, lastUsed);
  if (chosen?.governorate) return chosen.governorate;
  return book.find(address => address.governorate)?.governorate ?? null;
}

/**
 * The saved address the shop is delivering to, if one is: the one used last
 * here when it is still in the area in use, else the first in that area —
 * checkout's own fallback. Null when the area was chosen some other way, so
 * the header names the area itself rather than an address that is not it.
 */
export function addressInUse<A extends { id: number; governorate?: string | null }>(
  book: readonly A[],
  lastUsed: number | null,
  zoneId: string | null | undefined,
): A | null {
  if (!zoneId) return null;
  return book.find(address => address.id === lastUsed && address.governorate === zoneId)
    ?? book.find(address => address.governorate === zoneId)
    ?? null;
}
