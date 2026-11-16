/**
 * What a customer can ask about a parcel from its tracking page — another
 * delivery day, another address, a problem to report — and the message each
 * becomes.
 *
 * ShipLee has no inbox for these yet, so a request is a message the customer
 * sends ShipLee's team themselves, on WhatsApp or by email, with the tracking
 * number already in it: real today, with no server behind it, and the team
 * reads it where they already read their messages. The rules for what a
 * request needs live here so the form says what is missing under each box.
 */
import type { Key, Lang } from "./i18n.js";
import { translate } from "./i18n.js";
import type { Governorate } from "./kuwait.js";
import { governorateName, isGovernorate } from "./kuwait.js";
import { dayAfter, formatDay } from "./format.js";
import { LIMITS } from "./shipment.js";

export const TIME_SLOTS = ["morning", "afternoon", "evening"] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number];

export const PROBLEMS = ["damaged", "missing", "notReceived", "late", "driver", "other"] as const;
export type Problem = (typeof PROBLEMS)[number];

/** A problem described in fewer words than this is asked for more. */
export const MIN_DETAILS = 10;
export const MAX_DETAILS = 500;
/** How many days ahead a delivery can be moved to. */
export const RESCHEDULE_DAYS = 6;

export type RescheduleDraft = { day: string; slot: string; note: string };
export type AddressDraft = { governorate: string; area: string; address: string; note: string };
export type ProblemDraft = { problem: string; details: string };

export type Request =
  | { kind: "reschedule"; day: string; slot: TimeSlot; note: string }
  | { kind: "address"; governorate: Governorate; area: string; address: string; note: string }
  | { kind: "problem"; problem: Problem; details: string };

export type Problems = Partial<Record<string, Key>>;

/** The days a delivery may be moved to: from tomorrow, `RESCHEDULE_DAYS` of them, as yyyy-mm-dd. */
export function rescheduleDays(today: string): string[] {
  const days: string[] = [];
  let day = today;
  for (let i = 0; i < RESCHEDULE_DAYS; i++) days.push((day = dayAfter(day)));
  return days;
}

const isSlot = (value: string): value is TimeSlot => (TIME_SLOTS as readonly string[]).includes(value);
const isProblem = (value: string): value is Problem => (PROBLEMS as readonly string[]).includes(value);

export function readReschedule(draft: RescheduleDraft, today: string): { ok: true; request: Request } | { ok: false; problems: Problems } {
  const problems: Problems = {};
  if (!rescheduleDays(today).includes(draft.day)) problems.day = "req.dayNeeded";
  if (!isSlot(draft.slot)) problems.slot = "req.slotNeeded";
  if (draft.note.trim().length > LIMITS.note) problems.note = "form.tooLong";
  if (Object.keys(problems).length) return { ok: false, problems };
  return { ok: true, request: { kind: "reschedule", day: draft.day, slot: draft.slot as TimeSlot, note: draft.note.trim() } };
}

export function readAddress(draft: AddressDraft): { ok: true; request: Request } | { ok: false; problems: Problems } {
  const problems: Problems = {};
  if (!isGovernorate(draft.governorate)) problems.governorate = "form.governorateNeeded";
  if (!draft.area.trim()) problems.area = "req.areaNeeded";
  else if (draft.area.trim().length > LIMITS.area) problems.area = "form.tooLong";
  if (!draft.address.trim()) problems.address = "req.addressNeeded";
  else if (draft.address.trim().length > LIMITS.address) problems.address = "form.tooLong";
  if (draft.note.trim().length > LIMITS.note) problems.note = "form.tooLong";
  if (Object.keys(problems).length) return { ok: false, problems };
  return { ok: true, request: { kind: "address", governorate: draft.governorate as Governorate, area: draft.area.trim(), address: draft.address.trim(), note: draft.note.trim() } };
}

export function readProblem(draft: ProblemDraft): { ok: true; request: Request } | { ok: false; problems: Problems } {
  const problems: Problems = {};
  const details = draft.details.trim();
  if (!isProblem(draft.problem)) problems.problem = "req.problemNeeded";
  if (details.length < MIN_DETAILS) problems.details = "req.detailsShort";
  else if (details.length > MAX_DETAILS) problems.details = "form.tooLong";
  if (Object.keys(problems).length) return { ok: false, problems };
  return { ok: true, request: { kind: "problem", problem: draft.problem as Problem, details } };
}

/** The message's subject line, for an email. */
export function requestSubject(lang: Lang, number: string, kind: Request["kind"]): string {
  return translate(lang, `req.subject.${kind}`, { number });
}

/** The message itself, in the page's language, the tracking number in its first line. */
export function requestMessage(lang: Lang, number: string, request: Request): string {
  const lines = [translate(lang, "req.msgHello", { number })];
  switch (request.kind) {
    case "reschedule":
      lines.push(translate(lang, "req.msgReschedule", { day: formatDay(request.day, lang), slot: translate(lang, `req.slot.${request.slot}`) }));
      if (request.note) lines.push(translate(lang, "req.msgNote", { note: request.note }));
      break;
    case "address":
      lines.push(translate(lang, "req.msgAddress", { area: request.area, governorate: governorateName(request.governorate, lang), address: request.address }));
      if (request.note) lines.push(translate(lang, "req.msgNote", { note: request.note }));
      break;
    case "problem":
      lines.push(translate(lang, "req.msgProblem", { problem: translate(lang, `req.problem.${request.problem}`) }));
      lines.push(translate(lang, "req.msgDetails", { details: request.details }));
      break;
  }
  return lines.join("\n");
}

/** Where the message goes: WhatsApp with it written in, or an email with its subject and body. */
export function requestLinks(contact: { whatsapp: string | null; email: string | null }, lang: Lang, number: string, request: Request): { whatsapp: string | null; email: string | null } {
  const text = requestMessage(lang, number, request);
  return {
    whatsapp: contact.whatsapp ? `https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(text)}` : null,
    email: contact.email ? `mailto:${contact.email}?subject=${encodeURIComponent(requestSubject(lang, number, request.kind))}&body=${encodeURIComponent(text)}` : null,
  };
}
