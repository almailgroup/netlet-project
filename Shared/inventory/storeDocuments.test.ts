import { describe, expect, it } from "vitest";
import { en } from "../i18n/dictionary.js";
import {
  EXPIRY_SOON_DAYS,
  STORE_DOCUMENT_KINDS,
  STORE_DOCUMENT_KIND_LABEL,
  STORE_DOCUMENT_TITLE_MAX,
  cleanDocumentTitle,
  expiryState,
  isStoreDocumentKind,
  mayRemoveDocument,
  readExpiry,
} from "./storeDocuments.js";

describe("store documents, the rule", () => {
  it("names every kind, within the column's width", () => {
    for (const kind of STORE_DOCUMENT_KINDS) {
      expect(kind.length).toBeLessThanOrEqual(24);
      expect(en[STORE_DOCUMENT_KIND_LABEL[kind]]).toBeTruthy();
    }
    expect(new Set(STORE_DOCUMENT_KINDS.map(kind => en[STORE_DOCUMENT_KIND_LABEL[kind]])).size).toBe(STORE_DOCUMENT_KINDS.length);
    expect(isStoreDocumentKind("trade_licence")).toBe(true);
    expect(isStoreDocumentKind("signed_contract")).toBe(false);
    expect(isStoreDocumentKind(undefined)).toBe(false);
  });

  it("stores a title as one clean line, or none", () => {
    expect(cleanDocumentTitle("  Licence   2026 \n renewal ")).toBe("Licence 2026 renewal");
    expect(cleanDocumentTitle("رخصة ٢٠٢٦")).toBe("رخصة ٢٠٢٦");
    /* Nothing invisible: a NUL, a direction override, a zero-width space. */
    expect(cleanDocumentTitle("Bank\u0000 letter‮​")).toBe("Bank letter");
    expect(cleanDocumentTitle("   ")).toBeNull();
    expect(cleanDocumentTitle(null)).toBeNull();
    expect(cleanDocumentTitle("x".repeat(300))).toHaveLength(STORE_DOCUMENT_TITLE_MAX);
  });

  it("reads a last day as a real calendar day, or nothing", () => {
    expect(readExpiry("")).toEqual({ ok: true, day: null });
    expect(readExpiry(null)).toEqual({ ok: true, day: null });
    expect(readExpiry("2027-01-31")).toEqual({ ok: true, day: "2027-01-31" });
    /* A day already gone is how an expired licence gets recorded. */
    expect(readExpiry("2021-06-30")).toEqual({ ok: true, day: "2021-06-30" });
    for (const bad of ["2026-02-30", "2026-13-01", "31/01/2027", "2027-1-31", "1999-12-31", "2101-01-01", "soon"]) {
      expect(readExpiry(bad)).toEqual({ ok: false });
    }
  });

  it("says where a paper stands against today", () => {
    const today = "2026-11-11";
    expect(expiryState(null, today)).toEqual({ kind: "none" });
    expect(expiryState("not a day", today)).toEqual({ kind: "none" });
    /* Good for the whole of its last day. */
    expect(expiryState("2026-11-11", today)).toEqual({ kind: "soon", days: 0 });
    expect(expiryState("2026-11-10", today)).toEqual({ kind: "expired", days: 1 });
    expect(expiryState("2025-11-11", today)).toEqual({ kind: "expired", days: 365 });
    expect(expiryState("2026-12-11", today)).toEqual({ kind: "soon", days: EXPIRY_SOON_DAYS });
    expect(expiryState("2026-12-12", today)).toEqual({ kind: "valid" });
    /* Across a month's end and a leap day. */
    expect(expiryState("2028-03-01", "2028-02-28")).toEqual({ kind: "soon", days: 2 });
  });

  it("lets NetLet remove any file and a store only its own", () => {
    expect(mayRemoveDocument("netlet", { byStore: false, netletOnly: true })).toBe(true);
    expect(mayRemoveDocument("netlet", { byStore: true, netletOnly: false })).toBe(true);
    expect(mayRemoveDocument("store", { byStore: true, netletOnly: false })).toBe(true);
    expect(mayRemoveDocument("store", { byStore: false, netletOnly: false })).toBe(false);
    expect(mayRemoveDocument("store", { byStore: true, netletOnly: true })).toBe(false);
  });
});
