/**
 * A product's photos copied onto NetLet from the site its gallery points at —
 * on the owner's word, after the live shop was found drawing every card from
 * a seller's own server: 0.6 to 1.4 MB a photo, sent whole to a phone.
 *
 * **NetLet's server fetches and stores; the browser shrinks.** The server
 * bundle carries no image library (see "Uploaded photos"), so the copy is two
 * requests: the original fetched by the server through the same guarded
 * lookup a maker's page goes through (`guardedFetch` — the browser never
 * contacts the seller's host), shrunk and re-encoded in the administrator's
 * browser by `preparePhoto` with the fixes off, and handed back. The bytes
 * that come back are trusted for nothing: their type is read from their own
 * header and they are held to an upload's size, exactly as `saveUpload` holds
 * them.
 *
 * **It names a gallery photo, never an address.** Both requests take the
 * `product_images` row's id, and the row decides what is fetched and who may
 * ask: somebody who may edit that product, about a photo that is still on
 * another site. So it is not a way to make NetLet's server fetch anything a
 * caller types, and a photo already on NetLet is not fetched again.
 *
 * **The gallery row moves in the same transaction as the file is stored**,
 * with the old address in the predicate: two tabs copying one photo store one
 * file, and a seller who changed the photo meanwhile keeps their change. The
 * old address is kept as the file's `source_url`, which is what it is.
 *
 * Counted per account an hour (`MAX_PHOTO_COPIES_PER_HOUR`) on the fetch, the
 * request that costs NetLet a download.
 */
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { mediaFiles, productImages, products } from "../../database/schema.js";
import { MAX_PHOTO_COPIES_PER_HOUR, acceptableImageUrl, isMediaPath, isOffSite, mediaIdOf, mediaPath, sniffImage, uploadProblem } from "../../../Shared/commerce/media.js";
import { MAX_REMOTE_IMAGE_BYTES, sniffRemoteImage, urlProblem } from "../../../Shared/commerce/manufacturerImages.js";
import { can, type Actor } from "../../../Shared/inventory/permissions.js";
import { getDb } from "./db.js";
import { guardedFetch, ImportRefused } from "./manufacturerImages.js";
import { takeHourlyAllowance } from "./rateLimit.js";

export class PhotoCopyRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "PhotoCopyRefused";
  }
}

/** The gallery photo, if it is one this actor may copy and it is still on another site. */
async function offSitePhoto(actor: Actor, imageId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [row] = await db
    .select({ url: productImages.url, kind: productImages.kind, vendorId: products.vendorId })
    .from(productImages)
    .innerJoin(products, eq(products.id, productImages.productId))
    .where(eq(productImages.id, imageId))
    .limit(1);
  if (!row) throw new PhotoCopyRefused("media.copyGone");
  if (!can(actor, "product.edit", row.vendorId)) throw new PhotoCopyRefused("media.notAllowed");
  /* A video stays where it is, and a photo already on NetLet needs nothing. */
  if (row.kind !== "image" || !isOffSite(row.url)) throw new PhotoCopyRefused("media.copyGone");
  return { db, ...row };
}

/** The original photo, fetched by NetLet's server for the browser to shrink. */
export async function fetchPhotoToCopy(actor: Actor, imageId: number): Promise<{ type: string; bytes: Buffer }> {
  const photo = await offSitePhoto(actor, imageId);
  const problem = urlProblem(photo.url);
  if (problem) throw new PhotoCopyRefused(problem);
  /* Counted before the fetch: a host that times out has still been asked. */
  if (!(await takeHourlyAllowance(actor.userId, "photoCopy", MAX_PHOTO_COPIES_PER_HOUR))) throw new PhotoCopyRefused("media.copyTooMany");
  let fetched: Awaited<ReturnType<typeof guardedFetch>>;
  try {
    fetched = await guardedFetch(photo.url, "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8", MAX_REMOTE_IMAGE_BYTES);
  } catch (error) {
    throw new PhotoCopyRefused(error instanceof ImportRefused ? error.reason : "manufacturer.unreachable");
  }
  const type = sniffRemoteImage(fetched.bytes);
  if (!type) throw new PhotoCopyRefused("manufacturer.notAnImage");
  return { type, bytes: fetched.bytes };
}

/** Store the shrunk copy and point the gallery photo at it, in one transaction. */
export async function copyPhoto(actor: Actor, imageId: number, bytes: Uint8Array, declared: string): Promise<{ url: string; width: number; height: number }> {
  const photo = await offSitePhoto(actor, imageId);
  const problem = uploadProblem(bytes, declared);
  if (problem) throw new PhotoCopyRefused(problem);
  const info = sniffImage(bytes)!;
  const id = randomBytes(18).toString("base64url");
  const url = mediaPath(id, info.type);
  await photo.db.transaction(async tx => {
    await tx.insert(mediaFiles).values({
      id,
      /* The store's file, whoever pressed: it is the store's photo. */
      vendorId: photo.vendorId,
      uploadedBy: actor.userId,
      contentType: info.type,
      bytes,
      width: info.width,
      height: info.height,
      byteSize: bytes.length,
      sourceUrl: photo.url,
    });
    const moved = await tx
      .update(productImages)
      .set({ url })
      .where(and(eq(productImages.id, imageId), eq(productImages.url, photo.url)))
      .returning({ id: productImages.id });
    /* Copied or changed meanwhile: the file goes back with the transaction. */
    if (moved.length === 0) throw new PhotoCopyRefused("media.copyGone");
  });
  return { url, width: info.width, height: info.height };
}

/* -------------------------------------------------------------------------- */
/* Squaring a photo already in the gallery, with NetLet AI                    */
/* -------------------------------------------------------------------------- */

/**
 * A gallery photograph this actor may edit, wherever it is stored — the
 * products list's "Make photos square" (on the owner's word: "fix the product
 * images that are already added … all images should be square … use NetLet's
 * AI … without any cuts"). The browser reads the photo (NetLet's own straight
 * from `/media`, another site's through the copy fetch above), shrinks it,
 * and sends it here to be drawn square (`squareProductPhoto`); the square
 * picture comes back to the browser, is prepared like any upload and stored
 * in the photo's place. A video is never squared.
 */
async function editablePhoto(actor: Actor, imageId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [row] = await db
    .select({ url: productImages.url, kind: productImages.kind, vendorId: products.vendorId })
    .from(productImages)
    .innerJoin(products, eq(products.id, productImages.productId))
    .where(eq(productImages.id, imageId))
    .limit(1);
  if (!row || row.kind !== "image") throw new PhotoCopyRefused("media.copyGone");
  if (!can(actor, "product.edit", row.vendorId)) throw new PhotoCopyRefused("media.notAllowed");
  return { db, ...row };
}

/** Whether this actor may have this gallery photo squared — asked before the model is. */
export async function assertSquarable(actor: Actor, imageId: number): Promise<void> {
  await editablePhoto(actor, imageId);
}

/**
 * The squared picture stored and put in the gallery in the photo's place, in
 * one transaction, with the address the browser squared in the predicate
 * (`was`): a photo the seller changed meanwhile keeps their change. The old
 * address is the new file's `source_url`, which is how it can be put back.
 */
export async function replaceGalleryPhoto(actor: Actor, imageId: number, bytes: Uint8Array, declared: string, was: string): Promise<{ url: string; width: number; height: number }> {
  const photo = await editablePhoto(actor, imageId);
  if (photo.url !== was) throw new PhotoCopyRefused("media.copyGone");
  const problem = uploadProblem(bytes, declared);
  if (problem) throw new PhotoCopyRefused(problem);
  const info = sniffImage(bytes)!;
  const id = randomBytes(18).toString("base64url");
  const url = mediaPath(id, info.type);
  await photo.db.transaction(async tx => {
    await tx.insert(mediaFiles).values({
      id,
      vendorId: photo.vendorId,
      uploadedBy: actor.userId,
      contentType: info.type,
      bytes,
      width: info.width,
      height: info.height,
      byteSize: bytes.length,
      sourceUrl: photo.url,
    });
    const moved = await tx
      .update(productImages)
      .set({ url })
      .where(and(eq(productImages.id, imageId), eq(productImages.url, photo.url)))
      .returning({ id: productImages.id });
    if (moved.length === 0) throw new PhotoCopyRefused("media.copyGone");
  });
  return { url, width: info.width, height: info.height };
}

/**
 * The photo as it was before NetLet stored a copy in its place — squared by
 * NetLet AI, or copied from another site — put back in the gallery. Only a
 * photo NetLet stored with a record of where it came from can be put back,
 * and only to that address; the copy itself is left where it is, since
 * another product may show it.
 */
export async function putPhotoBack(actor: Actor, imageId: number): Promise<{ url: string }> {
  const photo = await editablePhoto(actor, imageId);
  if (!isMediaPath(photo.url)) throw new PhotoCopyRefused("media.nothingToPutBack");
  const [file] = await photo.db
    .select({ sourceUrl: mediaFiles.sourceUrl })
    .from(mediaFiles)
    .where(eq(mediaFiles.id, mediaIdOf(photo.url)))
    .limit(1);
  const original = file?.sourceUrl?.trim();
  if (!original || !acceptableImageUrl(original)) throw new PhotoCopyRefused("media.nothingToPutBack");
  const moved = await photo.db
    .update(productImages)
    .set({ url: original })
    .where(and(eq(productImages.id, imageId), eq(productImages.url, photo.url)))
    .returning({ id: productImages.id });
  if (moved.length === 0) throw new PhotoCopyRefused("media.copyGone");
  return { url: original };
}
