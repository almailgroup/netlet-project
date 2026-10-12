/**
 * A home banner's picture, made the shape it is drawn in (3:1) before it is
 * sent.
 *
 * Cropped from the centre rather than padded: a banner with bars is plainly
 * broken, and the seller sees the crop before they book, so a picture whose
 * point was at its edge is changed by them rather than by surprise. Shrunk to
 * `BANNER_MAX_WIDTH` and re-encoded like a product photo (`preparePhoto`),
 * which drops the camera's metadata on the way. The server checks the shape
 * again and trusts none of this.
 */
import { BANNER_ASPECT, BANNER_MAX_WIDTH, BANNER_MIN_WIDTH } from "@shared/commerce/adBookings";
import { MAX_UPLOAD_BYTES, type StoredType } from "@shared/commerce/media";

export type PreparedBanner = { blob: Blob; type: StoredType; width: number; height: number };
export type BannerPrepareProblem = "media.notAnImage" | "ads.bannerTooSmall" | "media.tooLarge";

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

export async function prepareBanner(file: Blob): Promise<PreparedBanner | BannerPrepareProblem> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return "media.notAnImage";
  }
  /* The largest 3:1 box the picture holds, centred. */
  const wide = bitmap.width / bitmap.height >= BANNER_ASPECT;
  const cropWidth = wide ? bitmap.height * BANNER_ASPECT : bitmap.width;
  const cropHeight = wide ? bitmap.height : bitmap.width / BANNER_ASPECT;
  const width = Math.round(Math.min(cropWidth, BANNER_MAX_WIDTH));
  const height = Math.round(width / BANNER_ASPECT);
  if (width < BANNER_MIN_WIDTH) {
    bitmap.close();
    return "ads.bannerTooSmall";
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return "media.notAnImage";
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, (bitmap.width - cropWidth) / 2, (bitmap.height - cropHeight) / 2, cropWidth, cropHeight, 0, 0, width, height);
  bitmap.close();

  for (const quality of [0.86, 0.76, 0.64, 0.5]) {
    let blob = await encode(canvas, "image/webp", quality);
    let type: StoredType = "image/webp";
    if (!blob || blob.type !== "image/webp") {
      blob = await encode(canvas, "image/jpeg", quality);
      type = "image/jpeg";
    }
    if (blob && blob.size <= MAX_UPLOAD_BYTES) return { blob, type, width, height };
  }
  return "media.tooLarge";
}
