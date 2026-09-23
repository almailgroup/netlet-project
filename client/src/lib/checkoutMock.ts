/**
 * The card brands NetLet will take, and the fact that it cannot take them yet.
 *
 * This file used to say the whole checkout was a mock, and that stopped being
 * true when cash on delivery landed (3.2.2): a cash order is real, placed and
 * refundable, because nothing is authorised or captured — the shopper hands
 * money to a driver. What remains display-only is the four card brands, which
 * wait on a payment service being chosen and integrated (3.2.1).
 *
 * They are drawn as logos and never as buttons. A payment button that does
 * nothing is the dead-control rule on the page where breaking it costs most.
 */
export const KUWAIT_PAYMENT_METHODS = [
  { id: "knet", label: "KNET", tone: "navy" },
  { id: "visa", label: "VISA", tone: "blue" },
  { id: "mastercard", label: "Mastercard", tone: "red" },
  { id: "google-pay", label: "Google Pay", tone: "ink" },
] as const;

/** Still true, and narrower than it was: the *cards* cannot be paid with. */
export const CARD_METHODS_ARE_DISPLAY_ONLY = true;
