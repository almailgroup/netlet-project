/**
 * A seller's photo, fixed and made ready to store (3.3.4).
 *
 * The decisions are `shared/commerce/media.ts` — which border is uniform, where
 * the product is, whether the photo is flat — and this applies them on a
 * canvas: trim, square on the background, level, shrink to `MAX_EDGE`, and
 * re-encode, which also drops the camera's metadata, location included.
 * `createImageBitmap` applies the camera's orientation, so a portrait shot
 * arrives upright.
 *
 * With `fix` false only the shrink and re-encode happen: the seller's framing,
 * kept as they took it, still has to be a size and a type NetLet stores.
 */
import {
  MAX_EDGE,
  MAX_UPLOAD_BYTES,
  MIN_EDGE,
  contentBox,
  levelsFor,
  levelsTable,
  squareAround,
  uniformBackground,
  type Fix,
  type StoredType,
} from "@shared/commerce/media";

export type PreparedPhoto = { blob: Blob; type: StoredType; width: number; height: number; fixes: Fix[] };
export type PrepareProblem = "media.notAnImage" | "media.tooSmall" | "media.tooLarge";

/** The working copy is analysed at most this large; reading every pixel of a 12MP photo stalls a phone. */
const ANALYSIS_EDGE = 2400;

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no canvas");
  return { canvas, context };
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

export async function preparePhoto(file: Blob, fix: boolean): Promise<PreparedPhoto | PrepareProblem> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return "media.notAnImage";
  }
  const fixes: Fix[] = [];
  const scale = Math.min(1, ANALYSIS_EDGE / Math.max(bitmap.width, bitmap.height));
  const work = canvasOf(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  work.context.drawImage(bitmap, 0, 0, work.canvas.width, work.canvas.height);
  bitmap.close();
  const W = work.canvas.width, H = work.canvas.height;

  let source = { x: 0, y: 0, width: W, height: H };
  let background: [number, number, number] | null = null;
  if (fix) {
    const pixels = work.context.getImageData(0, 0, W, H).data;
    background = uniformBackground(pixels, W, H);
    const box = background ? contentBox(pixels, W, H, background) : null;
    if (box && (box.width < W * 0.97 || box.height < H * 0.97)) {
      source = box;
      fixes.push("trimmed");
    }
  }

  /* Squared on its own background, with a margin, when there is one. */
  const side = fix && background ? squareAround(source) : 0;
  const outWidth0 = side || source.width;
  const outHeight0 = side || source.height;
  const shrink = Math.min(1, MAX_EDGE / Math.max(outWidth0, outHeight0));
  const outWidth = Math.round(outWidth0 * shrink);
  const outHeight = Math.round(outHeight0 * shrink);
  if (Math.min(outWidth, outHeight) < MIN_EDGE) return "media.tooSmall";
  if (shrink < 1 || scale < 1) fixes.push("resized");

  const out = canvasOf(outWidth, outHeight);
  if (side && background) {
    out.context.fillStyle = `rgb(${background[0]}, ${background[1]}, ${background[2]})`;
    out.context.fillRect(0, 0, outWidth, outHeight);
    const drawWidth = source.width * shrink;
    const drawHeight = source.height * shrink;
    out.context.drawImage(work.canvas, source.x, source.y, source.width, source.height, (outWidth - drawWidth) / 2, (outHeight - drawHeight) / 2, drawWidth, drawHeight);
    if (Math.abs(source.width - source.height) > Math.max(source.width, source.height) * 0.02) fixes.push("squared");
  } else {
    out.context.drawImage(work.canvas, source.x, source.y, source.width, source.height, 0, 0, outWidth, outHeight);
  }

  if (fix) {
    const image = out.context.getImageData(0, 0, outWidth, outHeight);
    const histogram = new Array<number>(256).fill(0);
    const data = image.data;
    /* Every channel value, not brightness — see `levelsFor`. */
    for (let i = 0; i < data.length; i += 4) { histogram[data[i]]++; histogram[data[i + 1]]++; histogram[data[i + 2]]++; }
    const levels = levelsFor(histogram, outWidth * outHeight * 3);
    if (levels) {
      const table = levelsTable(levels.low, levels.high);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = table[data[i]];
        data[i + 1] = table[data[i + 1]];
        data[i + 2] = table[data[i + 2]];
      }
      out.context.putImageData(image, 0, 0);
      fixes.push("levelled");
    }
  }

  /* WebP where the browser can write it, JPEG where it cannot; quality steps
     down until it fits, though at 1200px it nearly always fits first time. */
  for (const quality of [0.86, 0.76, 0.64, 0.5]) {
    let blob = await encode(out.canvas, "image/webp", quality);
    let type: StoredType = "image/webp";
    if (!blob || blob.type !== "image/webp") {
      blob = await encode(out.canvas, "image/jpeg", quality);
      type = "image/jpeg";
    }
    if (blob && blob.size <= MAX_UPLOAD_BYTES) return { blob, type, width: outWidth, height: outHeight, fixes };
  }
  return "media.tooLarge";
}
