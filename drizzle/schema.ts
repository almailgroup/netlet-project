/**
 * NetLet database schema.
 *
 * Reconstructed from the application's own usage after the original file was
 * lost, then reworked when authentication moved in-house: `users` is now keyed
 * by email and carries its own password digest, rather than mirroring an
 * external OAuth provider's subject id.
 *
 * Several constraints are load-bearing rather than cosmetic. `users.email` is
 * what makes registration reject a duplicate account instead of creating a
 * second one, and `upsertCustomerProfile`, `setSavedProduct` and
 * `setNotificationPreference` all rely on `onDuplicateKeyUpdate`, which only
 * behaves as an upsert when the collision is caught by a unique key —
 * `customer_preferences.user_id` and the two composite uniques below.
 *
 * varchar widths are kept deliberate rather than unbounded. Postgres would not
 * require them, but a declared width documents the field and keeps the schema
 * portable.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { notificationKinds } from "../shared/customer.js";

/* Postgres enums are named types created in the database, so they are declared
   once here rather than inline on the column as MySQL allows. */
export const userRole = pgEnum("user_role", ["user", "admin"]);
export const localeCode = pgEnum("locale_code", ["en", "ar"]);
export const notificationKind = pgEnum("notification_kind", notificationKinds);

/**
 * Shoppers, identified by email address.
 *
 * Where the credential lives depends on how the deployment is configured.
 * With Firebase Authentication set up, Firebase holds the password and this row
 * is a mirror: `firebaseUid` links the two, and `passwordHash` is null. Without
 * it, the server falls back to its own scrypt digest (see
 * `server/_core/password.ts`) in `passwordHash` and `firebaseUid` is null.
 * Exactly one of the two is set for any given account.
 *
 * The row exists in both cases because the serial `id` is what
 * `customer_preferences`, `saved_products`, `customer_notification_preferences`
 * and `order_tracking_events` all point at. Moving accounts to Firebase must
 * not turn four foreign keys into string lookups against a remote service.
 *
 * The address is stored lowercased so that a unique index is genuinely
 * case-insensitive regardless of the column's collation.
 */
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    /** Login identifier. Normalised to lowercase before it ever reaches here. */
    email: varchar("email", { length: 320 }).notNull(),
    /**
     * scrypt digest with its parameters embedded, so the cost can be raised
     * later. Null for accounts whose password Firebase holds.
     */
    passwordHash: varchar("password_hash", { length: 255 }),
    /** Firebase Authentication's uid for this shopper, when Firebase owns it. */
    firebaseUid: varchar("firebase_uid", { length: 128 }),
    /** Optional display name; the shopper may never supply one. */
    name: varchar("name", { length: 255 }),
    role: userRole("role").notNull().default("user"),
    lastSignedIn: timestamp("last_signed_in", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("users_email_unique").on(table.email),
    // Partial, so the many rows with no Firebase account do not all collide on
    // a single null.
    uniqueIndex("users_firebase_uid_unique").on(table.firebaseUid).where(sql`${table.firebaseUid} is not null`),
  ]
);

/** One row per shopper: locale, delivery area, and the active cart. */
export const customerPreferences = pgTable(
  "customer_preferences",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    locale: localeCode("locale").notNull().default("en"),
    /** Governorate id from `shared/customer.ts`; null until the shopper picks. */
    deliveryZoneId: varchar("delivery_zone_id", { length: 64 }),
    /** Opaque cart token, so a bag survives across devices. */
    cartId: varchar("cart_id", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  table => [uniqueIndex("customer_preferences_user_id_unique").on(table.userId)]
);

/** Saved ("wishlisted") products. The product id is the storefront handle/id. */
export const savedProducts = pgTable(
  "saved_products",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: varchar("product_id", { length: 191 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex("saved_products_user_product_unique").on(table.userId, table.productId),
    index("saved_products_user_id_idx").on(table.userId),
  ]
);

/**
 * Products a shopper asked to be told about.
 *
 * Distinct from `savedProducts`: saving is "I might buy this", following is
 * "tell me when something changes". A shopper follows an out-of-stock item to
 * hear when it returns, or a expensive one to hear when it drops — and the
 * vendor learns how many people are waiting, which is the demand signal the
 * requirements ask for.
 *
 * `lastNotifiedPrice` is what the price was when we last told them, so a drop
 * is measured against the last thing the shopper heard rather than against
 * whatever the price happens to be on the next sweep. Null until the first
 * notification goes out.
 */
export const followedProducts = pgTable(
  "followed_products",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: varchar("product_id", { length: 191 }).notNull(),
    /** Tell them when the price falls below what they last saw. */
    priceDrop: boolean("price_drop").notNull().default(true),
    /** Tell them when it is available again. */
    backInStock: boolean("back_in_stock").notNull().default(true),
    /** Decimal string, matching Money.amount — never a float. */
    lastNotifiedPrice: varchar("last_notified_price", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("followed_products_user_product_unique").on(table.userId, table.productId),
    index("followed_products_user_id_idx").on(table.userId),
    // The sweep that looks for price drops reads by product, not by shopper.
    index("followed_products_product_id_idx").on(table.productId),
  ]
);

/** Per-shopper notification opt-ins, one row per notification kind. */
export const customerNotificationPreferences = pgTable(
  "customer_notification_preferences",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Kinds come from `shared/customer.ts` so the enum cannot drift. */
    kind: notificationKind("kind").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("customer_notification_user_kind_unique").on(table.userId, table.kind),
    index("customer_notification_user_id_idx").on(table.userId),
  ]
);

/**
 * Order tracking timeline. Only `userId` is pinned by existing code — the
 * account page reads the row count alone — so the remaining columns describe a
 * courier/order event in the ordinary way and are free to change as the real
 * order source is wired up.
 */
export const orderTrackingEvents = pgTable(
  "order_tracking_events",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Order this event belongs to, as identified by the upstream system. */
    orderReference: varchar("order_reference", { length: 191 }).notNull(),
    status: varchar("status", { length: 64 }).notNull(),
    /** Human-readable detail, e.g. a courier's note. */
    message: text("message"),
    /** When the event happened upstream, which is not when we recorded it. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index("order_tracking_user_id_idx").on(table.userId),
    index("order_tracking_user_occurred_idx").on(table.userId, table.occurredAt),
  ]
);


/* ══════════════════════════════════════════════════════════ inventory ═══ */

/**
 * What a member of a vendor may do.
 *
 * Ordered least to most: the check is "does this member rank at or above what
 * the action needs", so adding a tier later means putting it in the right
 * place rather than revisiting every call site.
 *
 *   staff   — sees the vendor's products and edits stock. Cannot publish, so a
 *             warehouse account cannot put something in front of customers.
 *   manager — the above, plus creating, editing and publishing products.
 *   owner   — the above, plus managing who else is in the vendor.
 *
 * Platform admins are not on this list. Their reach comes from `users.role`
 * and is not scoped to a vendor.
 */
export const vendorRole = pgEnum("vendor_role", ["staff", "manager", "owner"]);

/** Where a product is in its life, and whether a shopper can see it. */
export const productStatus = pgEnum("product_status", [
  "draft",
  "pending_review",
  "published",
  "rejected",
  "archived",
]);

/** Whether a vendor may trade at all. */
export const vendorStatus = pgEnum("vendor_status", ["pending", "approved", "suspended"]);

/**
 * A selling company.
 *
 * `commissionPercent` and `commissionFixed` live here rather than on the
 * product because most vendors have one rate; a product-level override goes on
 * the product. Both are outside a vendor's own control by design — the
 * requirements are explicit that only an admin may change them, which is
 * enforced in the router, not here.
 */
export const vendors = pgTable(
  "vendors",
  {
    id: serial("id").primaryKey(),
    /** URL-safe name, used in vendor-facing routes. */
    slug: varchar("slug", { length: 120 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    nameAr: varchar("name_ar", { length: 255 }),
    status: vendorStatus("status").notNull().default("pending"),
    /** Percent of each sale NetLet keeps, 0–100 with two decimals. */
    commissionPercent: numeric("commission_percent", { precision: 5, scale: 2 }).notNull().default("10.00"),
    /** A flat per-order amount instead of, or alongside, the percentage. */
    commissionFixed: numeric("commission_fixed", { precision: 12, scale: 3 }),
    /**
     * Trusted vendors skip review: their products publish without an admin
     * looking first, which the requirements ask for by name.
     */
    autoPublish: boolean("auto_publish").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  table => [uniqueIndex("vendors_slug_unique").on(table.slug)]
);

/**
 * Who works for a vendor, and at what rank.
 *
 * This is the join that makes "give a vendor access with specific roles"
 * work: a shopper account becomes a vendor account by gaining a row here, and
 * one person can belong to several vendors. Nothing about the shopper record
 * changes, so the same login is both — which the requirements ask for.
 */
export const vendorMembers = pgTable(
  "vendor_members",
  {
    id: serial("id").primaryKey(),
    vendorId: integer("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: vendorRole("role").notNull().default("staff"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    // One membership per person per vendor; the role is a column, not a row.
    uniqueIndex("vendor_members_vendor_user_unique").on(table.vendorId, table.userId),
    index("vendor_members_user_id_idx").on(table.userId),
  ]
);

/**
 * The department tree.
 *
 * `parentId` is self-referential so "Electronics → Laptops" is expressible
 * without a second table. Depth is not constrained here; the UI decides how
 * deep it is willing to render.
 */
export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 120 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    nameAr: varchar("name_ar", { length: 160 }),
    parentId: integer("parent_id"),
    /** Lower sorts first; ties fall back to name. */
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [uniqueIndex("categories_slug_unique").on(table.slug)]
);

/**
 * A product, owned by exactly one vendor.
 *
 * Prices are `numeric`, never a float: a binary fraction cannot hold 24.375
 * exactly, and the Kuwaiti dinar has three decimal places, so rounding drift
 * here is money.
 */
export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    vendorId: integer("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    /** URL slug. Unique across the platform, not per vendor, since it routes. */
    handle: varchar("handle", { length: 191 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    titleAr: varchar("title_ar", { length: 255 }),
    description: text("description"),
    descriptionAr: text("description_ar"),
    status: productStatus("status").notNull().default("draft"),
    /** Why an admin rejected it, shown back to the vendor. */
    reviewNote: text("review_note"),
    tags: text("tags").array().notNull().default([]),
    /**
     * Spec rows, and the review score the cards and PDP read.
     *
     * A list rather than columns because what a spec row *is* differs per
     * department: a laptop has "Ram Size", a shoe has "Material", and neither
     * belongs in a table shared by both. `namespace` keeps the two kinds
     * apart — "reviews"/"rating" is the score, anything else is a spec.
     */
    attributes: jsonb("attributes")
      .$type<{ namespace: string; key: string; label: string; value: string }[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("products_handle_unique").on(table.handle),
    index("products_vendor_id_idx").on(table.vendorId),
    index("products_category_id_idx").on(table.categoryId),
    // The storefront's hot path: everything published, newest first.
    index("products_status_idx").on(table.status),
  ]
);

/**
 * A buyable version of a product.
 *
 * `stock` lives here rather than on the product because stock is a property of
 * the thing on the shelf — a medium in charcoal runs out while a large does
 * not. `options` holds the axes as a JSON object (`{"Size":"M"}`), which keeps
 * a product with three dimensions from needing a table per dimension.
 */
export const productVariants = pgTable(
  "product_variants",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    /** Merchant's own code. Unique per vendor, enforced in the data layer. */
    sku: varchar("sku", { length: 120 }),
    title: varchar("title", { length: 255 }).notNull().default("Default"),
    price: numeric("price", { precision: 12, scale: 3 }).notNull(),
    /** The struck-through "was" price. Null when it is not on offer. */
    compareAtPrice: numeric("compare_at_price", { precision: 12, scale: 3 }),
    /** Units on hand. Never negative — the data layer refuses to go below zero. */
    stock: integer("stock").notNull().default(0),
    /** Warn the vendor at or below this. Null means never. */
    lowStockAt: integer("low_stock_at"),
    options: jsonb("options").$type<Record<string, string>>().notNull().default({}),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  table => [
    index("product_variants_product_id_idx").on(table.productId),
    uniqueIndex("product_variants_sku_unique").on(table.sku),
  ]
);

/** Product photography, ordered. Files live in object storage; this is the URL. */
export const productImages = pgTable(
  "product_images",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    altText: varchar("alt_text", { length: 255 }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [index("product_images_product_id_idx").on(table.productId)]
);

/**
 * Every change to a stock level, and who made it.
 *
 * Stock is the number a vendor and an admin will one day disagree about, so
 * the current figure is never the only record: `delta` and `reason` say how it
 * got there. This is also half of the audit trail the requirements ask for.
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: serial("id").primaryKey(),
    variantId: integer("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
    /** Signed: negative is stock leaving. */
    delta: integer("delta").notNull(),
    /** What the level became, so history reads without replaying every row. */
    resulting: integer("resulting").notNull(),
    reason: varchar("reason", { length: 64 }).notNull(),
    note: text("note"),
    /** Null when the platform moved it rather than a person. */
    actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index("stock_movements_variant_id_idx").on(table.variantId),
    index("stock_movements_created_idx").on(table.createdAt),
  ]
);

/**
 * The bag, server-side.
 *
 * It lives in Postgres rather than the browser because a cart that only
 * exists in localStorage is gone the moment the shopper opens the site on
 * their phone, and NetLet promises a persistent cart on the home page. The id
 * is an unguessable token, not a serial: it is handed to an anonymous client
 * and is the only thing standing between one shopper's bag and another's.
 *
 * `userId` is null for a guest. Signing in attaches the guest cart to the
 * account rather than replacing it, so a bag filled before signing in
 * survives the sign-in.
 */
export const carts = pgTable(
  "carts",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  table => [index("carts_user_id_idx").on(table.userId)]
);

/**
 * One line of the bag.
 *
 * Deliberately stores no price. A cart is a list of intentions, and the price
 * is whatever the variant costs when the shopper looks — quoting a stale
 * price back at them is how a cart total stops matching the checkout. The
 * price gets frozen at the order, which is a different table and a different
 * problem.
 *
 * The composite unique is what makes "add the same variant twice" increment a
 * line instead of growing a second one.
 */
export const cartItems = pgTable(
  "cart_items",
  {
    id: serial("id").primaryKey(),
    cartId: varchar("cart_id", { length: 64 }).notNull().references(() => carts.id, { onDelete: "cascade" }),
    variantId: integer("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  table => [
    index("cart_items_cart_id_idx").on(table.cartId),
    uniqueIndex("cart_items_cart_variant_unique").on(table.cartId, table.variantId),
  ]
);

/* ------------------------------------------------------------- relations --- */

export const usersRelations = relations(users, ({ one, many }) => ({
  preferences: one(customerPreferences),
  savedProducts: many(savedProducts),
  followedProducts: many(followedProducts),
  notificationPreferences: many(customerNotificationPreferences),
  orderTrackingEvents: many(orderTrackingEvents),
}));

export const customerPreferencesRelations = relations(customerPreferences, ({ one }) => ({
  user: one(users, { fields: [customerPreferences.userId], references: [users.id] }),
}));

export const savedProductsRelations = relations(savedProducts, ({ one }) => ({
  user: one(users, { fields: [savedProducts.userId], references: [users.id] }),
}));

export const followedProductsRelations = relations(followedProducts, ({ one }) => ({
  user: one(users, { fields: [followedProducts.userId], references: [users.id] }),
}));

export const customerNotificationPreferencesRelations = relations(
  customerNotificationPreferences,
  ({ one }) => ({
    user: one(users, { fields: [customerNotificationPreferences.userId], references: [users.id] }),
  })
);

export const orderTrackingEventsRelations = relations(orderTrackingEvents, ({ one }) => ({
  user: one(users, { fields: [orderTrackingEvents.userId], references: [users.id] }),
}));

export const vendorsRelations = relations(vendors, ({ many }) => ({
  members: many(vendorMembers),
  products: many(products),
}));

export const vendorMembersRelations = relations(vendorMembers, ({ one }) => ({
  vendor: one(vendors, { fields: [vendorMembers.vendorId], references: [vendors.id] }),
  user: one(users, { fields: [vendorMembers.userId], references: [users.id] }),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, { fields: [categories.parentId], references: [categories.id], relationName: "categoryParent" }),
  children: many(categories, { relationName: "categoryParent" }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  vendor: one(vendors, { fields: [products.vendorId], references: [vendors.id] }),
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  variants: many(productVariants),
  images: many(productImages),
}));

export const productVariantsRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
  movements: many(stockMovements),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
}));

export const cartsRelations = relations(carts, ({ one, many }) => ({
  user: one(users, { fields: [carts.userId], references: [users.id] }),
  items: many(cartItems),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  variant: one(productVariants, { fields: [cartItems.variantId], references: [productVariants.id] }),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  variant: one(productVariants, { fields: [stockMovements.variantId], references: [productVariants.id] }),
  actor: one(users, { fields: [stockMovements.actorId], references: [users.id] }),
}));

/* ----------------------------------------------------------------- types --- */

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export type CustomerPreference = typeof customerPreferences.$inferSelect;
export type InsertCustomerPreference = typeof customerPreferences.$inferInsert;

export type SavedProduct = typeof savedProducts.$inferSelect;
export type InsertSavedProduct = typeof savedProducts.$inferInsert;

export type FollowedProduct = typeof followedProducts.$inferSelect;
export type InsertFollowedProduct = typeof followedProducts.$inferInsert;

export type CustomerNotificationPreference = typeof customerNotificationPreferences.$inferSelect;
export type InsertCustomerNotificationPreference = typeof customerNotificationPreferences.$inferInsert;

export type OrderTrackingEvent = typeof orderTrackingEvents.$inferSelect;
export type InsertOrderTrackingEvent = typeof orderTrackingEvents.$inferInsert;

export type Vendor = typeof vendors.$inferSelect;
export type InsertVendor = typeof vendors.$inferInsert;

export type VendorMember = typeof vendorMembers.$inferSelect;
export type VendorRole = VendorMember["role"];

export type Category = typeof categories.$inferSelect;

export type InventoryProduct = typeof products.$inferSelect;
export type InsertInventoryProduct = typeof products.$inferInsert;

export type ProductVariantRow = typeof productVariants.$inferSelect;
export type ProductImageRow = typeof productImages.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;

export type CartRow = typeof carts.$inferSelect;
export type CartItemRow = typeof cartItems.$inferSelect;
