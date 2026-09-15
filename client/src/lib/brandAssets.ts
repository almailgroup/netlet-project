/**
 * Brand artwork, resolved once for the whole app.
 *
 * These were previously proxied from Manus Forge storage via `/manus-storage/…`.
 * That proxy is gone, so the files are served from `client/public/brand/` — the
 * only source now, in every build.
 *
 * The logo is the real NetLet mark. `netlet-logo-white.png` is that same file
 * with the navy wordmark repainted pearl so it reads on the navy footer, the
 * orange chevron untouched. The hero, collection and QR artwork are still
 * placeholders: replace the files in place and nothing else needs to change.
 */
import { appPath } from "@/lib/basePath";

export const logoImage = appPath("/brand/netlet-logo.png");
export const footerLogoImage = appPath("/brand/netlet-logo-white.png");
export const heroImage = appPath("/brand/hero.svg");

/** Placeholder QR for the app-download panel: reads as a code, decodes to nothing. */

/** Artwork for the home-page rail support cards, in tech / home / style order. */
export const collectionImages = [
  appPath("/brand/collection-tech.svg"),
  appPath("/brand/collection-home.svg"),
  appPath("/brand/collection-style.svg"),
];
