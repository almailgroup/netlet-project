/**
 * Returns and exchanges as operations (3.2.8), decided automatically where a
 * rule can decide them (3.5.2).
 *
 * Pure, for the reason the return window is: this moves a line to `returned`,
 * which is a refund in every report, and a rule you can only exercise by
 * shipping something back is one nobody checks.
 *
 * ## Who decides
 *
 * **Most requests decide themselves.** A shopper saying the thing arrived
 * damaged, faulty, wrong or not as described is reporting the seller's fault,
 * and Kuwaiti consumer protection does not let a shop refuse that inside the
 * window — so a human reading it adds a delay and nothing else. Changing one's
 * mind is approved too, inside the window the shop already advertises, with one
 * exception a rule can see: **perishable groceries are not taken back because
 * somebody changed their mind**, and the request is declined at once with that
 * reason rather than left for a seller to say the same thing two days later.
 *
 * **"Other" goes to the seller and then to NetLet** (3.5.2: "understanding
 * the issue, communicating with the vendor to resolve it, then replying to the
 * customer — requiring only a final confirmation from the admin"). A model
 * reads the note and suggests an outcome (`returnReading.ts`); the seller
 * answers with an outcome of their own, which moves the request to `review`;
 * an administrator confirms or overrules it, and only then is the shopper
 * told. A seller may also **dispute** a request a rule approved, before the
 * item is collected, which sends it to `review` the same way. What the rules
 * decide does not wait for anybody: Kuwaiti consumer protection does not let
 * the shop refuse a fault inside the window, so waiting would only delay the
 * shopper's money.
 *
 * In `review`, **the seller's proposed outcome is the decline reason**: a
 * request in review carrying one is one the seller would decline, with the
 * words the shopper would read; one without is one the seller would approve.
 * `vendor_response` is what the seller said, either way.
 *
 * ## What happens after
 *
 * `approved` → `collected` (the item has left the shopper) → received, which
 * is not a resting state: receiving *is* the refund or the exchange. A refund
 * marks the line `returned`, which finance and payouts already count as a
 * refund, and records what is owed back — **the line's frozen total, never a
 * recomputed price**, the rule every other figure on an order follows. An
 * exchange sends the same variant again as a new, zero-priced order through
 * the ordinary dispatch board, and falls back to a refund when the shelf is
 * empty rather than leaving the shopper with neither.
 *
 * A shopper can withdraw until the item is collected; after that it is on its
 * way back and withdrawing it is a conversation, not a button.
 */
import { fromFils, toFils } from "../money.js";

export const RETURN_KINDS = ["refund", "exchange"] as const;
export type ReturnKind = (typeof RETURN_KINDS)[number];

/*
 * `tooSmall` and `tooLarge` are a change of mind with a reason attached — the
 * item is what was ordered, the size was the shopper's choice — so they decide
 * the way a change of mind does. They exist because the reason is worth
 * keeping: it is what teaches the size guide whether a product runs small
 * (3.1.20), which "changed my mind" never could.
 */
export const RETURN_REASONS = ["damaged", "defective", "wrongItem", "notAsDescribed", "tooSmall", "tooLarge", "changedMind", "other"] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

/** Reasons that are the seller's fault: approved at once, inside the window. */
const SELLER_FAULT: ReadonlySet<ReturnReason> = new Set(["damaged", "defective", "wrongItem", "notAsDescribed"]);

export const RETURN_STATUSES = ["requested", "review", "approved", "declined", "collected", "refunded", "exchanged", "cancelled"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

/** Still in motion: the states the one-open-request-per-line index covers. */
export const OPEN_RETURN_STATUSES: readonly ReturnStatus[] = ["requested", "review", "approved", "collected"];

export function isOpenReturn(status: string): boolean {
  return (OPEN_RETURN_STATUSES as readonly string[]).includes(status);
}

/** Departments whose goods spoil: no change-of-mind returns. */
export const PERISHABLE_DEPARTMENTS: ReadonlySet<string> = new Set(["grocery"]);

export type AutomaticDecision =
  | { status: "approved"; decidedBy: "auto" }
  | { status: "declined"; decidedBy: "auto"; declineReason: "returns.perishableNoChangeOfMind" }
  | { status: "requested"; decidedBy: null };

/**
 * What a new request becomes the moment it is made.
 *
 * `department` is the product's department slug at the time of the request, or
 * null when it has none — and null is not perishable, because declining a
 * return over a gap in our own catalogue puts our problem on the shopper.
 */
export function automaticDecision(reason: ReturnReason, department: string | null): AutomaticDecision {
  if (SELLER_FAULT.has(reason)) return { status: "approved", decidedBy: "auto" };
  if (reason === "changedMind" || reason === "tooSmall" || reason === "tooLarge") {
    if (department && PERISHABLE_DEPARTMENTS.has(department)) {
      return { status: "declined", decidedBy: "auto", declineReason: "returns.perishableNoChangeOfMind" };
    }
    return { status: "approved", decidedBy: "auto" };
  }
  return { status: "requested", decidedBy: null };
}

export type ReturnAction = "approve" | "decline" | "dispute" | "collect" | "receive" | "markRefundPaid" | "cancel";

/**
 * What may be done to a request in this state, by whom.
 *
 * The seller acts on their own store's requests and an administrator on any —
 * a refusal a seller can be argued out of needs somebody above both parties.
 * A seller's approve or decline on a request no rule decided is a proposal
 * that NetLet confirms (`review`); an administrator's is final. A shopper's
 * only move is withdrawing, and only before the item has left them.
 */
export function returnActions(
  request: { status: string; kind: string; refundPaidAt?: Date | string | null; decidedBy?: string | null },
  who: "shopper" | "seller" | "admin",
): ReturnAction[] {
  const status = request.status as ReturnStatus;
  if (who === "shopper") return status === "requested" || status === "review" || status === "approved" ? ["cancel"] : [];

  switch (status) {
    case "requested":
      return ["approve", "decline"];
    case "review":
      return who === "admin" ? ["approve", "decline"] : [];
    case "approved":
      /* A seller disputes only what a rule approved; what NetLet confirmed is settled. */
      return who === "admin" ? ["collect", "decline"] : request.decidedBy === "auto" ? ["collect", "dispute"] : ["collect"];
    case "collected":
      return ["receive"];
    case "refunded":
      return request.refundPaidAt ? [] : ["markRefundPaid"];
    default:
      return [];
  }
}

/** What the seller proposes on a request in `review`: the decline reason is the proposal. */
export function sellerProposal(request: { status: string; declineReason: string | null }): "approve" | "decline" | null {
  if (request.status !== "review") return null;
  return request.declineReason ? "decline" : "approve";
}

/**
 * What is owed back for a returned line: its frozen total, add-ons included
 * (`freezeLine` folds them into `line_total`). Never re-priced against today's
 * catalogue — a refund that comes out at a different figure from the payment is
 * the failure every frozen number on an order exists to prevent.
 */
export function refundFor(line: { lineTotal: string }): string {
  return fromFils(toFils(line.lineTotal));
}

/** Longest a shopper's note on a return may be. */
export const MAX_RETURN_NOTE = 1000;
