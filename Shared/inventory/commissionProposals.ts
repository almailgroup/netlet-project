/**
 * A store asking for a commission of its own (3.3.2: "the option to propose a
 * custom rate or fixed amount for specific products, subject to later admin
 * approval"). Migration 0065. Pure and shared, for the password floor's
 * reason: the form refuses what the API would.
 *
 * **One figure, never both.** A percentage or a fixed amount per sale, for the
 * whole store or for one product. Both at once is two proposals pretending to
 * be one, and an administrator could accept only half of it.
 *
 * **A proposal applies nothing.** Commission is outside a store's control
 * entirely; accepting one sets the rate through the same audited door as any
 * commission edit, and declining says why in words the store reads.
 */

export const PROPOSAL_STATUSES = ["pending", "accepted", "declined", "withdrawn"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const MAX_PROPOSAL_REASON = 500;
export const MAX_DECISION_NOTE = 400;

export type ProposalFigure = { percent: string | null; fixed: string | null };

export type ProposalProblem = "commission.oneFigure" | "commission.badPercent" | "commission.badFixed";

const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;
const MONEY = /^\d{1,9}(\.\d{1,3})?$/;

/** What is wrong with the figure as typed, or null. A blank is no figure. */
export function proposalFigureProblem(figure: ProposalFigure): ProposalProblem | null {
  const percent = figure.percent?.trim() || null;
  const fixed = figure.fixed?.trim() || null;
  if ((percent === null) === (fixed === null)) return "commission.oneFigure";
  if (percent !== null && (!PERCENT.test(percent) || Number(percent) > 100)) return "commission.badPercent";
  if (fixed !== null && !MONEY.test(fixed)) return "commission.badFixed";
  return null;
}

/** The figure as it is stored: two decimals for a rate, three for an amount, the other null. */
export function normaliseFigure(figure: ProposalFigure): ProposalFigure {
  const percent = figure.percent?.trim() || null;
  const fixed = figure.fixed?.trim() || null;
  return {
    percent: percent === null ? null : Number(percent).toFixed(2),
    fixed: fixed === null ? null : Number(fixed).toFixed(3),
  };
}

/**
 * What accepting a store-wide proposal writes. A store's rate is never empty —
 * `vendors.commission_percent` is the rate every product falls back to — so a
 * fixed amount for the whole store is that amount with no percentage beside it.
 */
export function storeRateFor(figure: ProposalFigure): { percent: string; fixed: string | null } {
  return figure.fixed !== null ? { percent: "0.00", fixed: figure.fixed } : { percent: figure.percent ?? "0.00", fixed: null };
}
