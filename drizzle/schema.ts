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
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { notificationKinds } from "../shared/customer";

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

/** One row per shopper: locale, delivery area, and the active Shopify cart. */
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
    /** Opaque Shopify cart id, so a bag survives across devices. */
    shopifyCartId: varchar("shopify_cart_id", { length: 255 }),
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
