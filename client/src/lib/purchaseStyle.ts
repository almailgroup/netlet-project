/**
 * Add to cart and Buy now, drawn the same wherever they appear.
 *
 * The card, the preview and the product page each had their own pair and no
 * two agreed: a white Add on the card, a white Add beside an orange Buy now in
 * the preview, a navy Add over a white Buy now on the product page. A shopper
 * meeting three answers to "which button buys" reads all three as different
 * shops. One pair now, in the card's original white: a white surface, a light
 * navy rim and navy words, the bag icon telling Add from the bolt on Buy now.
 * The two keys stay separate so the pair can be told apart again by changing
 * this file alone.
 */
const WHITE = "border border-[#0a285a]/20 bg-white text-[#0a285a] transition-colors hover:bg-[#f3f6fa]";

export const PURCHASE_TONE = {
  add: WHITE,
  buy: WHITE,
} as const;
