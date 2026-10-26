/**
 * Payout transfer files (3.3.21): what NetLet hands its bank so the payouts
 * go out in one upload rather than one typed transfer per seller.
 *
 * Pure, for the reason `payoutRuns.ts` is: what it writes is where money goes.
 *
 * ## A run is frozen before the money moves, not after
 *
 * Recording a payout used to recompute the batch at the moment somebody
 * pressed "sent" — after they had already sent the figure the page showed. In
 * between, a placement could accrue another day's fee at midnight, an order
 * could come due, a refund could land, and the ledger then recorded a figure
 * that never left the bank: a seller paid for an order the ledger said was
 * still owed, or an order recorded as paid that nobody sent. So a run is
 * **prepared** first — the batch frozen, its lines written, the money counted
 * as committed so nothing can be prepared twice — and the transfer is made
 * from that frozen figure. "Sent" then only adds the bank's reference; it
 * changes no amount.
 *
 * ## A file is a thing, with a name the bank checks
 *
 * The file's message id is derived from a stored row, so downloading it again
 * produces the same id — and a bank refuses a second upload carrying an id it
 * has already executed, which is the only protection against paying a whole
 * file twice that does not depend on somebody remembering. A run the bank
 * refused is cancelled and drops out of the file; whatever it was owed goes
 * back into the seller's next batch.
 *
 * ## Two formats, because banks differ
 *
 * ISO 20022 `pain.001.001.03` is the credit-transfer initiation most corporate
 * banking portals accept for a bulk upload. A bank with its own spreadsheet
 * template is fed from the CSV, which carries the same five facts. Which one a
 * particular bank takes is that bank's decision; neither claims more.
 */
import { fromFils, toFils } from "../money.js";
import { isValidIban, normaliseIban } from "../inventory/storeProfile.js";

/** The most transfers one file carries. Bank portals cap a bulk upload; this is under the usual caps. */
export const MAX_FILE_TRANSFERS = 500;

export const PAYOUT_FORMATS = ["csv", "pain001"] as const;
export type PayoutFormat = (typeof PAYOUT_FORMATS)[number];

export type FileTransfer = {
  runId: number;
  /** The seller's name as frozen on the run. */
  vendorName: string;
  /** The account frozen on the run, compact. */
  iban: string;
  /** Positive, in dinars to the fil. */
  amount: string;
};

/** NetLet's own account, the one the money leaves. */
export type Debtor = { name: string; iban: string; bic: string | null };

const KUWAIT_OFFSET_MS = 3 * 3_600_000;

/** A calendar date in Kuwait, `YYYY-MM-DD`. */
export function kuwaitDate(when: Date): string {
  return new Date(when.getTime() + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The file's message id: `NLPAY-20261005-000012`. Derived from the row, so the
 * same file always carries the same id — that is what lets the bank refuse a
 * second upload. Within ISO 20022's 35 characters.
 */
export function fileReference(fileId: number, createdAt: Date): string {
  return `NLPAY-${kuwaitDate(createdAt).replaceAll("-", "")}-${String(fileId).padStart(6, "0")}`;
}

/** One transfer's end-to-end id, which the bank carries through to the seller's statement: `NLPO-12`. */
export function transferReference(runId: number): string {
  return `NLPO-${runId}`;
}

/** An IBAN as a bank file wants it: no spaces, upper case, a Kuwaiti bank code in letters (`normaliseIban`). */
export function compactIban(iban: string): string {
  return normaliseIban(iban);
}

/** A bank identifier code: 8 or 11 characters, bank, country, location, branch. */
export function isValidBic(bic: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic);
}

export type DebtorProblem = "payouts.noDebtorName" | "payouts.noDebtorIban" | "payouts.badDebtorIban" | "payouts.badDebtorBic";

/**
 * What stops NetLet's own account being written into an ISO 20022 file, or
 * null. The CSV needs none of it — it names only the people being paid.
 */
export function debtorProblem(debtor: { name: string; iban: string; bic: string }): DebtorProblem | null {
  if (!debtor.name.trim()) return "payouts.noDebtorName";
  if (!debtor.iban.trim()) return "payouts.noDebtorIban";
  if (!isValidIban(debtor.iban)) return "payouts.badDebtorIban";
  if (debtor.bic.trim() && !isValidBic(debtor.bic.trim().toUpperCase())) return "payouts.badDebtorBic";
  return null;
}

/** Whitespace and control characters flattened, so a name cannot break a line or a field. */
function flatten(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * One CSV field. Quoted always; a quote doubled; and a field a spreadsheet
 * would read as a formula is prefixed with an apostrophe — a seller names
 * their own store, and this file is opened in a spreadsheet on the machine
 * that sends money.
 */
export function csvCell(value: string): string {
  const flat = flatten(value);
  const safe = /^[=+\-@]/.test(flat) ? `'${flat}` : flat;
  return `"${safe.replaceAll('"', '""')}"`;
}

/**
 * The CSV: one row per transfer, CRLF as RFC 4180 says, and a byte-order mark
 * so a spreadsheet opens an Arabic store name as Arabic rather than as noise.
 */
export function payoutCsv(transfers: readonly FileTransfer[]): string {
  const rows = [["Beneficiary name", "Beneficiary IBAN", "Amount", "Currency", "Payment reference", "Details"]];
  for (const transfer of transfers) {
    rows.push([transfer.vendorName, compactIban(transfer.iban), fromFils(toFils(transfer.amount)), "KWD", transferReference(transfer.runId), `NetLet payout ${transferReference(transfer.runId)}`]);
  }
  return `﻿${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** Text as XML content, flattened and cut to the element's limit — by characters, never mid-pair. */
export function xmlText(value: string, max: number): string {
  const cut = Array.from(flatten(value)).slice(0, max).join("");
  return cut.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

/** Every transfer's amount added, exactly. */
export function controlSum(transfers: readonly FileTransfer[]): string {
  return fromFils(transfers.reduce((sum, transfer) => sum + toFils(transfer.amount), 0n));
}

/**
 * ISO 20022 `pain.001.001.03`, one payment information block, one transfer
 * per run. The execution date is the day the file is downloaded rather than
 * the day it was made: a file made on Thursday and uploaded on Sunday should
 * not ask the bank for Thursday.
 */
export function pain001(input: { reference: string; createdAt: Date; executionDate: string; debtor: Debtor; transfers: readonly FileTransfer[] }): string {
  const { reference, createdAt, executionDate, debtor, transfers } = input;
  const count = String(transfers.length);
  const sum = controlSum(transfers);
  const agent = debtor.bic
    ? `<FinInstnId><BIC>${xmlText(debtor.bic.toUpperCase(), 11)}</BIC></FinInstnId>`
    : "<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>";
  const lines = transfers.map(transfer => [
    "      <CdtTrfTxInf>",
    `        <PmtId><EndToEndId>${transferReference(transfer.runId)}</EndToEndId></PmtId>`,
    `        <Amt><InstdAmt Ccy="KWD">${fromFils(toFils(transfer.amount))}</InstdAmt></Amt>`,
    `        <Cdtr><Nm>${xmlText(transfer.vendorName, 140)}</Nm></Cdtr>`,
    `        <CdtrAcct><Id><IBAN>${compactIban(transfer.iban)}</IBAN></Id></CdtrAcct>`,
    `        <RmtInf><Ustrd>${xmlText(`NetLet payout ${transferReference(transfer.runId)}`, 140)}</Ustrd></RmtInf>`,
    "      </CdtTrfTxInf>",
  ].join("\n"));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    "  <CstmrCdtTrfInitn>",
    "    <GrpHdr>",
    `      <MsgId>${xmlText(reference, 35)}</MsgId>`,
    `      <CreDtTm>${createdAt.toISOString().slice(0, 19)}</CreDtTm>`,
    `      <NbOfTxs>${count}</NbOfTxs>`,
    `      <CtrlSum>${sum}</CtrlSum>`,
    `      <InitgPty><Nm>${xmlText(debtor.name, 140)}</Nm></InitgPty>`,
    "    </GrpHdr>",
    "    <PmtInf>",
    `      <PmtInfId>${xmlText(reference, 35)}</PmtInfId>`,
    "      <PmtMtd>TRF</PmtMtd>",
    `      <NbOfTxs>${count}</NbOfTxs>`,
    `      <CtrlSum>${sum}</CtrlSum>`,
    `      <ReqdExctnDt>${executionDate}</ReqdExctnDt>`,
    `      <Dbtr><Nm>${xmlText(debtor.name, 140)}</Nm></Dbtr>`,
    `      <DbtrAcct><Id><IBAN>${compactIban(debtor.iban)}</IBAN></Id><Ccy>KWD</Ccy></DbtrAcct>`,
    `      <DbtrAgt>${agent}</DbtrAgt>`,
    ...lines,
    "    </PmtInf>",
    "  </CstmrCdtTrfInitn>",
    "</Document>",
    "",
  ].join("\n");
}
