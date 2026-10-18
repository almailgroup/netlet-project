/**
 * The pictures a model draws for NetLet — the database and gateway half of
 * `Shared/commerce/aiImages.ts`.
 *
 * Nothing drawn here is stored by this module. A cleaned-up product photo and
 * a guide's picture go back to the browser that asked, which prepares them
 * like any upload and uploads only the one a person chose; a try-on goes back
 * to the shopper and nowhere else. The server cannot store what the model
 * returns anyway — it carries no image library, and only JPEG and WebP the
 * browser made are ever kept (`media.ts`).
 *
 * Every input is held to the gateway's own sizes and types before anything is
 * counted, then the person's hourly allowance is taken, then the model is
 * asked. A picture back is one by its own bytes or it is a failure.
 */
import { and, asc, eq } from "drizzle-orm";
import { categories, productImages, products, vendors } from "../../database/schema.js";
import { IMAGE_TYPES, MAX_IMAGE_BASE64, type CatalogImage, type ImageType, type GenerateAnswer } from "../../../Shared/ai/gateway.js";
import {
  CLEANUP_PROMPT,
  CLEANUP_SYSTEM,
  DRAWING_DEADLINE_MS,
  GUIDE_PICTURE_SYSTEM,
  MAX_GUIDE_PICTURES_PER_HOUR,
  MAX_PHOTO_CLEANUPS_PER_HOUR,
  MAX_TRY_ONS_PER_HOUR,
  TRY_ON_PROMPT,
  TRY_ON_SYSTEM,
  guidePicturePrompt,
  tryOnFits,
} from "../../../Shared/commerce/aiImages.js";
import { sniffRemoteImage, MAX_REMOTE_IMAGE_BYTES } from "../../../Shared/commerce/manufacturerImages.js";
import { can, type Actor } from "../../../Shared/inventory/permissions.js";
import { featureOn } from "./features.js";
import { askModelFor, modelAvailable } from "./gemini.js";
import { guardedFetch } from "./manufacturerImages.js";
import { readMedia } from "./media.js";
import { takeHourlyAllowance } from "./rateLimit.js";
import { getDb } from "./db.js";

export type DrawingProblem =
  | "media.notAllowed"
  | "media.notAnImage"
  | "media.tooLarge"
  | "drawing.off"
  | "drawing.tooMany"
  | "drawing.failed"
  | "tryOn.notFound"
  | "tryOn.notWearable"
  | "tryOn.noProductPhoto";

export class DrawingRefused extends Error {
  constructor(readonly reason: DrawingProblem) {
    super(reason);
    this.name = "DrawingRefused";
  }
}

export type Drawn = { type: ImageType; bytes: Buffer };

/** A picture the gateway will accept, from its own bytes — never the type somebody claimed. */
function asImage(bytes: Uint8Array): CatalogImage {
  const type = sniffRemoteImage(bytes);
  if (!type || !(IMAGE_TYPES as readonly string[]).includes(type)) throw new DrawingRefused("media.notAnImage");
  const data = Buffer.from(bytes).toString("base64");
  if (data.length > MAX_IMAGE_BASE64) throw new DrawingRefused("media.tooLarge");
  return { mimeType: type as ImageType, data };
}

/** What the model drew, if it is a picture by its own bytes. */
function drawnFrom(answer: GenerateAnswer | null): Drawn {
  if (!answer?.image) throw new DrawingRefused("drawing.failed");
  const bytes = Buffer.from(answer.image.data, "base64");
  const type = sniffRemoteImage(bytes);
  if (!type || !(IMAGE_TYPES as readonly string[]).includes(type)) throw new DrawingRefused("drawing.failed");
  return { type: type as ImageType, bytes };
}

async function draw(task: "photoCleanup" | "tryOn" | "guideImage", call: { system: string; prompt: string; image: CatalogImage | null; images?: CatalogImage[] }): Promise<Drawn> {
  const answer = await askModelFor(task, {
    system: call.system,
    prompt: call.prompt,
    image: call.image,
    images: call.images,
    json: false,
    output: "image",
    temperature: 0.2,
    maxOutputTokens: 1024,
    deadlineMs: DRAWING_DEADLINE_MS,
  });
  return drawnFrom(answer);
}

/** Whether the drawing model can be asked at all, and the feature that uses it is on. */
export async function drawingAvailable(feature?: "tryOn"): Promise<boolean> {
  if (!(await modelAvailable())) return false;
  return feature ? featureOn(feature) : true;
}

/* -------------------------------------------------------- 3.3.4 ---------- */

/**
 * A seller's product photo, on white, by the drawing model — offered beside
 * the photo as taken and the rule-fixed one, and used only if chosen.
 */
export async function cleanUpPhoto(actor: Actor, bytes: Uint8Array): Promise<Drawn> {
  if (!can(actor, "product.edit")) throw new DrawingRefused("media.notAllowed");
  const photo = asImage(bytes);
  if (!(await drawingAvailable())) throw new DrawingRefused("drawing.off");
  if (!(await takeHourlyAllowance(actor.userId, "photoClean", MAX_PHOTO_CLEANUPS_PER_HOUR))) throw new DrawingRefused("drawing.tooMany");
  return draw("photoCleanup", { system: CLEANUP_SYSTEM, prompt: CLEANUP_PROMPT, image: photo });
}

/* -------------------------------------------------------- 3.1.8 ---------- */

/** The department a product is filed under, by its top category's slug. */
async function departmentOf(productId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ slug: categories.slug, parentId: categories.parentId })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(products.id, productId))
    .limit(1);
  if (!row) return null;
  if (row.parentId === null) return row.slug;
  const [parent] = await db.select({ slug: categories.slug }).from(categories).where(eq(categories.id, row.parentId)).limit(1);
  return parent?.slug ?? row.slug;
}

/** The product's first photograph, as bytes: one of NetLet's own, or fetched through the guarded fetch. */
async function productPhoto(productId: number): Promise<CatalogImage | null> {
  const db = await getDb();
  if (!db) return null;
  const [first] = await db
    .select({ url: productImages.url })
    .from(productImages)
    .where(and(eq(productImages.productId, productId), eq(productImages.kind, "image")))
    .orderBy(asc(productImages.position), asc(productImages.id))
    .limit(1);
  if (!first) return null;
  try {
    const own = /^\/media\/([^/?#]+)$/.exec(first.url);
    const bytes = own
      ? (await readMedia(own[1]))?.bytes ?? null
      : (await guardedFetch(first.url, "image/webp,image/png,image/jpeg;q=0.9", MAX_REMOTE_IMAGE_BYTES)).bytes;
    return bytes ? asImage(bytes) : null;
  } catch {
    return null;
  }
}

/**
 * A shopper wearing a product, from their own photo — shown to them, kept
 * nowhere. Only something that is worn (`tryOnFits`), only a product the shop
 * shows, only signed in, and never past the hour's allowance. The shopper's
 * photo goes to Google's model and nowhere else; the page says so before it
 * is chosen.
 */
export async function tryOn(userId: number, productId: number, photo: CatalogImage): Promise<CatalogImage> {
  const db = await getDb();
  if (!db) throw new DrawingRefused("drawing.off");
  if (!(await drawingAvailable("tryOn"))) throw new DrawingRefused("drawing.off");
  const [product] = await db
    .select({ id: products.id, status: products.status, vendorStatus: vendors.status })
    .from(products)
    .innerJoin(vendors, eq(vendors.id, products.vendorId))
    .where(eq(products.id, productId))
    .limit(1);
  if (!product || product.status !== "published" || product.vendorStatus !== "approved") throw new DrawingRefused("tryOn.notFound");
  if (!tryOnFits(await departmentOf(productId))) throw new DrawingRefused("tryOn.notWearable");
  const person = asImage(Buffer.from(photo.data, "base64"));
  const garment = await productPhoto(productId);
  if (!garment) throw new DrawingRefused("tryOn.noProductPhoto");
  if (!(await takeHourlyAllowance(userId, "tryOn", MAX_TRY_ONS_PER_HOUR))) throw new DrawingRefused("drawing.tooMany");
  const drawn = await draw("tryOn", { system: TRY_ON_SYSTEM, prompt: TRY_ON_PROMPT, image: person, images: [garment] });
  return { mimeType: drawn.type, data: drawn.bytes.toString("base64") };
}

/** Whether a product can be tried on — for the product page to draw the button only where it works. */
export async function tryOnOffered(productId: number): Promise<boolean> {
  if (!(await drawingAvailable("tryOn"))) return false;
  return tryOnFits(await departmentOf(productId));
}

/* -------------------------------------------------------- 3.5.3 ---------- */

/** A picture for one step of a guide, for the administrator writing it. */
export async function drawGuidePicture(actor: Actor, step: { title: string; body: string }): Promise<CatalogImage> {
  if (!can(actor, "platform.configure")) throw new DrawingRefused("media.notAllowed");
  if (!(await drawingAvailable())) throw new DrawingRefused("drawing.off");
  if (!(await takeHourlyAllowance(actor.userId, "guideDraw", MAX_GUIDE_PICTURES_PER_HOUR))) throw new DrawingRefused("drawing.tooMany");
  const drawn = await draw("guideImage", { system: GUIDE_PICTURE_SYSTEM, prompt: guidePicturePrompt(step), image: null });
  return { mimeType: drawn.type, data: drawn.bytes.toString("base64") };
}
