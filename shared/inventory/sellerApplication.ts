/**
 * Somebody asking to sell on NetLet, and what has to be true before they can.
 *
 * Requirement 3.3.1: account → choose vendor → documents → contract → approval.
 * Until now a store could only exist because an administrator made it, which
 * meant every seller arrived through a conversation and nobody could start on
 * their own.
 *
 * Pure, because the two decisions here both cost something real: what is
 * refused at the door, and what is refused at approval. A rule you can only
 * exercise by filling a form in and waiting for somebody to press approve is
 * one nobody checks.
 *
 * ## Saving is easy and approving is strict
 *
 * An application is a draft somebody comes back to. Refusing to *save* it
 * because the trade licence is on a document nobody has scanned is the mistake
 * `missingStoreDetails` already avoids on the store record — so the form takes
 * what it is given and `missingFromApplication` reports the rest.
 *
 * **Approval is the guarded step**, because approving is what creates the
 * store: an approved application with no contact details and no licence is a
 * vendor row an administrator will have to go back and finish, which is the
 * arrangement where nobody does. `readyToApprove` names what is still needed,
 * so the refusal is a list rather than a shrug.
 *
 * One thing is refused even on a save: **an IBAN that fails the mod-97 check**.
 * A transposed pair of digits passes any length check and sends money to an
 * account that does not exist, and the applicant is the one person who can fix
 * it while they are still looking at it.
 *
 * ## Documents are links, and that is honest rather than ideal
 *
 * NetLet has no upload pipeline — a vendor types an image URL for a product
 * for the same reason — so an applicant gives a link to their licence rather
 * than a file. Pretending otherwise would be a file picker that drops what it
 * is given. What this does refuse is a link that is not `https`: a document
 * fetched over plain http on somebody's phone is a document read in transit.
 *
 * ## The agreement is recorded with its version
 *
 * "They accepted the terms" means nothing without "which terms". `AGREEMENT_VERSION`
 * is frozen onto the application at the moment it is accepted, so a term added
 * next year does not retroactively become something last year's seller agreed
 * to — the same reason an order freezes its commission rate.
 */
import { DEFAULT_COMMISSION_PERCENT } from "./commission.js";
import { isValidIban, isValidKuwaitPhone, isGovernorate } from "./storeProfile.js";

/**
 * The seller agreement's version.
 *
 * A date rather than a number, because what an administrator needs to answer
 * is "which text did they see", and a date is the one identifier that can be
 * matched against a document without a lookup table.
 */
export const AGREEMENT_VERSION = "2026-09-01";

/** Where an application is. Four states, all stored: none is derived. */
export const APPLICATION_STATES = ["draft", "submitted", "approved", "rejected"] as const;
export type ApplicationState = (typeof APPLICATION_STATES)[number];

export type SellerApplication = {
  storeName: string;
  storeNameAr?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  governorate?: string | null;
  addressLine?: string | null;
  licenceNumber?: string | null;
  licenceExpiresAt?: Date | string | null;
  /** Links, because there is no upload pipeline. See the note above. */
  licenceDocUrl?: string | null;
  identityDocUrl?: string | null;
  payoutIban?: string | null;
  /**
   * Whether they intend to trade under NetLet's own licence.
   *
   * Recorded rather than inferred from a blank licence number: a seller who
   * has not handed their paperwork in is not the same as one trading under
   * ours, and collapsing the two would put NetLet's name behind somebody who
   * never asked for it — the rule `/admin/vendors` already follows.
   */
  underPlatformLicence?: boolean;
  agreementVersion?: string | null;
  /**
   * A rate the applicant would like instead of the standard one (3.3.2), and
   * why. A *proposal*: commission is outside a vendor's control entirely, so
   * this is something an administrator reads at approval, never something the
   * store is charged because it was typed.
   */
  proposedCommissionPercent?: string | null;
  commissionNote?: string | null;
};

/** How long the reason for a proposed rate may be. */
export const MAX_COMMISSION_NOTE = 500;

/**
 * Whether a proposed rate is one worth reading: a percentage, and below the
 * standard rate. Proposing the standard rate or above it is proposing nothing,
 * and saying so beats storing a "proposal" an administrator then has to puzzle
 * over.
 */
export function proposalProblem(proposed: string | null | undefined): "application.badCommission" | "application.commissionNotLower" | null {
  const value = (proposed ?? "").trim();
  if (!value) return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value) || Number.parseFloat(value) > 100) return "application.badCommission";
  if (Number.parseFloat(value) >= Number.parseFloat(DEFAULT_COMMISSION_PERCENT)) return "application.commissionNotLower";
  return null;
}

export type ApplicationProblem =
  | "application.noName"
  | "application.badIban"
  | "application.badPhone"
  | "application.badGovernorate"
  | "application.insecureDocument"
  | "application.badCommission"
  | "application.commissionNotLower";

/**
 * What is wrong with an application *as typed*, which is a short list.
 *
 * Only the things that are actively wrong rather than absent: a name it cannot
 * be saved without, a figure that would send money astray, and a shape that
 * cannot be what it claims. Everything else is reported by
 * `missingFromApplication` and refused at approval.
 */
export function applicationProblems(application: SellerApplication): ApplicationProblem[] {
  const problems: ApplicationProblem[] = [];
  const given = (value: string | null | undefined) => (value ?? "").trim();

  if (!given(application.storeName)) problems.push("application.noName");
  if (given(application.payoutIban) && !isValidIban(application.payoutIban!)) problems.push("application.badIban");
  if (given(application.contactPhone) && !isValidKuwaitPhone(application.contactPhone!)) problems.push("application.badPhone");
  if (given(application.governorate) && !isGovernorate(given(application.governorate))) problems.push("application.badGovernorate");

  /* A document fetched over plain http on somebody's phone is a document read
     in transit, and this is the one place a seller hands over an identity
     paper. Absent is fine; insecure is not. */
  for (const link of [application.licenceDocUrl, application.identityDocUrl]) {
    const url = given(link);
    if (url && !/^https:\/\//i.test(url)) {
      problems.push("application.insecureDocument");
      break;
    }
  }

  const proposal = proposalProblem(application.proposedCommissionPercent);
  if (proposal) problems.push(proposal);

  return problems;
}

/** The order the form asks for them in, so a list of gaps reads top to bottom. */
const REQUIRED_TO_APPROVE = [
  "contactEmail",
  "contactPhone",
  "governorate",
  "addressLine",
  "payoutIban",
] as const;

export type MissingField = (typeof REQUIRED_TO_APPROVE)[number] | "licenceNumber" | "agreement";

/**
 * What is still missing, reported rather than refused.
 *
 * The licence is conditional and that is the whole subtlety: a seller trading
 * under **NetLet's** licence has no number of their own to give, so demanding
 * one would make the platform-licence case impossible to fill in. Anybody
 * else needs theirs, because it is what the store will trade under.
 */
export function missingFromApplication(application: SellerApplication): MissingField[] {
  const blank = (value: string | null | undefined) => !value || value.trim() === "";
  const missing: MissingField[] = REQUIRED_TO_APPROVE.filter(field => blank(application[field]));

  if (!application.underPlatformLicence && blank(application.licenceNumber)) missing.push("licenceNumber");
  /* Accepted, and accepted to *this* version: a term added since is not
     something they agreed to. */
  if (application.agreementVersion !== AGREEMENT_VERSION) missing.push("agreement");

  return missing;
}

/**
 * Whether an administrator may approve this, and what is stopping them.
 *
 * Approving is what creates the store, so this is the strict end: an approved
 * application with no contact details is a vendor row somebody has to go back
 * and finish, which is the arrangement where nobody does.
 */
export function readyToApprove(
  application: SellerApplication,
): { ok: true } | { ok: false; missing: MissingField[]; problems: ApplicationProblem[] } {
  const problems = applicationProblems(application);
  const missing = missingFromApplication(application);
  return problems.length === 0 && missing.length === 0 ? { ok: true } : { ok: false, missing, problems };
}

/**
 * Whether this application may still be edited by the person who wrote it.
 *
 * An approved one is a store now and is edited on the store's own page; a
 * rejected one can be corrected and sent again, which is the point of saying
 * why it was rejected.
 */
export function editableByApplicant(state: ApplicationState): boolean {
  return state === "draft" || state === "rejected";
}
