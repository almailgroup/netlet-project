/**
 * A shopper's profile photo, the database half of
 * `Shared/commerce/profilePhoto.ts`.
 *
 * One row per account in `profile_photos` (migration 0076). Until the owner
 * has pasted the bootstrap the table is missing, and every read here answers
 * "not open yet" (`ready: false`) rather than failing — the account page then
 * draws the initials it always drew and offers no photo to choose, which is
 * the Frequently Bought rule: closed, not broken.
 *
 * Outside `db.ts` for the reason `profile.ts` is: functions there call its
 * module-local `getDb`, which a test cannot redirect.
 */
import { eq } from "drizzle-orm";
import { profilePhotos } from "../../database/schema.js";
import { getDb } from "./db.js";
import { takeHourlyAllowance } from "./rateLimit.js";
import { isMissingTable } from "../core/describeError.js";
import { sniffImage, type StoredType } from "../../../Shared/commerce/media.js";
import {
  MAX_PROFILE_PHOTOS_PER_HOUR,
  profilePhotoPath,
  profilePhotoProblem,
  type ProfilePhotoProblem,
} from "../../../Shared/commerce/profilePhoto.js";

export type ProfilePhoto = {
  /** False until migration 0076 has been run; nothing is offered then. */
  ready: boolean;
  /** Where the photo is read from, or null when there is none. */
  url: string | null;
};

export class ProfilePhotoError extends Error {
  constructor(readonly reason: ProfilePhotoProblem | "media.tooMany" | "profilePhoto.unavailable") {
    super(reason);
    this.name = "ProfilePhotoError";
  }
}

async function db() {
  const database = await getDb();
  if (!database) throw new Error("profile photo: no database configured");
  return database;
}

export async function photoFor(userId: number): Promise<ProfilePhoto> {
  try {
    const [row] = await (await db())
      .select({ updatedAt: profilePhotos.updatedAt })
      .from(profilePhotos)
      .where(eq(profilePhotos.userId, userId));
    return { ready: true, url: row ? profilePhotoPath(userId, row.updatedAt.getTime()) : null };
  } catch (error) {
    if (isMissingTable(error)) return { ready: false, url: null };
    throw error;
  }
}

/**
 * Keep these bytes as the account's photo, replacing the one before. The
 * allowance is taken only once the bytes have passed, so a phone retrying a
 * file the server refuses does not spend somebody's hour.
 */
export async function setProfilePhoto(userId: number, bytes: Uint8Array, declared: string): Promise<ProfilePhoto> {
  const problem = profilePhotoProblem(bytes, declared);
  if (problem) throw new ProfilePhotoError(problem);
  const info = sniffImage(bytes)!;
  const database = await db();
  try {
    /* Asked first, so a missing table is "not open yet" rather than a spent allowance. */
    await database.select({ userId: profilePhotos.userId }).from(profilePhotos).where(eq(profilePhotos.userId, userId)).limit(1);
  } catch (error) {
    if (isMissingTable(error)) throw new ProfilePhotoError("profilePhoto.unavailable");
    throw error;
  }
  if (!(await takeHourlyAllowance(userId, "profilePhoto", MAX_PROFILE_PHOTOS_PER_HOUR))) throw new ProfilePhotoError("media.tooMany");
  const values = {
    contentType: info.type,
    bytes,
    width: info.width,
    height: info.height,
    byteSize: bytes.length,
    updatedAt: new Date(),
  };
  await database
    .insert(profilePhotos)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: profilePhotos.userId, set: values });
  return photoFor(userId);
}

export async function removeProfilePhoto(userId: number): Promise<ProfilePhoto> {
  try {
    await (await db()).delete(profilePhotos).where(eq(profilePhotos.userId, userId));
  } catch (error) {
    if (isMissingTable(error)) return { ready: false, url: null };
    throw error;
  }
  return { ready: true, url: null };
}

/** The photo's bytes and version, or null — for its owner's route alone. */
export async function readProfilePhoto(userId: number): Promise<{ contentType: StoredType; bytes: Uint8Array; version: number } | null> {
  try {
    const [row] = await (await db())
      .select({ contentType: profilePhotos.contentType, bytes: profilePhotos.bytes, updatedAt: profilePhotos.updatedAt })
      .from(profilePhotos)
      .where(eq(profilePhotos.userId, userId));
    return row ? { contentType: row.contentType as StoredType, bytes: row.bytes, version: row.updatedAt.getTime() } : null;
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}
