/**
 * A vendor's-eye view of the admin portal, with no database behind it.
 *
 * The demo build has no server, so the admin portal would otherwise be a sign-in
 * wall — which shows nothing about the thing being demonstrated. This answers
 * as a `manager` at one vendor, which is the most informative rank to look at:
 * enough to see the catalog, the editor and the publish flow, but not the
 * team, so the shape of the permission model is visible rather than described.
 *
 * Writes are accepted and discarded. Nothing here is persisted, and nothing
 * here reaches the real inventory — this module only exists in a demo build.
 */
import { demoCatalog } from "@/lib/demoCatalog";
import { vendorHealth } from "@shared/inventory/vendorHealth";

const VENDOR_ID = 1;

/** The demo's own products, shaped like rows the inventory router returns. */
export const demoInventoryProducts = demoCatalog.slice(0, 8).map((product, index) => ({
  id: index + 1,
  vendorId: VENDOR_ID,
  categoryId: null,
  handle: product.handle,
  title: product.title,
  titleAr: null,
  description: product.description,
  descriptionAr: null,
  // A spread of statuses, so the list shows what each one looks like rather
  // than eight identical green pills.
  status: (["published", "published", "draft", "pending_review", "published", "rejected", "published", "archived"] as const)[index] ?? "draft",
  reviewNote: index === 5 ? "Please add a photo of the back of the product." : null,
  tags: product.tags,
  createdAt: new Date(),
  updatedAt: new Date(),
  variants: product.variants.map((variant, position) => ({
    id: (index + 1) * 100 + position,
    productId: index + 1,
    sku: variant.sku,
    title: variant.title,
    price: variant.price.amount,
    compareAtPrice: variant.compareAtPrice?.amount ?? null,
    // One product deliberately empty, so the out-of-stock treatment is visible.
    stock: index === 2 ? 0 : 4 + index * 3,
    lowStockAt: null,
    options: {},
    position,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  images: product.images.map((image, position) => ({
    id: (index + 1) * 100 + position,
    productId: index + 1,
    url: image.url,
    altText: image.altText,
    position,
    createdAt: new Date(),
  })),
}));

export const demoInventoryActor = {
  kind: "vendor" as const,
  userId: 1,
  vendorId: VENDOR_ID,
  role: "manager" as const,
};

export const demoCategories = [
  { id: 1, slug: "electronics", name: "Electronics", nameAr: "الإلكترونيات", parentId: null, position: 0, createdAt: new Date() },
  { id: 2, slug: "home-and-kitchen", name: "Home & Kitchen", nameAr: "المنزل والمطبخ", parentId: null, position: 1, createdAt: new Date() },
];

/**
 * The overview counts, derived from the fixture products rather than typed.
 *
 * Deriving them means the tiles cannot disagree with the list behind them —
 * a hard-coded "3 drafts" beside a table showing four is exactly the kind of
 * thing a demo gets caught on.
 *
 * The platform-wide vendor counts are zero because the demo actor is a vendor
 * manager, and that is what the server returns for one.
 */
export const demoOverview = {
  draft: demoInventoryProducts.filter(row => row.status === "draft").length,
  pendingReview: demoInventoryProducts.filter(row => row.status === "pending_review").length,
  published: demoInventoryProducts.filter(row => row.status === "published").length,
  archived: demoInventoryProducts.filter(row => row.status === "archived").length,
  outOfStock: demoInventoryProducts.flatMap(row => row.variants).filter(variant => variant.stock <= 0).length,
  lowStock: 0,
  vendorsPending: 0,
  vendorsApproved: 0,
  zeroCommission: [] as { id: number; name: string }[],
};

export const demoLowStock = demoInventoryProducts
  .flatMap(product => product.variants.map(variant => ({ product, variant })))
  .filter(({ variant }) => variant.stock <= 0)
  .map(({ product, variant }) => ({
    variantId: variant.id,
    variantTitle: variant.title,
    sku: variant.sku,
    stock: variant.stock,
    lowStockAt: variant.lowStockAt,
    productId: product.id,
    productTitle: product.title,
    productStatus: product.status,
    vendorName: "NetLet",
    /* Sold out with shoppers waiting, so the demand line (3.1.1) is visible. */
    waiting: 3,
  }));

/** A short, plausible movement log so the panel is not an empty box. */
export const demoStockHistory = [
  { id: 3, delta: -2, resulting: 4, reason: "sold", note: null, createdAt: new Date(), variantId: 1, variantTitle: "Default", productId: 1, productTitle: demoInventoryProducts[0]?.title ?? "Product", actorEmail: "manager@netlet.test", actorName: "Demo Manager" },
  { id: 2, delta: 12, resulting: 6, reason: "received", note: "Two pallets", createdAt: new Date(), variantId: 1, variantTitle: "Default", productId: 1, productTitle: demoInventoryProducts[0]?.title ?? "Product", actorEmail: "manager@netlet.test", actorName: "Demo Manager" },
  { id: 1, delta: -1, resulting: 0, reason: "damaged", note: null, createdAt: new Date(), variantId: 3, variantTitle: "Default", productId: 3, productTitle: demoInventoryProducts[2]?.title ?? "Product", actorEmail: null, actorName: null },
];

/**
 * The demo vendor's health, derived from the fixtures rather than typed.
 *
 * Same reasoning as the overview counts: a hand-written score beside a list
 * of eight products is the first thing that goes stale. `vendorHealth` is the
 * function the server calls, so the demo shows the real arithmetic.
 */
const demoHealthInputs = {
  published: demoInventoryProducts.filter(row => row.status === "published").length,
  pendingReview: demoInventoryProducts.filter(row => row.status === "pending_review").length,
  // One fixture product is rejected, and a rejection is what the audit trail
  // would have recorded.
  rejections: demoInventoryProducts.filter(row => row.status === "rejected").length,
  outOfStock: demoInventoryProducts
    .filter(row => row.status === "published")
    .flatMap(row => row.variants)
    .filter(variant => variant.stock <= 0).length,
  variants: demoInventoryProducts
    .filter(row => row.status === "published")
    .flatMap(row => row.variants).length,
  rating: null,
};

export const demoHealth = {
  vendorId: VENDOR_ID,
  inputs: demoHealthInputs,
  ...vendorHealth(demoHealthInputs),
};
