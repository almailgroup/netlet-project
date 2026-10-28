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
const WHITE = "border border-[#0a285a]/20 bg-white text-[#0a285a] transition-colors hover:bg-[#f0f2f5]";

export const PURCHASE_TONE = {
  add: WHITE,
  buy: WHITE,
} as const;

/**
 * The product preview's pair, in the brand's navy on the owner's word: a navy
 * Add to cart, and Buy now in white with a navy rim, so the preview reads as
 * the shop's own panel over the page while the card under it keeps its white.
 */
export const PREVIEW_TONE = {
  add: "bg-[#0a285a] text-white transition-colors enabled:hover:bg-[#0d3372]",
  buy: "border-2 border-[#0a285a] bg-white text-[#0a285a] transition-colors enabled:hover:bg-[#f0f2f5]",
} as const;
