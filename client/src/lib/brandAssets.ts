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

/**
 * NetLet's own street — four stores and the van being loaded, the towers
 * behind — drawn on the home page's front door and over the sign-in panel.
 * Found at build time by name (`client/src/assets/auth/welcome.*`), so
 * replacing it is dropping in another file, and with none each place draws
 * its words alone rather than an empty frame or a broken image.
 */
export const streetImage: string | null = Object.values(
  import.meta.glob<string>("../assets/auth/welcome.{webp,png,jpg,jpeg}", { eager: true, query: "?url", import: "default" }),
)[0] ?? null;

/** Placeholder QR for the app-download panel: reads as a code, decodes to nothing. */
