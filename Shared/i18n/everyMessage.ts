/**
 * Every word in both languages, all three files together, for
 * whatever needs the whole dictionary at once: the dictionary's own tests and
 * the iOS export, which writes one `dictionary.json` the app reads.
 *
 * Never for a page. The shop's first download imports `dictionary.ts` alone,
 * `lazyPage` fetches `laterMessages.ts` with every page after it, and the
 * portal's frame imports `portalMessages.ts`; each adds its words to
 * `translate`, and importing this file does that for both.
 */
import { ar as shopAr, en as shopEn, type MessageKey } from "./dictionary.js";
import { laterAr, laterEn } from "./laterMessages.js";
import { portalAr, portalEn } from "./portalMessages.js";

export const en: Record<MessageKey, string> = { ...shopEn, ...laterEn, ...portalEn };
export const ar: Record<MessageKey, string> = { ...shopAr, ...laterAr, ...portalAr };
