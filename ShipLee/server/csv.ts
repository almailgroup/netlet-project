/**
 * The staff desk's export: the shipments a search and a filter show, as a
 * spreadsheet a person opens in Excel or Numbers.
 *
 * A byte-order mark first, or Excel reads the Arabic as noise; every field
 * quoted; and a field that starts like a formula (= + - @, or a tab or a
 * return) is given a leading apostrophe, so a sender's name typed as
 * "=HYPERLINK(...)" is shown as text rather than run on the accountant's
 * computer.
 */
import type { ShipmentRow } from "../shared/shipment.js";
import { translate } from "../shared/i18n.js";
import type { Lang } from "../shared/i18n.js";
import { governorateName } from "../shared/kuwait.js";

function cell(value: string | number | null): string {
  let text = value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** An instant as Kuwait's wall clock, "2026-11-14 15:20", which a spreadsheet reads as a date. */
function kuwaitTime(at: string): string {
  return new Date(new Date(at).getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");
}

export function shipmentsCsv(rows: ShipmentRow[], lang: Lang): string {
  const head = [
    "export.number", "export.status", "export.sender", "export.recipient", "export.phone", "export.governorate",
    "export.area", "export.address", "export.pieces", "export.cod", "export.expected", "export.created", "export.updated",
  ] as const;
  const lines = [head.map(key => cell(translate(lang, key))).join(",")];
  for (const row of rows) {
    lines.push([
      row.trackingNumber,
      translate(lang, `status.${row.status}`),
      row.senderName,
      row.recipientName,
      row.recipientPhone,
      row.governorate ? governorateName(row.governorate, lang) : null,
      row.area,
      row.address,
      row.pieces,
      row.codFils === null ? null : (row.codFils / 1000).toFixed(3),
      row.expectedOn,
      kuwaitTime(row.createdAt),
      kuwaitTime(row.updatedAt),
    ].map(cell).join(","));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
