import { describe, expect, it } from "vitest";
import { controlSum, csvCell, debtorProblem, fileReference, kuwaitDate, pain001, payoutCsv, transferReference, xmlText, type FileTransfer } from "./payoutFile.js";

const transfers: FileTransfer[] = [
  { runId: 7, vendorName: "Acme & Sons", iban: "KW81 CBKU 0000 0000 0000 1234 5601 01", amount: "198.400" },
  { runId: 9, vendorName: "متجر نورة", iban: "kw81cbku0000000000001234560101", amount: "0.125" },
];

describe("references", () => {
  it("names a file by its row and the Kuwaiti day it was made, within ISO's 35 characters", () => {
    /* 22:30 UTC on the 4th is already the 5th in Kuwait. */
    expect(fileReference(12, new Date("2026-10-04T22:30:00Z"))).toBe("NLPAY-20261005-000012");
    expect(fileReference(1_234_567, new Date("2026-10-04T10:00:00Z")).length).toBeLessThanOrEqual(35);
    expect(kuwaitDate(new Date("2026-10-04T20:59:59Z"))).toBe("2026-10-04");
    expect(transferReference(7)).toBe("NLPO-7");
  });
});

describe("the CSV", () => {
  it("carries the five facts per transfer, exactly, with a header and CRLF", () => {
    const csv = payoutCsv(transfers);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe("");
    expect(lines[1]).toBe('"Acme & Sons","KW81CBKU0000000000001234560101","198.400","KWD","NLPO-7","NetLet payout NLPO-7"');
    expect(lines[2]).toContain('"متجر نورة","KW81CBKU0000000000001234560101","0.125"');
  });

  it("cannot be turned into a formula or a second row by a store's name", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell("+1")).toBe("\"'+1\"");
    expect(csvCell("-2")).toBe("\"'-2\"");
    expect(csvCell("@SUM(A1)")).toBe("\"'@SUM(A1)\"");
    /* A control character first would hide the formula from a naive check. */
    expect(csvCell("\t=1+1")).toBe("\"'=1+1\"");
    expect(csvCell("Line one\r\nLine two")).toBe('"Line one Line two"');
  });
});

describe("the ISO 20022 file", () => {
  const debtor = { name: "NetLet <General Trading>", iban: "KW81CBKU0000000000001234560101", bic: null };
  const xml = pain001({ reference: "NLPAY-20261005-000012", createdAt: new Date("2026-10-05T08:00:00.123Z"), executionDate: "2026-10-06", debtor, transfers });

  it("counts and sums what it carries, to the fil", () => {
    expect(controlSum(transfers)).toBe("198.525");
    expect(xml.match(/<NbOfTxs>2<\/NbOfTxs>/g)).toHaveLength(2);
    expect(xml.match(/<CtrlSum>198.525<\/CtrlSum>/g)).toHaveLength(2);
    expect(xml).toContain('<InstdAmt Ccy="KWD">0.125</InstdAmt>');
    expect(xml).toContain("<EndToEndId>NLPO-9</EndToEndId>");
    expect(xml).toContain("<ReqdExctnDt>2026-10-06</ReqdExctnDt>");
    expect(xml).toContain("<CreDtTm>2026-10-05T08:00:00</CreDtTm>");
  });

  it("escapes every name, and says NOTPROVIDED rather than inventing a bank code", () => {
    expect(xml).toContain("<Nm>NetLet &lt;General Trading&gt;</Nm>");
    expect(xml).toContain("<Nm>Acme &amp; Sons</Nm>");
    expect(xml).toContain("<IBAN>KW81CBKU0000000000001234560101</IBAN>");
    expect(xml).toContain("<Othr><Id>NOTPROVIDED</Id></Othr>");
    expect(pain001({ reference: "R", createdAt: new Date(), executionDate: "2026-10-06", debtor: { ...debtor, bic: "nbokkwkw" }, transfers })).toContain("<BIC>NBOKKWKW</BIC>");
  });

  it("cuts long text by characters, never splitting one", () => {
    expect(Array.from(xmlText("😀".repeat(200), 140))).toHaveLength(140);
    expect(xmlText("a\u0000b\u2028c", 10)).toBe("a b c");
  });
});

describe("NetLet's own account", () => {
  it("names what is missing or wrong, and nothing when it is right", () => {
    expect(debtorProblem({ name: "", iban: "", bic: "" })).toBe("payouts.noDebtorName");
    expect(debtorProblem({ name: "NetLet", iban: "", bic: "" })).toBe("payouts.noDebtorIban");
    expect(debtorProblem({ name: "NetLet", iban: "KW81CBKU0000000000001234560102", bic: "" })).toBe("payouts.badDebtorIban");
    expect(debtorProblem({ name: "NetLet", iban: "KW81CBKU0000000000001234560101", bic: "NBK" })).toBe("payouts.badDebtorBic");
    expect(debtorProblem({ name: "NetLet", iban: "KW81CBKU0000000000001234560101", bic: "nbokkwkwxxx" })).toBeNull();
    expect(debtorProblem({ name: "NetLet", iban: "KW81 CBKU 0000 0000 0000 1234 5601 01", bic: "" })).toBeNull();
  });
});
