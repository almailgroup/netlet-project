/**
 * Add to cart and Buy now, drawn the same wherever they appear.
 *
 * The card, the preview and the product page each had their own pair and no
 * two agreed: the card's Add was white, the preview's Add was white beside an
 * orange Buy now, and the product page had a navy Add over a white Buy now. A
 * shopper meeting three answers to "which button buys" reads all three as
 * different shops. One pair now: Add to cart is navy, the header's own cart
 * button; Buy now is the brand orange, carrying navy text (white on #f2683a is
 * 3.08:1, navy is 4.65:1). The bag icon goes with Add and the bolt with Buy.
 */
export const PURCHASE_TONE = {
  add: "glass glass-navy",
  buy: "glass glass-accent",
} as const;
