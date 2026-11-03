/**
 * Brand artwork, resolved once for the whole app.
 *
 * These were previously proxied from Manus Forge storage via `/manus-storage/…`.
 * That proxy is gone, so the files are served from `Frontend/Web/public/brand/` — the
 * only source now, in every build.
 *
 * The logo is the real NetLet mark. `netlet-logo-white.png` is that same file
 * with the navy wordmark repainted pearl so it reads on the navy footer, the
 * orange chevron untouched. The hero, collection and QR artwork are still
 * placeholders: replace the files in place and nothing else needs to change.
 *
 * **The page draws the WebP copies**, 480px wide — three times the widest the
 * logo is ever drawn (156px) — at about 15 KB each, where the 968px PNGs are
 * 147 KB and 113 KB: the logo is on every page, so it was a quarter of a
 * phone's first download. The PNGs stay, being what the iOS app copies
 * (`Frontend/iOS/scripts/exportShared.ts`); a new logo is both files.
 */
import { appPath } from "@/lib/basePath";

export const logoImage = appPath("/brand/netlet-logo.webp");
export const footerLogoImage = appPath("/brand/netlet-logo-white.webp");
export const heroImage = appPath("/brand/hero.svg");

/**
 * NetLet's own street — four stores and the van being loaded, the towers
 * behind — drawn on the home page's front door and over the sign-in panel.
 * Found at build time by name (`Frontend/Web/src/assets/auth/welcome.*`), so
 * replacing it is dropping in another file, and with none each place draws
 * its words alone rather than an empty frame or a broken image.
 */
export const streetImage: string | null = Object.values(
  import.meta.glob<string>("../assets/auth/welcome.{webp,png,jpg,jpeg}", { eager: true, query: "?url", import: "default" }),
)[0] ?? null;

/** A picture with optional copies for a phone's screen and a wide one. */
export type Slide = { src: string; phone: string | null; wide: string | null };

/* `phone/<same name>` beside a picture is its phone copy, 960px wide — half
   the bytes of a 1600px slide, for a band a phone draws 390px wide. A
   picture with none is sent whole. Not found by the slideshow's own globs,
   which do not look in subfolders. */
const phoneCopies = {
  ...import.meta.glob<string>("../assets/hero/phone/*.{webp,png,jpg,jpeg}", { eager: true, query: "?url", import: "default" }),
  ...import.meta.glob<string>("../assets/auth/phone/*.{webp,png,jpg,jpeg}", { eager: true, query: "?url", import: "default" }),
};
const phoneCopyOf = (path: string): string | null => phoneCopies[path.replace(/\/([^/]+)$/, "/phone/$1")] ?? null;

/* `large/<same name>` beside a picture is its copy for a wide screen, about
   3200px wide. The band there is up to 1616px across, so a 1600px picture is
   drawn at about its own size and a 1120px one is stretched — and a Retina
   screen draws twice the pixels. With a large copy every wide screen gets a
   picture sharper than the frame it fills. Without one the picture is used. */
const wideCopies = {
  ...import.meta.glob<string>("../assets/hero/large/*.{webp,png,jpg,jpeg}", { eager: true, query: "?url", import: "default" }),
  ...import.meta.glob<string>("../assets/auth/large/*.{webp,png,jpg,jpeg}", { eager: true, query: "?url", import: "default" }),
};
const wideCopyOf = (path: string): string | null => wideCopies[path.replace(/\/([^/]+)$/, "/large/$1")] ?? null;

const streetPath = Object.keys(
  import.meta.glob<string>("../assets/auth/welcome.{webp,png,jpg,jpeg}", { eager: true, query: "?url", import: "default" }),
)[0];

/**
 * The home page's front door as a slideshow: the street first, then every
 * picture in `Frontend/Web/src/assets/hero/`, in file-name order (`02-…`, `03-…`).
 * Found at build time like the street, so adding a slide is dropping in a
 * file; only the addresses are in the bundle, and each picture is fetched when
 * the slideshow is about to show it.
 */
export const heroSlides: Slide[] = [
  ...(streetImage ? [{ src: streetImage, phone: streetPath ? phoneCopyOf(streetPath) : null, wide: streetPath ? wideCopyOf(streetPath) : null }] : []),
  ...Object.entries(
    import.meta.glob<string>("../assets/hero/*.{webp,png,jpg,jpeg}", { eager: true, query: "?url", import: "default" }),
  )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, url]) => ({ src: url, phone: phoneCopyOf(path), wide: wideCopyOf(path) })),
];

