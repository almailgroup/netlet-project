import { describe, expect, it } from "vitest";
import {
  MAX_DOCUMENT_BYTES,
  currentByKind,
  documentProblem,
  documentsPending,
  safeFileName,
  sniffDocument,
  type DocumentFacts,
} from "./applicationDocuments.js";

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(values.flatMap(value => (typeof value === "string" ? [...value].map(c => c.charCodeAt(0)) : [value])));

const pdf = bytes("%PDF-1.7\n", 0x0a);
const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const png = bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const webp = bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 ");

describe("what a file is", () => {
  it("is read from its first bytes", () => {
    expect(sniffDocument(pdf)).toBe("application/pdf");
    expect(sniffDocument(jpeg)).toBe("image/jpeg");
    expect(sniffDocument(png)).toBe("image/png");
    expect(sniffDocument(webp)).toBe("image/webp");
    expect(sniffDocument(bytes("<html><script>"))).toBeNull();
    expect(sniffDocument(bytes("RIFF", 0, 0, 0, 0, "AVI "))).toBeNull();
  });

  it("must be what it was declared as, and not too big", () => {
    expect(documentProblem(pdf, "application/pdf")).toBeNull();
    expect(documentProblem(pdf, "Application/PDF; charset=binary")).toBeNull();
    expect(documentProblem(pdf, "image/jpeg")).toBe("documents.wrongType");
    expect(documentProblem(bytes("<svg onload=alert(1)>"), "image/png")).toBe("documents.notAccepted");
    expect(documentProblem(new Uint8Array(), "application/pdf")).toBe("documents.empty");
    const huge = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
    huge.set(pdf);
    expect(documentProblem(huge, "application/pdf")).toBe("documents.tooLarge");
  });
});

describe("a file name safe to keep and to hand back", () => {
  it("drops any path and ends in the extension the bytes earned", () => {
    expect(safeFileName("C:\\Users\\me\\licence.PDF", "application/pdf")).toBe("licence.pdf");
    expect(safeFileName("../../etc/passwd", "image/png")).toBe("passwd.png");
    expect(safeFileName("licence.pdf.exe", "application/pdf")).toBe("licence.pdf.pdf");
    expect(safeFileName("scan", "image/jpeg")).toBe("scan.jpg");
  });

  it("keeps Arabic, refuses control and direction characters, and is never empty", () => {
    expect(safeFileName("رخصة تجارية.pdf", "application/pdf")).toBe("رخصة تجارية.pdf");
    expect(safeFileName("invoice\u202Efdp.exe", "application/pdf")).toBe("invoicefdp.pdf");
    expect(safeFileName("a\"b\r\nc.pdf", "application/pdf")).toBe("abc.pdf");
    expect(safeFileName("   ", "image/webp")).toBe("document.webp");
    expect(safeFileName(null, "application/pdf")).toBe("document.pdf");
    expect(safeFileName("x".repeat(400) + ".pdf", "application/pdf").length).toBeLessThanOrEqual(200);
  });
});

describe("which files still matter", () => {
  const at = (day: number) => new Date(Date.UTC(2026, 9, day));
  const doc = (id: number, kind: DocumentFacts["kind"], status: DocumentFacts["status"], day: number): DocumentFacts => ({ id, kind, status, createdAt: at(day) });

  it("is each kind's newest, and the accepted one it would replace", () => {
    const current = currentByKind([
      doc(1, "trade_licence", "accepted", 1),
      doc(2, "trade_licence", "rejected", 2),
      doc(3, "trade_licence", "pending", 3),
      doc(4, "signatory_id", "accepted", 2),
    ]);
    expect(current.get("trade_licence")).toMatchObject({ latest: { id: 3 }, replacing: { id: 1 } });
    expect(current.get("signatory_id")).toMatchObject({ latest: { id: 4 }, replacing: null });
    expect(current.has("iban_letter")).toBe(false);
  });

  it("holds approval while any kind's newest waits", () => {
    expect(documentsPending([doc(1, "trade_licence", "accepted", 1), doc(2, "iban_letter", "rejected", 2)])).toBe(false);
    expect(documentsPending([doc(1, "trade_licence", "accepted", 1), doc(2, "trade_licence", "pending", 2)])).toBe(true);
    /* An old pending file a newer one superseded is not waiting on anybody. */
    expect(documentsPending([doc(1, "trade_licence", "pending", 1), doc(2, "trade_licence", "rejected", 2)])).toBe(false);
  });
});
