/**
 * The presents this device said it was getting, while signed out.
 *
 * A claim made signed out names nobody, so the server cannot say it is yours:
 * the gift page drew "Someone is getting this" over the very thing the giver
 * had just pressed, which reads as somebody else having taken it first. And
 * since checkout needs an account, the order that bought it could not be
 * matched to the claim either, so two weeks later the present read as free
 * again for the next relative. The device remembers instead — the list's
 * token and the product, and when — and sends them with the order
 * (`HeldClaim`), and the page draws "You are getting this" from it.
 *
 * Kept for `CLAIM_HOLD_DAYS`, the hold's own length: after that the server no
 * longer holds it for anybody, and saying "you" would be a guess.
 */
import { CLAIM_HOLD_DAYS, MAX_HELD_CLAIMS, type HeldClaim } from "@shared/commerce/wishlist";
import { readStoredList, writeStored } from "./browserStore";

const KEY = "netlet:gift-claims";
const HOLD_MS = CLAIM_HOLD_DAYS * 24 * 60 * 60 * 1000;

type Entry = HeldClaim & { at: number };

function entries(now = Date.now()): Entry[] {
  return readStoredList(KEY).flatMap(raw => {
    const [token, productId, at] = raw.split(" ");
    const when = Number(at);
    return token && productId && Number.isFinite(when) && now - when < HOLD_MS ? [{ token, productId, at: when }] : [];
  });
}

function save(list: Entry[]) {
  writeStored(KEY, JSON.stringify(list.slice(-MAX_HELD_CLAIMS).map(entry => `${entry.token} ${entry.productId} ${entry.at}`)));
}

export function rememberClaim(token: string, productId: string) {
  save([...entries().filter(entry => entry.token !== token || entry.productId !== productId), { token, productId, at: Date.now() }]);
}

export function claimedHere(token: string, productId: string): boolean {
  return entries().some(entry => entry.token === token && entry.productId === productId);
}

/** What checkout sends with the order, newest last. */
export function heldClaims(): HeldClaim[] {
  return entries().map(({ token, productId }) => ({ token, productId }));
}
