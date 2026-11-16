/**
 * The notice drawn across the top of every customer page, or nothing.
 *
 * It is a constant on purpose: ShipLee has no screen for writing one yet, so
 * the owner's notice (a holiday's hours, weather, a road closed) is written
 * here in both languages and goes live with the next deploy. `id` is what a
 * customer's Dismiss remembers, so a new notice needs a new id or nobody who
 * dismissed the last one sees it. `ends` is the last Kuwaiti day it shows.
 *
 * Where it connects later: a notice the staff desk writes, served by
 * /api/config, would replace this constant and keep the banner as it is.
 */
export type ServiceAlert = {
  id: string;
  tone: "info" | "attention";
  text: { en: string; ar: string };
  /** The last Kuwaiti day (yyyy-mm-dd) it is shown; none means until it is taken out. */
  ends?: string;
};

export const SERVICE_ALERT: ServiceAlert | null = null;
