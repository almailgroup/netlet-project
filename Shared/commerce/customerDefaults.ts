/**
 * What a shopper's account starts every order from: a delivery address and a
 * way to pay, each chosen in Settings (on the owner's word: "allow customers
 * to set or change their default delivery address in Settings" and "their
 * default payment method").
 *
 * Pure, and shared, so the page offers exactly what the server keeps.
 *
 * **The default address is the address in use.** The header's address book,
 * the cart's address card, checkout and "Your account"'s settings all ask one
 * question — where does the shop deliver — and an account with two answers to
 * it ("default" here, "in use" there) is an account somebody has to keep in
 * step by hand. Choosing an address anywhere chooses the default; a line sent
 * somewhere of its own (3.2.6) stays the one exception, and is the line's.
 *
 * **Only cash on delivery can be chosen today.** KNET, a card and Apple Pay
 * are drawn as they will be and marked as coming, the checkout's rule, until
 * a card service is integrated (3.2.1). A stored choice the shop no longer
 * offers — cash switched off, say — is read as the first one it does.
 */

/** Every way to pay a shopper may one day choose, in the order they are drawn. */
export const PAYMENT_METHODS = ["cod", "knet", "card", "apple_pay"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}

/**
 * The ways that can be chosen now: cash on delivery while the shop takes it
 * (the `cashOnDelivery` switch), and nothing else until a card service is
 * wired.
 */
export function choosablePayments(shop: { cashOnDelivery: boolean }): PaymentMethod[] {
  return shop.cashOnDelivery ? ["cod"] : [];
}

/** The way an order starts with: the one kept, while it can be chosen, else the first that can. */
export function defaultPayment(stored: string | null | undefined, choosable: readonly PaymentMethod[]): PaymentMethod | null {
  if (isPaymentMethod(stored) && choosable.includes(stored)) return stored;
  return choosable[0] ?? null;
}

/**
 * The address an order starts from: the account's default while it is still
 * in the book, else the one this device used last, else none — a book is
 * never read past an id that is not in it.
 */
export function startingAddressId(
  book: readonly { id: number }[],
  accountDefault: number | null | undefined,
  deviceLast: number | null | undefined,
): number | null {
  if (accountDefault != null && book.some(address => address.id === accountDefault)) return accountDefault;
  if (deviceLast != null && book.some(address => address.id === deviceLast)) return deviceLast;
  return null;
}

/** What `customer.defaults.get` answers. `ready` is false until migration 0088 is pasted. */
export type CustomerDefaults = {
  ready: boolean;
  addressId: number | null;
  /** The default address's governorate, so a device adopting it delivers to its area too. */
  governorate: string | null;
  payment: PaymentMethod | null;
  choosable: PaymentMethod[];
};
