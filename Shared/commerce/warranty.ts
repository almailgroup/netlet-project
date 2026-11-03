/**
 * Warranty claims (migration 0072, on the owner's word: "Warranty Request:
 * submit warranty claims and track their progress").
 *
 * Pure and shared: which delivered items a shopper may claim on, what a claim
 * may say, what the store may do with it, and the one sentence of where it
 * stands — so the order page offers exactly what the API accepts and the
 * store's desk draws exactly the buttons it will honour.
 *
 * **A claim is on something that arrived.** Delivered, not sent back, and not
 * already being returned or claimed on. Any time after delivery: a store's
 * warranty is its own words ("12 months", "سنتان", "parts only") and is shown
 * beside the claim, never parsed — the store says whether it is covered.
 *
 * **The store answers with a remedy or a reason.** A repair stays with the
 * store until it says it is done. A replacement or a refund is handed to the
 * returns desk as an approved return request, so the item is collected and
 * the money or the swap moves through the one pipeline that already moves
 * them; the claim reads that request's progress. NetLet's administrators may
 * answer any claim, a store its own.
 */
import { contactFindings } from "./contactFilter.js";
import { isOpenReturn } from "./returnRequests.js";

export const WARRANTY_REMEDIES = ["repair", "replace", "refund"] as const;
export type WarrantyRemedy = (typeof WARRANTY_REMEDIES)[number];

export const WARRANTY_STATUSES = ["open", "accepted", "declined", "completed", "withdrawn"] as const;
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

/** Long enough to say what is wrong; short enough that a store reads it. */
export const MIN_WARRANTY_PROBLEM = 10;
export const MAX_WARRANTY_PROBLEM = 1000;
export const MAX_WARRANTY_RESPONSE = 600;
export const MAX_WARRANTY_PHOTOS = 4;

export type WarrantyBlock =
  | "warranty.notDelivered"
  | "warranty.returned"
  | "warranty.openClaim"
  | "warranty.openReturn"
  /* Migration 0072 not yet applied to this database: no claim can be stored. */
  | "warranty.unavailable";

export function isRemedy(value: unknown): value is WarrantyRemedy {
  return typeof value === "string" && (WARRANTY_REMEDIES as readonly string[]).includes(value);
}

/** A claim still in hand — the partial unique index's own set. */
export function isOpenClaim(status: string): boolean {
  return status === "open" || status === "accepted";
}

/**
 * Whether this line may be claimed on now, and if not, why — the rule
 * `warranty.file` refuses with.
 */
export function warrantyEligibility(
  line: { fulfilment: string; deliveredAt: Date | string | null },
  claims: readonly { status: string }[],
  returns: readonly { status: string }[],
): { allowed: true } | { allowed: false; reason: WarrantyBlock } {
  if (line.fulfilment === "returned" || returns.some(request => request.status === "refunded" || request.status === "exchanged")) {
    return { allowed: false, reason: "warranty.returned" };
  }
  if (line.fulfilment !== "delivered" || !line.deliveredAt) return { allowed: false, reason: "warranty.notDelivered" };
  if (claims.some(claim => isOpenClaim(claim.status))) return { allowed: false, reason: "warranty.openClaim" };
  if (returns.some(request => isOpenReturn(request.status))) return { allowed: false, reason: "warranty.openReturn" };
  return { allowed: true };
}

/** What is wrong with the shopper's words, or null. A phone number or a link is the off-platform sale. */
export function problemIssue(text: string): "warranty.tooShort" | "warranty.tooLong" | "warranty.contactDetails" | null {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length < MIN_WARRANTY_PROBLEM) return "warranty.tooShort";
  if (trimmed.length > MAX_WARRANTY_PROBLEM) return "warranty.tooLong";
  if (contactFindings(trimmed).length) return "warranty.contactDetails";
  return null;
}

/** What is wrong with the store's answer, or null. A refusal must say why. */
export function responseIssue(text: string, declining: boolean): "warranty.needsReason" | "warranty.responseTooLong" | "warranty.contactDetails" | null {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (declining && !trimmed) return "warranty.needsReason";
  if (trimmed.length > MAX_WARRANTY_RESPONSE) return "warranty.responseTooLong";
  if (trimmed && contactFindings(trimmed).length) return "warranty.contactDetails";
  return null;
}

export type WarrantyAction = "accept" | "decline" | "complete" | "withdraw";

/** What may be done to a claim in this state, by whom. */
export function warrantyActions(claim: { status: string; remedy: string | null }, who: "shopper" | "store"): WarrantyAction[] {
  if (who === "shopper") return claim.status === "open" ? ["withdraw"] : [];
  if (claim.status === "open") return ["accept", "decline"];
  /* A replacement or refund is finished by the returns desk; only a repair is the store's to call done. */
  if (claim.status === "accepted" && claim.remedy === "repair") return ["complete"];
  return [];
}

/** Where a claim stands, as one word the shopper and the store both read. */
export type ClaimStage = "waiting" | "repairing" | "returning" | "done" | "declined" | "withdrawn";

/**
 * The claim's stage, reading through to the return request a replacement or
 * refund travels as: done once the swap went out or the money came back.
 */
export function claimStage(claim: { status: string; remedy: string | null }, returnStatus: string | null): ClaimStage {
  switch (claim.status) {
    case "open": return "waiting";
    case "declined": return "declined";
    case "withdrawn": return "withdrawn";
    case "completed": return "done";
    default:
      if (claim.remedy === "repair") return "repairing";
      if (returnStatus === "refunded" || returnStatus === "exchanged") return "done";
      if (returnStatus === "declined" || returnStatus === "cancelled") return "declined";
      return "returning";
  }
}
