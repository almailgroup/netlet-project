/**
 * The locations finder's sample drop-off points, for the design alone
 * (/locations is a preview page). None of these exists; the page says so.
 *
 * Where it connects later: a list of real points the server keeps, with the
 * same fields, and a map that draws them.
 */
import type { Governorate } from "../../shared/kuwait.js";

export type PointService = "dropOff" | "collect" | "returns";

export type SamplePoint = {
  id: string;
  name: { en: string; ar: string };
  area: { en: string; ar: string };
  governorate: Governorate;
  hours: { en: string; ar: string };
  services: PointService[];
};

const WEEK = { en: "Saturday to Thursday, 9 am to 9 pm", ar: "من السبت إلى الخميس، 9 صباحاً إلى 9 مساءً" };
const SHORT = { en: "Saturday to Thursday, 10 am to 6 pm", ar: "من السبت إلى الخميس، 10 صباحاً إلى 6 مساءً" };

export const SAMPLE_POINTS: readonly SamplePoint[] = [
  { id: "sharq", name: { en: "Sharq counter", ar: "نقطة شرق" }, area: { en: "Sharq", ar: "شرق" }, governorate: "capital", hours: SHORT, services: ["dropOff", "collect"] },
  { id: "salmiya", name: { en: "Salmiya hub", ar: "مركز السالمية" }, area: { en: "Salmiya", ar: "السالمية" }, governorate: "hawalli", hours: WEEK, services: ["dropOff", "collect", "returns"] },
  { id: "farwaniya", name: { en: "Farwaniya hub", ar: "مركز الفروانية" }, area: { en: "Farwaniya", ar: "الفروانية" }, governorate: "farwaniya", hours: WEEK, services: ["dropOff", "collect", "returns"] },
  { id: "sabah-al-salem", name: { en: "Sabah Al-Salem counter", ar: "نقطة صباح السالم" }, area: { en: "Sabah Al-Salem", ar: "صباح السالم" }, governorate: "mubarak-al-kabeer", hours: SHORT, services: ["dropOff"] },
  { id: "fahaheel", name: { en: "Fahaheel counter", ar: "نقطة الفحيحيل" }, area: { en: "Fahaheel", ar: "الفحيحيل" }, governorate: "ahmadi", hours: SHORT, services: ["dropOff", "collect"] },
  { id: "jahra", name: { en: "Jahra hub", ar: "مركز الجهراء" }, area: { en: "Jahra", ar: "الجهراء" }, governorate: "jahra", hours: WEEK, services: ["dropOff", "collect", "returns"] },
];
