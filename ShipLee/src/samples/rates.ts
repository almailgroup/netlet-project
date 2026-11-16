/**
 * The rate calculator's sample prices, for the design alone (/rates is a
 * preview page). ShipLee has no price list in this code; when it does, it
 * replaces this file and the page keeps its shape. Every figure is in fils.
 *
 * Where it connects later: a price list the server reads (or an API that
 * quotes a booking) answering the same question, with the same lines.
 */
import type { Governorate } from "../../shared/kuwait.js";
import type { Key } from "../../shared/i18n.js";

export const SIZES = ["small", "medium", "large"] as const;
export type Size = (typeof SIZES)[number];
export const SPEEDS = ["nextDay", "sameDay"] as const;
export type Speed = (typeof SPEEDS)[number];

const BASE: Record<Size, number> = { small: 1500, medium: 2500, large: 4000 };
const ACROSS = 500;
const SAME_DAY = 1500;
const EXTRA_PIECE = 500;
const COD = 250;
/** Same day is offered only within these, in the sample. */
export const SAME_DAY_AREA: readonly Governorate[] = ["capital", "hawalli"];

export type RateQuestion = { from: Governorate; to: Governorate; size: Size; speed: Speed; pieces: number; cod: boolean };
export type RateLine = { label: Key; fils: number };

export function sameDayOffered(from: Governorate, to: Governorate): boolean {
  return SAME_DAY_AREA.includes(from) && SAME_DAY_AREA.includes(to);
}

/** The sample price, line by line; same day where it is not offered is priced as next day. */
export function sampleRate(question: RateQuestion): { lines: RateLine[]; totalFils: number } {
  const pieces = Math.min(Math.max(Math.round(question.pieces) || 1, 1), 99);
  const lines: RateLine[] = [{ label: "rates.base", fils: BASE[question.size] }];
  if (question.from !== question.to) lines.push({ label: "rates.across", fils: ACROSS });
  if (question.speed === "sameDay" && sameDayOffered(question.from, question.to)) lines.push({ label: "rates.sameDayFee", fils: SAME_DAY });
  if (pieces > 1) lines.push({ label: "rates.extraPieces", fils: (pieces - 1) * EXTRA_PIECE });
  if (question.cod) lines.push({ label: "rates.codFee", fils: COD });
  return { lines, totalFils: lines.reduce((sum, line) => sum + line.fils, 0) };
}

/** The lowest sample price of a service, for "From …" on the services page. */
export const FROM_FILS = { nextDay: BASE.small, sameDay: BASE.small + SAME_DAY, cod: BASE.small + COD, returns: BASE.small } as const;
