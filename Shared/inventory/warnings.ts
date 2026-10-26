/**
 * Warnings NetLet gives a store, and when they suspend it (3.3.18:
 * "automatic suspension of a vendor's account after 3 violation warnings").
 * Migration 0066. Pure and shared, so the store's page and the API count the
 * same way.
 *
 * **A warning is issued on purpose, never inferred.** The third product
 * rejection in a store's life used to suspend it: a missing photo counted
 * like a counterfeit, nobody was told they were at two, the count never
 * lapsed, and a reinstated store was suspended again by its next rejection.
 * Now an administrator issues a warning with a reason the store reads, the
 * store's people are told at once, and only warnings still standing count.
 *
 * **Standing** is issued after the store's count last restarted
 * (`warningsSince`, set on reinstatement), not withdrawn, and not past
 * `WARNING_DAYS` — so a store that was reinstated is not suspended again by
 * the warnings that suspended it, and an old warning stops counting by
 * itself, with nothing running to expire it.
 */

/** How long a warning stands. */
export const WARNING_DAYS = 365;
/** The number of standing warnings that suspends a store. */
export const SUSPEND_AT_WARNINGS = 3;
export const MAX_WARNING_REASON = 400;

const DAY_MS = 86_400_000;

export type WarningFacts = { createdAt: Date; expiresAt: Date; withdrawnAt: Date | null };

export type WarningState = "standing" | "lapsed" | "withdrawn" | "cleared";

/** When a warning issued now stops counting. */
export function warningExpiry(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + WARNING_DAYS * DAY_MS);
}

/**
 * What a warning is now. `cleared` is one issued before the store's count
 * restarted — it happened, and the store's page still shows it, but it no
 * longer counts toward a suspension.
 */
export function warningState(warning: WarningFacts, since: Date | null, now: Date = new Date()): WarningState {
  if (warning.withdrawnAt) return "withdrawn";
  if (since && warning.createdAt.getTime() < since.getTime()) return "cleared";
  if (warning.expiresAt.getTime() <= now.getTime()) return "lapsed";
  return "standing";
}

export function standingCount(warnings: readonly WarningFacts[], since: Date | null, now: Date = new Date()): number {
  return warnings.filter(warning => warningState(warning, since, now) === "standing").length;
}

/** Whether this many standing warnings suspend a store. */
export function suspends(standing: number): boolean {
  return standing >= SUSPEND_AT_WARNINGS;
}

export function warningReasonProblem(reason: string): "warnings.needsReason" | "warnings.tooLong" | null {
  const trimmed = reason.trim();
  if (!trimmed) return "warnings.needsReason";
  if (trimmed.length > MAX_WARNING_REASON) return "warnings.tooLong";
  return null;
}
