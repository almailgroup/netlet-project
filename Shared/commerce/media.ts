/**
 * Uploaded product photos (3.3.4): what may be stored, and the fixes applied
 * on the way in.
 *
 * Pure and shared, for the password floor's reason: the editor checks a photo
 * against the same limits the upload route refuses on, and the fixes are
 * arithmetic over pixels that can be tested without a browser.
 *
 * ## The fixes are the ones a marketplace photo almost always needs
 *
 * A seller's photo is usually a product on a table or a sheet, off-centre,
 * with a band of background around it, a little dim, and twelve megapixels.
 * So, in order:
 *
 * 1. **Trim** a border of one colour — but only when the four corners agree on
 *    what that colour is. A lifestyle shot has no uniform border, and cropping
 *    it would be guessing which part was the product.
 * 2. **Square** it on that same colour, with a margin, so a grid of cards lines
 *    up. Again only on a uniform background; padding a photo of a room with
 *    white bars would look broken.
 * 3. **Level** a flat photo — stretch the darkest and lightest half-percent to
 *    black and white — only when it is actually flat, so a photo that is
 *    already fine is not touched.
 * 4. **Shrink** to `MAX_EDGE` and re-encode, which strips the camera's
 *    metadata (location included) as a side effect worth having.
 *
 * Each fix that happened is reported by name, and the editor shows the before
 * and the after, so a seller can keep their original framing.
 */

/** The longest edge a stored photo has. */
export const MAX_EDGE = 1200;
/** Smaller than this on the short side and a card would be blurred. */
export const MIN_EDGE = 300;
/** The most one upload may weigh, after the browser has re-encoded it. */
export const MAX_UPLOAD_BYTES = 1_500_000;
/** How many photos one account may upload in an hour. */
export const MAX_UPLOADS_PER_HOUR = 200;

export type StoredType = "image/webp" | "image/jpeg";

const MEDIA_PATH = /^\/media\/[A-Za-z0-9_-]{16,64}\.(?:webp|jpg)$/;

/** Whether a URL is one of NetLet's own uploaded photos, which are stored as paths. */
export function isMediaPath(value: string): boolean {
  return MEDIA_PATH.test(value);
}

/** The path an uploaded photo is served at. */
export function mediaPath(id: string, type: StoredType): string {
  return `/media/${id}.${type === "image/webp" ? "webp" : "jpg"}`;
}

/** A URL a product image may carry: an absolute http(s) address, or an uploaded photo. */
export function acceptableImageUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value) || isMediaPath(value);
}

export type ImageInfo = { type: StoredType; width: number; height: number };

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/**
 * What a file actually is, from its own bytes — never from the name or the
 * declared type, which are whatever the sender said. Null for anything that is
 * not a JPEG or WebP whose header gives its size.
 */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length > 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    /* JPEG: walk the markers to a start-of-frame, which carries the size. */
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
      const length = u16be(bytes, i + 2);
      if (length < 2) return null;
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) {
        const height = u16be(bytes, i + 5);
        const width = u16be(bytes, i + 7);
        return width && height ? { type: "image/jpeg", width, height } : null;
      }
      i += 2 + length;
    }
    return null;
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length > 30 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    const chunk = ascii(12, 16);
    if (chunk === "VP8 ") {
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
      return { type: "image/webp", width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
    }
    if (chunk === "VP8L") {
      if (bytes[20] !== 0x2f) return null;
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return { type: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { type: "image/webp", width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
  }
  return null;
}

export type UploadProblem = "media.notAnImage" | "media.tooLarge" | "media.tooSmall" | "media.wrongType";

/** What is wrong with an upload, or null. The declared type must match the bytes. */
export function uploadProblem(bytes: Uint8Array, declared: string): UploadProblem | null {
  if (bytes.length > MAX_UPLOAD_BYTES) return "media.tooLarge";
  const info = sniffImage(bytes);
  if (!info) return "media.notAnImage";
  if (info.type !== declared) return "media.wrongType";
  if (Math.min(info.width, info.height) < MIN_EDGE || Math.max(info.width, info.height) > MAX_EDGE * 4) return "media.tooSmall";
  return null;
}

/* ------------------------------------------------------------- the fixes --- */

export type Rgb = [number, number, number];
export type Box = { x: number; y: number; width: number; height: number };

/** How far apart two colours are, as the largest channel difference. */
function gap(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

function pixel(data: Uint8ClampedArray | Uint8Array, width: number, x: number, y: number): Rgb {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}

/** Within this many levels of each other, two colours are the same background. */
const BACKGROUND_TOLERANCE = 18;

/**
 * The background colour, when the four corners agree on one; null for a photo
 * with no uniform border, which is then neither trimmed nor padded.
 */
export function uniformBackground(data: Uint8ClampedArray | Uint8Array, width: number, height: number): Rgb | null {
  const inset = Math.max(1, Math.floor(Math.min(width, height) * 0.01));
  const corners = [
    pixel(data, width, inset, inset),
    pixel(data, width, width - 1 - inset, inset),
    pixel(data, width, inset, height - 1 - inset),
    pixel(data, width, width - 1 - inset, height - 1 - inset),
  ];
  for (const corner of corners.slice(1)) if (gap(corner, corners[0]) > BACKGROUND_TOLERANCE) return null;
  const average = [0, 1, 2].map(c => Math.round(corners.reduce((sum, corner) => sum + corner[c], 0) / 4)) as Rgb;
  return average;
}

/**
 * The smallest box holding everything that is not background, or null when
 * there is no such thing (a blank frame). Sampled on a grid rather than every
 * pixel, because a 12-megapixel photo read in full is seconds of a phone's time.
 */
export function contentBox(data: Uint8ClampedArray | Uint8Array, width: number, height: number, background: Rgb): Box | null {
  const step = Math.max(1, Math.floor(Math.min(width, height) / 400));
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (gap(pixel(data, width, x, y), background) > BACKGROUND_TOLERANCE) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  minX = Math.max(0, minX - step); minY = Math.max(0, minY - step);
  maxX = Math.min(width - 1, maxX + step); maxY = Math.min(height - 1, maxY + step);
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** The square a trimmed product sits in, with this share of margin on each side. */
export function squareAround(box: Box, margin = 0.08): number {
  return Math.round(Math.max(box.width, box.height) * (1 + margin * 2));
}

/**
 * The black and white points to stretch to, or null when the photo already
 * spans the range.
 *
 * The histogram is of **every channel value together**, not of brightness:
 * the same stretch is applied to red, green and blue alike, so it cannot tint
 * a photo, and measuring the channels themselves means a saturated product's
 * weakest channel is not pushed below black. The darkest and lightest
 * half-percent are clipped, so one glint does not stop a dim photo being
 * lifted, and the points are **capped** — the black point at 40, the white
 * point at 215 — so the strongest lift is about a third: enough to rescue a
 * dim phone photo, never enough to turn a deliberate dark product grey or a
 * coloured one garish. This is the fix a test caught by looking: measured on
 * brightness and uncapped, a dim brown product came out maroon.
 */
export function levelsFor(histogram: number[], total: number): { low: number; high: number } | null {
  const clip = total * 0.005;
  let low = 0, seen = 0;
  while (low < 255 && seen + histogram[low] <= clip) seen += histogram[low++];
  let high = 255; seen = 0;
  while (high > 0 && seen + histogram[high] <= clip) seen += histogram[high--];
  /* Already close to full range, or too narrow to stretch without inventing detail. */
  if ((low <= 10 && high >= 245) || high - low < 64) return null;
  return { low: Math.min(low, 40), high: Math.max(high, 215) };
}

/** A lookup table that stretches `low..high` to `0..255`. */
export function levelsTable(low: number, high: number): Uint8Array {
  const table = new Uint8Array(256);
  for (let v = 0; v < 256; v++) table[v] = Math.max(0, Math.min(255, Math.round(((v - low) * 255) / (high - low))));
  return table;
}

export type Fix = "trimmed" | "squared" | "levelled" | "resized";
