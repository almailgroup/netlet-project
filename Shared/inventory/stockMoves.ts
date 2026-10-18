/**
 * Which way each reason for a stock change moves the count.
 *
 * Stock moves by a delta with a reason, so the log can say *why* the number is
 * what it is — and that only holds if the reason and the sign agree. They were
 * chosen separately in the editor and checked nowhere, so the log could read
 * "Stock received: −1" or "Damaged: +5", and a change of nothing at all was
 * written down as a movement. Received and returned add; sold and damaged take
 * away; a correction goes either way, because a miscount does.
 *
 * Pure and shared, for the password floor's reason: the editor disables the
 * button on exactly what the server refuses.
 */
export const STOCK_REASONS = ["received", "sold", "damaged", "correction", "returned"] as const;
export type StockReason = (typeof STOCK_REASONS)[number];

export type StockMoveProblem = "stock.zeroChange" | "stock.wrongDirection";

export function stockMoveProblem(delta: number, reason: StockReason): StockMoveProblem | null {
  if (!Number.isInteger(delta) || delta === 0) return "stock.zeroChange";
  if ((reason === "received" || reason === "returned") && delta < 0) return "stock.wrongDirection";
  if ((reason === "sold" || reason === "damaged") && delta > 0) return "stock.wrongDirection";
  return null;
}
