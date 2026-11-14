/**
 * Make a PDF smaller in the browser, for a catalogue over the 5 MB a product
 * may carry (`Shared/inventory/productCatalogues.ts`).
 *
 * What makes a brochure heavy is nearly always its photographs, so those are
 * what is made smaller: each picture stored as a JPEG, or as plain 8-bit
 * colour or grey, is drawn on a canvas at most `maxEdge` pixels on its long
 * side and stored again as a JPEG — and kept only when that is smaller. The
 * text, the drawings and the fonts are left exactly as they are, and so is
 * any picture this cannot read safely (CMYK, an indexed palette, a mask, a
 * picture with a decode array of its own), so nothing is drawn wrongly. The
 * file is then written again with its objects packed together.
 *
 * Tried at three strengths, gentlest first, each from the original; the
 * first that fits is kept. None of it is a model's work: it runs here, and
 * the file is sent only once it fits.
 *
 * `pdf-lib` is fetched only when a file is over the limit, so it costs the
 * portal nothing otherwise.
 */
import type * as PdfLib from "pdf-lib";

type Lib = typeof PdfLib;

/** The steps, gentlest first: the long side in pixels and the JPEG quality. */
const STEPS = [
  { maxEdge: 2000, quality: 0.78 },
  { maxEdge: 1400, quality: 0.68 },
  { maxEdge: 1000, quality: 0.6 },
] as const;

export type ShrinkResult = { bytes: Uint8Array; fits: boolean };

/**
 * The smallest of the steps that brings the file to `limit` bytes, or the
 * smallest that could be made when none does (`fits: false`). A file this
 * cannot open at all — encrypted, broken — throws.
 */
export async function shrinkPdf(original: ArrayBuffer, limit: number): Promise<ShrinkResult> {
  let best: Uint8Array | null = null;
  for (const step of STEPS) {
    const bytes = await shrinkOnce(original, step.maxEdge, step.quality);
    if (!best || bytes.length < best.length) best = bytes;
    if (bytes.length <= limit) return { bytes, fits: true };
  }
  return { bytes: best!, fits: false };
}

async function shrinkOnce(original: ArrayBuffer, maxEdge: number, quality: number): Promise<Uint8Array> {
  const lib: Lib = await import("pdf-lib");
  const { PDFDocument, PDFName, PDFNumber, PDFRawStream: RawStream, decodePDFRawStream } = lib;
  const doc = await PDFDocument.load(original, { updateMetadata: false });
  const context = doc.context;
  const name = (value: string) => PDFName.of(value);
  const softMasks = new Set(
    context.enumerateIndirectObjects()
      .map(([, object]) => (object instanceof RawStream ? object.dict.get(name("SMask")) : undefined))
      .filter(Boolean),
  );

  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof RawStream)) continue;
    const dict = object.dict;
    if (dict.lookup(name("Subtype")) !== name("Image")) continue;
    /* A mask, a stencil, a decode array or a soft mask's own pixels: left alone. */
    if (dict.has(name("ImageMask")) || dict.has(name("Decode")) || dict.has(name("Mask"))) continue;
    if (softMasks.has(ref)) continue;
    const width = numberOf(lib, dict.lookup(name("Width")));
    const height = numberOf(lib, dict.lookup(name("Height")));
    if (!width || !height || width * height < 160_000) continue;
    const colours = channelsOf(lib, context, dict.lookup(name("ColorSpace")));
    if (colours !== 1 && colours !== 3) continue;

    const filters = filterNames(lib, dict.lookup(name("Filter")));
    let picture: ImageBitmap | ImageData | null = null;
    try {
      if (filters.length === 1 && filters[0] === "DCTDecode") {
        picture = await createImageBitmap(new Blob([new Uint8Array(object.contents)], { type: "image/jpeg" }));
      } else if (filters.length === 1 && filters[0] === "FlateDecode") {
        if (numberOf(lib, dict.lookup(name("BitsPerComponent"))) !== 8) continue;
        const raw = decodePDFRawStream(object).decode();
        const pixels = unpredict(lib, raw, dict.lookup(name("DecodeParms")), width, colours);
        if (!pixels || pixels.length < width * height * colours) continue;
        picture = toImageData(pixels, width, height, colours);
      }
    } catch {
      picture = null;
    }
    if (!picture) continue;

    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const outWidth = Math.max(1, Math.round(width * scale));
    const outHeight = Math.max(1, Math.round(height * scale));
    const jpeg = await encode(picture, outWidth, outHeight, quality);
    if ("close" in picture) picture.close();
    if (!jpeg || jpeg.length >= object.contents.length * 0.9) continue;

    const next = dict.clone(context);
    next.set(name("Width"), PDFNumber.of(outWidth));
    next.set(name("Height"), PDFNumber.of(outHeight));
    next.set(name("BitsPerComponent"), PDFNumber.of(8));
    next.set(name("ColorSpace"), name("DeviceRGB"));
    next.set(name("Filter"), name("DCTDecode"));
    next.delete(name("DecodeParms"));
    next.set(name("Length"), PDFNumber.of(jpeg.length));
    context.assign(ref, RawStream.of(next, jpeg));
  }
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}

function numberOf(lib: Lib, value: unknown): number | null {
  return value instanceof lib.PDFNumber ? value.asNumber() : null;
}

/** 1 for grey, 3 for colour; anything else (CMYK, a palette, a separation) is 0 and left alone. */
function channelsOf(lib: Lib, context: PdfLib.PDFContext, space: unknown): number {
  const name = (value: string) => lib.PDFName.of(value);
  if (space === name("DeviceRGB") || space === name("CalRGB")) return 3;
  if (space === name("DeviceGray") || space === name("CalGray")) return 1;
  if (space instanceof lib.PDFArray && space.size() === 2 && space.lookup(0) === name("ICCBased")) {
    const profile = context.lookup(space.get(1));
    const count = profile instanceof lib.PDFRawStream ? numberOf(lib, profile.dict.lookup(name("N"))) : null;
    return count === 1 || count === 3 ? count : 0;
  }
  return 0;
}

function filterNames(lib: Lib, filter: unknown): string[] {
  const one = (value: unknown) => (value instanceof lib.PDFName ? value.asString().replace(/^\//, "") : "?");
  if (!filter) return [];
  if (filter instanceof lib.PDFArray) return Array.from({ length: filter.size() }, (_, index) => one(filter.lookup(index)));
  return [one(filter)];
}

/**
 * Undo a PNG predictor (`Predictor` 10 to 15), the one a Flate picture
 * usually carries: each row starts with the filter it was written with. No
 * predictor, or predictor 1, is the pixels as they are; a TIFF predictor is
 * not undone, and the picture is left alone.
 */
function unpredict(lib: Lib, raw: Uint8Array, params: unknown, width: number, colours: number): Uint8Array | null {
  const read = (key: string) => (params instanceof lib.PDFDict ? numberOf(lib, params.lookup(lib.PDFName.of(key))) : null);
  const predictor = read("Predictor") ?? 1;
  if (predictor === 1) return raw;
  if (predictor < 10) return null;
  const columns = read("Columns") ?? width;
  const perPixel = read("Colors") ?? colours;
  if (columns !== width || perPixel !== colours) return null;
  const stride = width * colours;
  const rows = Math.floor(raw.length / (stride + 1));
  const out = new Uint8Array(rows * stride);
  for (let row = 0; row < rows; row += 1) {
    const type = raw[row * (stride + 1)];
    const from = row * (stride + 1) + 1;
    const at = row * stride;
    for (let i = 0; i < stride; i += 1) {
      const value = raw[from + i];
      const left = i >= colours ? out[at + i - colours] : 0;
      const up = row > 0 ? out[at - stride + i] : 0;
      const corner = row > 0 && i >= colours ? out[at - stride + i - colours] : 0;
      let predicted = 0;
      if (type === 1) predicted = left;
      else if (type === 2) predicted = up;
      else if (type === 3) predicted = (left + up) >> 1;
      else if (type === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      } else if (type !== 0) return null;
      out[at + i] = (value + predicted) & 0xff;
    }
  }
  return out;
}

function toImageData(pixels: Uint8Array, width: number, height: number, colours: number): ImageData {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i += 1, j += colours) {
    const r = pixels[j];
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = colours === 3 ? pixels[j + 1] : r;
    rgba[i * 4 + 2] = colours === 3 ? pixels[j + 2] : r;
    rgba[i * 4 + 3] = 255;
  }
  return new ImageData(rgba, width, height);
}

async function encode(picture: ImageBitmap | ImageData, width: number, height: number, quality: number): Promise<Uint8Array | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  if (picture instanceof ImageData) {
    /* ImageData draws at its own size, so it goes through a bitmap to be scaled. */
    const bitmap = await createImageBitmap(picture);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
  } else {
    context.drawImage(picture, 0, 0, width, height);
  }
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
