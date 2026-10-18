/**
 * A shopper's photo, made small enough to send (3.1.6).
 *
 * Shrunk in the browser, before anything leaves it: the longest edge to
 * `PHOTO_MAX_EDGE`, re-encoded as JPEG, and the quality stepped down until it
 * fits under `MAX_PHOTO_CHARS`. A phone photo is several megabytes and twelve
 * megapixels; a model telling a kettle from a lamp needs neither, and a smaller
 * picture is also one that cannot read the letter lying on the counter behind
 * the kettle. `createImageBitmap` applies the camera's orientation, so a
 * portrait shot is not sent on its side.
 *
 * Null when the file is not an image the browser can draw, or cannot be made
 * small enough — the panel says so rather than sending something the API
 * would refuse.
 */
import { MAX_PHOTO_CHARS, PHOTO_MAX_EDGE } from "@shared/commerce/photoSearch";

export async function shrinkPhoto(file: Blob): Promise<string | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= MAX_PHOTO_CHARS) return dataUrl;
  }
  return null;
}
