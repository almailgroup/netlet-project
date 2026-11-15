/**
 * The numbers this device tracked lately, newest first, so somebody waiting
 * for two parcels does not retype them. Kept in the browser and nowhere else,
 * with the status it had when last seen; a number is only ever added after the
 * server found it, so a typo is never remembered.
 */
import { readStored, writeStored } from "./storage.js";
import type { Status } from "../shared/status.js";
import { isStatus } from "../shared/status.js";
import { parseTrackingNumber } from "../shared/tracking.js";

export type Recent = { number: string; status: Status };

const KEY = "shiplee:recent";
export const MAX_RECENT = 5;

export function readRecent(): Recent[] {
  try {
    const parsed: unknown = JSON.parse(readStored(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Recent => Boolean(item) && parseTrackingNumber(String(item.number)).ok && isStatus(item.status))
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function write(list: Recent[]): Recent[] {
  writeStored(KEY, JSON.stringify(list));
  return list;
}

export function rememberTracked(number: string, status: Status): Recent[] {
  return write([{ number, status }, ...readRecent().filter(item => item.number !== number)].slice(0, MAX_RECENT));
}

export function forgetTracked(number: string): Recent[] {
  return write(readRecent().filter(item => item.number !== number));
}

export function forgetAllTracked(): Recent[] {
  return write([]);
}
