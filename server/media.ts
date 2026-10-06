/**
 * Uploaded product photos (3.3.4), the database half. The rules — what may be
 * stored and the fixes applied on the way in — are `shared/commerce/media.ts`.
 *
 * **The bytes are trusted for nothing.** The seller's browser has already
 * fixed and re-encoded the photo, and none of that is relied on here: the type
 * comes from the file's own header and must match what was declared, and the
 * size and dimensions are checked again. A file that is not a JPEG or a WebP
 * is never stored, so nothing NetLet serves from `/media` can be a page or a
 * script wearing an image's name.
 *
 * Uploading is a catalogue act, `product.edit`, so a store's managers and an
 * administrator may and a shopper may not; each account may store
 * `MAX_UPLOADS_PER_HOUR`, counted in Postgres for the reason sign-in is.
 */
import { randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { mediaFiles } from "../drizzle/schema.js";
import { MAX_UPLOADS_PER_HOUR, mediaPath, sniffImage, uploadProblem, type StoredType, type UploadProblem } from "../shared/commerce/media.js";
import { urlProblem } from "../shared/commerce/manufacturerImages.js";
import { can, type Actor } from "../shared/inventory/permissions.js";
import { getDb } from "./db.js";

export class MediaError extends Error {
  constructor(readonly reason: UploadProblem | "media.notAllowed" | "media.tooMany") {
    super(reason);
    this.name = "MediaError";
  }
}

/**
 * Store one photo. `source` is where the seller says it came from — a
 * manufacturer's image they pulled (3.1.10) — kept for provenance, so a
 * rights question about a picture can be answered with where it was found.
 * It is the uploader's claim, recorded as such, and anything that is not an
 * https address is dropped rather than refused: a missing provenance line
 * costs less than a photo the seller cannot add.
 */
export async function saveUpload(actor: Actor, bytes: Uint8Array, declared: string, source: string | null = null, now = new Date()) {
  if (!can(actor, "product.edit")) throw new MediaError("media.notAllowed");
  const problem = uploadProblem(bytes, declared);
  if (problem) throw new MediaError(problem);
  const info = sniffImage(bytes)!;

  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mediaFiles)
    .where(and(eq(mediaFiles.uploadedBy, actor.userId), gt(mediaFiles.createdAt, new Date(now.getTime() - 60 * 60 * 1000))));
  if (count >= MAX_UPLOADS_PER_HOUR) throw new MediaError("media.tooMany");

  const id = randomBytes(18).toString("base64url");
  await db.insert(mediaFiles).values({
    id,
    vendorId: actor.kind === "vendor" ? actor.vendorId : null,
    uploadedBy: actor.userId,
    contentType: info.type,
    bytes,
    width: info.width,
    height: info.height,
    byteSize: bytes.length,
    sourceUrl: source && !urlProblem(source) ? source.trim() : null,
  });
  return { url: mediaPath(id, info.type), width: info.width, height: info.height };
}

/** A stored photo by the file name it is served under, or null. */
export async function readMedia(file: string): Promise<{ contentType: StoredType; bytes: Uint8Array } | null> {
  const match = /^([A-Za-z0-9_-]{16,64})\.(webp|jpg)$/.exec(file);
  if (!match) return null;
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select({ contentType: mediaFiles.contentType, bytes: mediaFiles.bytes }).from(mediaFiles).where(eq(mediaFiles.id, match[1])).limit(1);
  if (!row) return null;
  /* The extension in the path has to be the type stored, or one id answers to two names. */
  const expected = row.contentType === "image/webp" ? "webp" : "jpg";
  if (match[2] !== expected) return null;
  return { contentType: row.contentType as StoredType, bytes: row.bytes };
}
