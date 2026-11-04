/**
 * A shopper's profile photo — the rule, pure, imported by the server, the web
 * and (through `rules.json`) the app.
 *
 * **It is shown to its owner and nobody else.** It is not a review photo or a
 * product photo, so it never goes under `/media`, where every file is public
 * under a random id and cached by the CDN for a day: it is a row of its own,
 * served by `GET /api/profile/photo/<id>` only to the account it belongs to,
 * and it goes with the account. Nothing a store or another shopper reads
 * carries it.
 *
 * The photo is cropped to a square and shrunk on the device
 * (`prepareProfilePhoto` on the web, `ImagePreparation` in the app), and the
 * server trusts none of that: the type is read from the file's own header, as
 * every upload's is, and the square is checked again.
 */
import { sniffImage, uploadProblem, type UploadProblem } from "./media.js";

/** The edge the device makes the square photo at. Drawn at 64px at most, twice that on a Retina screen and more for a sharp crop. */
export const PROFILE_PHOTO_EDGE = 512;

/** What the device may send — a 512px square is about 40 KB as WebP; this leaves room for a JPEG. */
export const MAX_PROFILE_PHOTO_BYTES = 400_000;

/** Changes in an hour, counted in Postgres: plenty for somebody choosing, none for a script. */
export const MAX_PROFILE_PHOTOS_PER_HOUR = 20;

export type ProfilePhotoProblem = UploadProblem | "profilePhoto.notSquare";

/** Why these bytes cannot be somebody's photo, or null. */
export function profilePhotoProblem(bytes: Uint8Array, declared: string): ProfilePhotoProblem | null {
  if (bytes.length > MAX_PROFILE_PHOTO_BYTES) return "media.tooLarge";
  const problem = uploadProblem(bytes, declared);
  if (problem) return problem;
  const info = sniffImage(bytes)!;
  /* A pixel either way: a crop rounded on the device is still a square. */
  if (Math.abs(info.width - info.height) > 1) return "profilePhoto.notSquare";
  if (info.width > PROFILE_PHOTO_EDGE * 2) return "media.tooLarge";
  return null;
}

/**
 * Where the photo is read from. The account is in the path and the version in
 * the query, so a browser keeps one copy per photo and never shows one
 * account's photo to the next person to sign in on the device — the server
 * answers only the account the path names.
 */
export function profilePhotoPath(userId: number, version: number): string {
  return `/api/profile/photo/${userId}?v=${version}`;
}
