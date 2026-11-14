/**
 * A shipment as each audience sees it, and the rules for what staff may write.
 *
 * The rules live here rather than in the server alone so the staff form says
 * what is wrong under the box, before Save, with exactly the server's words —
 * the form cannot accept what the API refuses.
 */
import { foldDigits } from "./digits.js";
import { isDay } from "./kuwait.js";
import type { Governorate } from "./kuwait.js";
import { isGovernorate } from "./kuwait.js";
import type { Status } from "./status.js";
import { isStatus } from "./status.js";

/** One update on a parcel's way, as anybody holding the number may read it. */
export type TrackingEvent = {
  status: Status;
  location: string | null;
  note: string | null;
  happenedAt: string;
};

/**
 * What the tracking page shows to whoever holds the number. Nothing about the
 * recipient: no name, no phone, no street — the area and the governorate say
 * where it is going without saying who lives there.
 */
export type PublicShipment = {
  trackingNumber: string;
  status: Status;
  senderName: string;
  governorate: Governorate | null;
  area: string | null;
  pieces: number;
  /** Cash to pay at the door, in fils (1 KWD = 1000 fils), or null. */
  codFils: number | null;
  /** The day it is expected, yyyy-mm-dd in Kuwait, or null. */
  expectedOn: string | null;
  createdAt: string;
  /** Newest first. */
  events: TrackingEvent[];
};

/** The staff desk's view: the public one and the recipient's details. */
export type StaffShipment = PublicShipment & {
  id: number;
  recipientName: string | null;
  recipientPhone: string | null;
  address: string | null;
  updatedAt: string;
};

export type ShipmentRow = Omit<StaffShipment, "events">;

export function publicView(shipment: StaffShipment): PublicShipment {
  const { trackingNumber, status, senderName, governorate, area, pieces, codFils, expectedOn, createdAt, events } = shipment;
  return { trackingNumber, status, senderName, governorate, area, pieces, codFils, expectedOn, createdAt, events };
}

export const LIMITS = { name: 80, area: 60, address: 300, location: 80, note: 280, pieces: 99, codFils: 99_999_999 } as const;

/** The details staff type for a shipment, as the form holds them. */
export type ShipmentDraft = {
  senderName: string;
  recipientName: string;
  recipientPhone: string;
  governorate: string;
  area: string;
  address: string;
  pieces: string;
  cod: string;
  expectedOn: string;
};

export type ShipmentDetails = {
  senderName: string;
  recipientName: string | null;
  recipientPhone: string | null;
  governorate: Governorate;
  area: string | null;
  address: string | null;
  pieces: number;
  codFils: number | null;
  expectedOn: string | null;
};

export type Problems<K extends string> = Partial<Record<K, string>>;

const trimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const orNull = (value: string) => (value ? value : null);

/**
 * A Kuwaiti number, eight digits, as the driver dials it: "+965", "00965" and
 * spaces are fine, and Arabic-Indic digits are digits.
 */
export function kuwaitPhone(input: string): string | null {
  const digits = foldDigits(input).replace(/[\s\-()]/g, "").replace(/^(\+|00)?965(?=\d{8}$)/, "");
  return /^[245689]\d{7}$/.test(digits) ? digits : null;
}

/** "12.5", "12.500", "١٢٫٥" as fils; null for anything that is not an amount. */
export function filsOf(input: string): number | null {
  const text = foldDigits(input).replace(/٫/g, ".").replace(/,/g, "").trim();
  if (!/^\d{1,5}(\.\d{1,3})?$/.test(text)) return null;
  const [whole, part = ""] = text.split(".");
  return Number(whole) * 1000 + Number(part.padEnd(3, "0"));
}

export function shipmentProblems(draft: Partial<ShipmentDraft>): { details: ShipmentDetails | null; problems: Problems<keyof ShipmentDraft> } {
  const problems: Problems<keyof ShipmentDraft> = {};
  const senderName = trimmed(draft.senderName);
  if (!senderName) problems.senderName = "form.senderNeeded";
  else if (senderName.length > LIMITS.name) problems.senderName = "form.tooLong";

  const recipientName = trimmed(draft.recipientName);
  if (recipientName.length > LIMITS.name) problems.recipientName = "form.tooLong";

  const phoneText = trimmed(draft.recipientPhone);
  const phone = phoneText ? kuwaitPhone(phoneText) : null;
  if (phoneText && !phone) problems.recipientPhone = "form.phoneShape";

  const governorate = trimmed(draft.governorate);
  if (!isGovernorate(governorate)) problems.governorate = "form.governorateNeeded";

  const area = trimmed(draft.area);
  if (area.length > LIMITS.area) problems.area = "form.tooLong";
  const address = trimmed(draft.address);
  if (address.length > LIMITS.address) problems.address = "form.tooLong";

  const piecesText = foldDigits(trimmed(draft.pieces) || "1");
  const pieces = /^\d{1,2}$/.test(piecesText) ? Number(piecesText) : NaN;
  if (!(pieces >= 1 && pieces <= LIMITS.pieces)) problems.pieces = "form.piecesShape";

  const codText = trimmed(draft.cod);
  const codFils = codText ? filsOf(codText) : null;
  if (codText && codFils === null) problems.cod = "form.amountShape";

  const expectedOn = trimmed(draft.expectedOn);
  if (expectedOn && !isDay(expectedOn)) problems.expectedOn = "form.dayShape";

  if (Object.keys(problems).length) return { details: null, problems };
  return {
    details: {
      senderName,
      recipientName: orNull(recipientName),
      recipientPhone: phone,
      governorate: governorate as Governorate,
      area: orNull(area),
      address: orNull(address),
      pieces,
      codFils: codFils && codFils > 0 ? codFils : null,
      expectedOn: orNull(expectedOn),
    },
    problems,
  };
}

/** An update staff add: what happened, where, a note the customer reads, and when. */
export type UpdateDraft = { status: string; location: string; note: string; happenedAt: string; expectedOn: string };
export type UpdateDetails = { status: Status; location: string | null; note: string | null; happenedAt: Date; expectedOn: string | null };

/** How far ahead of the server's clock an update may be dated: a few minutes of a laptop's drift, no more. */
const FUTURE_SLACK_MS = 10 * 60 * 1000;

export function updateProblems(draft: Partial<{ status: unknown; location: unknown; note: unknown; happenedAt: unknown; expectedOn: unknown }>, now: Date): { update: UpdateDetails | null; problems: Problems<keyof UpdateDraft> } {
  const problems: Problems<keyof UpdateDraft> = {};
  if (!isStatus(draft.status)) problems.status = "form.statusNeeded";
  const location = trimmed(draft.location);
  if (location.length > LIMITS.location) problems.location = "form.tooLong";
  const note = trimmed(draft.note);
  if (note.length > LIMITS.note) problems.note = "form.tooLong";
  const when = trimmed(draft.happenedAt);
  const happenedAt = when ? new Date(when) : now;
  if (Number.isNaN(happenedAt.getTime())) problems.happenedAt = "form.timeShape";
  else if (happenedAt.getTime() > now.getTime() + FUTURE_SLACK_MS) problems.happenedAt = "form.timeFuture";
  const expectedOn = trimmed(draft.expectedOn);
  if (expectedOn && !isDay(expectedOn)) problems.expectedOn = "form.dayShape";
  if (Object.keys(problems).length) return { update: null, problems };
  return {
    update: { status: draft.status as Status, location: orNull(location), note: orNull(note), happenedAt, expectedOn: orNull(expectedOn) },
    problems,
  };
}

/** A draft from a stored shipment, for the edit form. */
export function draftOf(row: ShipmentRow): ShipmentDraft {
  return {
    senderName: row.senderName,
    recipientName: row.recipientName ?? "",
    recipientPhone: row.recipientPhone ?? "",
    governorate: row.governorate ?? "",
    area: row.area ?? "",
    address: row.address ?? "",
    pieces: String(row.pieces),
    cod: row.codFils ? (row.codFils / 1000).toFixed(3) : "",
    expectedOn: row.expectedOn ?? "",
  };
}
