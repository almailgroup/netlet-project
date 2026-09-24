import { describe, expect, it } from "vitest";
import {
  AGREEMENT_VERSION, applicationProblems, editableByApplicant, missingFromApplication,
  readyToApprove, type SellerApplication,
} from "./sellerApplication.js";

const complete = (over: Partial<SellerApplication> = {}): SellerApplication => ({
  storeName: "Harbour Lighting",
  contactEmail: "hello@harbour.test",
  contactPhone: "+965 9123 4567",
  governorate: "hawalli",
  addressLine: "Block 4, Street 12",
  licenceNumber: "TL-99812",
  payoutIban: "KW81CBKU0000000000001234560101",
  underPlatformLicence: false,
  agreementVersion: AGREEMENT_VERSION,
  ...over,
});

describe("what is refused as typed", () => {
  it("takes a complete application", () => {
    expect(applicationProblems(complete())).toEqual([]);
  });

  it("refuses one with no store name", () => {
    expect(applicationProblems(complete({ storeName: "  " }))).toEqual(["application.noName"]);
  });

  /* A transposed pair of digits passes any length check and sends money to an
     account that does not exist. */
  it("refuses an IBAN that fails the mod-97 check", () => {
    expect(applicationProblems(complete({ payoutIban: "KW81CBKU0000000000001234560102" })))
      .toEqual(["application.badIban"]);
  });

  it("refuses a phone and a governorate that cannot be what they claim", () => {
    expect(applicationProblems(complete({ contactPhone: "12345" }))).toEqual(["application.badPhone"]);
    expect(applicationProblems(complete({ governorate: "atlantis" }))).toEqual(["application.badGovernorate"]);
  });

  /* The one place a seller hands over an identity paper. */
  it("refuses a document link that is not https", () => {
    expect(applicationProblems(complete({ licenceDocUrl: "http://example.com/licence.pdf" })))
      .toEqual(["application.insecureDocument"]);
    expect(applicationProblems(complete({ identityDocUrl: "https://example.com/id.pdf" }))).toEqual([]);
  });

  /* Absent is fine: an application is a draft somebody comes back to. */
  it("does not refuse an application for what is merely missing", () => {
    expect(applicationProblems({ storeName: "Harbour Lighting" })).toEqual([]);
  });
});

describe("what is still missing", () => {
  it("is nothing for a complete one", () => {
    expect(missingFromApplication(complete())).toEqual([]);
  });

  it("lists the gaps in the order the form asks for them", () => {
    expect(missingFromApplication({ storeName: "Harbour", agreementVersion: AGREEMENT_VERSION }))
      .toEqual(["contactEmail", "contactPhone", "governorate", "addressLine", "payoutIban", "licenceNumber"]);
  });

  /* Somebody trading under NetLet's licence has no number of their own, so
     demanding one makes that case impossible to fill in. */
  it("does not ask for a licence number from somebody using NetLet's", () => {
    expect(missingFromApplication(complete({ licenceNumber: null, underPlatformLicence: true }))).toEqual([]);
  });

  /* "They accepted the terms" means nothing without "which terms". */
  it("counts an unaccepted or outdated agreement as missing", () => {
    expect(missingFromApplication(complete({ agreementVersion: null }))).toEqual(["agreement"]);
    expect(missingFromApplication(complete({ agreementVersion: "2019-01-01" }))).toEqual(["agreement"]);
  });
});

describe("approving", () => {
  it("allows a complete application", () => {
    expect(readyToApprove(complete())).toEqual({ ok: true });
  });

  /* A refusal that is a list is one somebody can act on. */
  it("refuses with both the gaps and the faults named", () => {
    const verdict = readyToApprove(complete({ payoutIban: "KW00BAD", addressLine: null }));
    expect(verdict).toMatchObject({
      ok: false,
      missing: ["addressLine"],
      problems: ["application.badIban"],
    });
  });
});

describe("who may still edit it", () => {
  /* A rejected one can be corrected and sent again — the point of saying why. */
  it("lets the applicant fix a draft or a rejection, and nothing else", () => {
    expect(editableByApplicant("draft")).toBe(true);
    expect(editableByApplicant("rejected")).toBe(true);
    expect(editableByApplicant("submitted")).toBe(false);
    expect(editableByApplicant("approved")).toBe(false);
  });
});
