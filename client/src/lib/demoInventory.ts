/**
 * A vendor's-eye view of the dashboard, with no database behind it.
 *
 * The demo build has no server, so the dashboard would otherwise be a sign-in
 * wall — which shows nothing about the thing being demonstrated. This answers
 * as a `manager` at one vendor, which is the most informative rank to look at:
 * enough to see the catalog, the editor and the publish flow, but not the
 * team, so the shape of the permission model is visible rather than described.
 *
 * Writes are accepted and discarded. Nothing here is persisted, and nothing
 * here reaches the real inventory — this module only exists in a demo build.
 */
import { demoCatalog } from "@/lib/demoCatalog";

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
