/**
 * A profile photo, made the square it is drawn in before it is sent
 * (`Shared/commerce/profilePhoto.ts`).
 *
 * The largest square the picture holds, from its centre — where a face in a
 * phone's photo nearly always is — at `PROFILE_PHOTO_EDGE`, or the picture's
 * own size when it is smaller, and never under the upload floor, so a small
 * picture is drawn up rather than refused: it is shown at 64px. Re-encoded,
 * which drops the camera's metadata (the place a photo was taken among it).
 * The server checks the square again and trusts none of this.
 */
import { MIN_EDGE, type StoredType } from "@shared/commerce/media";
import { MAX_PROFILE_PHOTO_BYTES, PROFILE_PHOTO_EDGE } from "@shared/commerce/profilePhoto";

export type PreparedProfilePhoto = { blob: Blob; type: StoredType; edge: number };

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

export async function prepareProfilePhoto(file: Blob): Promise<PreparedProfilePhoto | "media.notAnImage" | "media.tooLarge"> {
  return prepareSquare(file, PROFILE_PHOTO_EDGE, MAX_PROFILE_PHOTO_BYTES);
}

/**
 * The largest square a picture holds, from its centre, at `edgeMax` or its
 * own size when smaller (never under the upload floor), re-encoded under
 * `maxBytes` — the profile photo's, and a subcategory's picture.
 */
export async function prepareSquare(file: Blob, edgeMax: number, maxBytes: number): Promise<PreparedProfilePhoto | "media.notAnImage" | "media.tooLarge"> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return "media.notAnImage";
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const edge = Math.max(MIN_EDGE, Math.min(side, edgeMax));
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext("2d");
  if (!context || side === 0) {
    bitmap.close();
    return "media.notAnImage";
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, edge, edge);
  bitmap.close();

  for (const quality of [0.86, 0.76, 0.64, 0.5]) {
    let blob = await encode(canvas, "image/webp", quality);
    let type: StoredType = "image/webp";
    if (!blob || blob.type !== "image/webp") {
      blob = await encode(canvas, "image/jpeg", quality);
      type = "image/jpeg";
    }
    if (blob && blob.size <= maxBytes) return { blob, type, edge };
  }
  return "media.tooLarge";
}
