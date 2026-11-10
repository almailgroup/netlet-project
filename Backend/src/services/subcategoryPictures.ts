/**
 * The subcategories' pictures, the database half of
 * `Shared/commerce/subcategoryPictures.ts`: one `platform_settings` row a
 * subcategory, under `subpic:`, holding the `/media` path an administrator
 * kept. Drawing one is `drawSubcategoryPicture` in `aiImages.ts`, which hands
 * the picture back and keeps nothing.
 */
import { eq, like } from "drizzle-orm";
import { mediaFiles, platformSettings } from "../../database/schema.js";
import {
  SUBCATEGORY_PICTURE_PREFIX,
  acceptableSubcategoryPicture,
  findSubcategory,
  picturesFromRows,
  subcategoryPictureKey,
  type SubcategoryPictures,
} from "../../../Shared/commerce/subcategoryPictures.js";
import { mediaIdOf } from "../../../Shared/commerce/media.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { recordAudit } from "./audit.js";
import { auditActor } from "./inventory.js";
import { getDb } from "./db.js";

export class SubcategoryPictureRefused extends Error {
  constructor(readonly reason: "subcategoryPictures.notFound" | "subcategoryPictures.badPicture") {
    super(reason);
    this.name = "SubcategoryPictureRefused";
  }
}

/** Every kept picture, for the shop's Categories page; empty with no database. */
export async function subcategoryPictures(): Promise<SubcategoryPictures> {
  const db = await getDb();
  if (!db) return {};
  const rows = await db
    .select({ key: platformSettings.key, value: platformSettings.value })
    .from(platformSettings)
    .where(like(platformSettings.key, `${SUBCATEGORY_PICTURE_PREFIX}%`));
  return picturesFromRows(rows);
}

/**
 * Keeps `path` as a subcategory's picture: one of NetLet's own uploads that
 * exists, for a subcategory the shop has. Null takes the picture off, and the
 * row goes with it.
 */
export async function setSubcategoryPicture(actor: Actor, department: string, slug: string, path: string | null): Promise<SubcategoryPictures> {
  assertCan(actor, "platform.configure");
  if (!findSubcategory(department, slug)) throw new SubcategoryPictureRefused("subcategoryPictures.notFound");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const key = subcategoryPictureKey(department, slug);
  const [before] = await db.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, key)).limit(1);
  if (path === null) {
    await db.delete(platformSettings).where(eq(platformSettings.key, key));
  } else {
    if (!acceptableSubcategoryPicture(path)) throw new SubcategoryPictureRefused("subcategoryPictures.badPicture");
    const [file] = await db.select({ id: mediaFiles.id }).from(mediaFiles).where(eq(mediaFiles.id, mediaIdOf(path))).limit(1);
    if (!file) throw new SubcategoryPictureRefused("subcategoryPictures.badPicture");
    const now = new Date();
    await db
      .insert(platformSettings)
      .values({ key, value: path, updatedBy: actor.userId, updatedAt: now })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: path, updatedBy: actor.userId, updatedAt: now } });
  }
  await recordAudit(await auditActor(actor), {
    action: "subcategory.setPicture",
    subjectType: "setting",
    subjectLabel: key,
    before: { value: before?.value ?? null },
    after: { value: path },
  });
  return subcategoryPictures();
}
