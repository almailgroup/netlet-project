/**
 * Whether an error is a page of this build asking for a file the server no
 * longer has — a tab left open across a deploy, or a reload handed the old
 * page while a deploy reaches every server. Each browser words it its own way:
 * Chrome "Failed to fetch dynamically imported module", Firefox "error loading
 * dynamically imported module", Safari "Importing a module script failed", and
 * Vite's own preload "Unable to preload CSS".
 *
 * The crash screen asks this so it can say NetLet has been updated and let
 * `public/asset-recovery.js` fetch the new build, rather than showing a stack
 * trace for something nobody did wrong.
 */
const STALE_BUILD = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /unable to preload css/i,
];

export function isStaleBuildError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return STALE_BUILD.some(pattern => pattern.test(message));
}

declare global {
  interface Window {
    /** `public/asset-recovery.js`: start a reload onto the new build; false once every try is spent. */
    __netletRecover?: (failed?: string) => boolean;
  }
}

/** Ask the recovery script for the new build; false when it will not reload (no script, or every try spent). */
export function reloadOntoNewBuild(error: unknown): boolean {
  if (typeof window === "undefined" || typeof window.__netletRecover !== "function") return false;
  const message = error instanceof Error ? error.message : String(error ?? "");
  try {
    return window.__netletRecover(message) === true;
  } catch {
    return false;
  }
}
