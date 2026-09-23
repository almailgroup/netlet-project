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
import { SELL_UNITS as sellUnits } from "../shared/commerce/units.js";

/* Postgres enums are named types created in the database, so they are declared
   once here rather than inline on the column as MySQL allows. */
export const userRole = pgEnum("user_role", ["user", "admin"]);
export const localeCode = pgEnum("locale_code", ["en", "ar"]);
export const wishlistVisibility = pgEnum("wishlist_visibility", ["private", "public"]);
/* What a variant's price is quoted against. `each` is every product today. */
export const sellUnit = pgEnum("sell_unit", sellUnits);
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
    /**
     * When this administrator last read the audit trail.
     *
     * Requirement 3.3.8 asks for a vendor's product changes to be *visible to
     * an admin*, and a log nobody opens is not visibility. This is what makes
     * "since you last looked" a real question. Null means never, which counts
     * everything — the honest answer for somebody arriving for the first time.
     */
    auditSeenAt: timestamp("audit_seen_at", { withTimezone: true }),
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
    /*
     * Nullable on purpose: null means "never chose", which is different from
     * choosing English. A row gets created the first time a shopper sets a
     * delivery zone or their bag syncs, and a NOT NULL default stamped "en"
     * onto people who had said nothing — then the client adopted it and
     * flipped an Arabic session to English on sign-in.
     */
    locale: localeCode("locale"),
    /** Governorate id from `shared/customer.ts`; null until the shopper picks. */
    deliveryZoneId: varchar("delivery_zone_id", { length: 64 }),
    /** Opaque cart token, so a bag survives across devices. */
    cartId: varchar("cart_id", { length: 255 }),
    /*
     * The number friends and family type to find a published wishlist, stored
     * canonically (`+9655…`) by `normalisePhone` so one person has one key
     * whatever spelling their aunt used.
     *
     * Unique, and null until the shopper sets it. Unique because two accounts
     * answering one number makes the lookup ambiguous, and a gift list that
     * resolves to a coin toss is worse than no gift list. Nullable because
     * most shoppers never publish anything and must not be made to hand over
     * a phone number to shop.
     *
     * Deliberately not verified, and that is a known gap rather than an
     * oversight: verifying it needs SMS, which NetLet does not have. What it
     * costs is that somebody could publish a list under a number that is not
     * theirs — they would be advertising their own wishes at a stranger's
     * number, which is odd rather than dangerous, and the unique index keeps
     * it from displacing the real owner once they arrive.
     */
    wishlistPhone: varchar("wishlist_phone", { length: 24 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("customer_preferences_user_id_unique").on(table.userId),
    // Partial, so the many shoppers with no number do not all collide on null.
    uniqueIndex("customer_preferences_wishlist_phone_unique")
      .on(table.wishlistPhone)
      .where(sql`${table.wishlistPhone} is not null`),
  ]
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

/* -------------------------------------------------------------- wishlists --- */

/**
 * A list a shopper keeps, and may publish for other people to buy from.
 *
 * Distinct from `savedProducts` in the way `followedProducts` is: saving is
 * "I might buy this", following is "tell me when it changes", and a wishlist
 * is "I would like somebody to buy me this". Only the third has an audience,
 * and having an audience is what makes it a different table rather than a
 * column on the first — every rule here is about a stranger reading it.
 *
 * **Private is the default and public is a decision.** `visibility` has no
 * database default of "public" and never will: a list that becomes findable
 * because somebody did not notice a setting is the failure this whole feature
 * has to avoid.
 *
 * `shareToken` is what a URL carries, never the serial id. Ids are guessable
 * and a published list is a page people paste into a family group — a token
 * means the link cannot be walked, and it means a shopper can unpublish and
 * republish to get a fresh one when a link has gone somewhere they did not
 * intend.
 */
export const wishlists = pgTable(
  "wishlists",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 120 }).notNull(),
    visibility: wishlistVisibility("visibility").notNull().default("private"),
    /*
     * The name a stranger sees on a published list, copied rather than joined
     * to `users.name`. Two reasons, and the second is the important one: a
     * shopper may want "Noura" on a gift list and their full legal name on an
     * invoice, and a join would put whatever is on the account in front of
     * anybody who guesses a phone number. Null means the page says "This list".
     */
    ownerName: varchar("owner_name", { length: 120 }),
    /** Random, URL-safe, and regenerated whenever the list is republished. */
    shareToken: varchar("share_token", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("wishlists_share_token_unique").on(table.shareToken),
    index("wishlists_user_id_idx").on(table.userId),
  ]
);

/**
 * One wish, and whether anybody has taken it.
 *
 * `claimedAt` and `claimedBy` are the part the owner must never see. A list
 * whose owner can watch items go grey tells them exactly what they are getting
 * for their birthday, so the data layer's owner-facing reads leave both
 * columns out — the secrecy is enforced where the query is written, not by
 * asking every page to remember.
 *
 * `claimedBy` is nullable and `set null` on purpose: a giver need not have an
 * account, and one who deletes theirs must not take the hold with them.
 */
export const wishlistItems = pgTable(
  "wishlist_items",
  {
    id: serial("id").primaryKey(),
    wishlistId: integer("wishlist_id")
      .notNull()
      .references(() => wishlists.id, { onDelete: "cascade" }),
    /** The storefront product id, as `savedProducts` stores it. */
    productId: varchar("product_id", { length: 191 }).notNull(),
    /** "the blue one, size 42" — the owner's own words, for whoever buys it. */
    note: varchar("note", { length: 280 }),
    quantity: integer("quantity").notNull().default(1),
    /** When somebody said they were getting it. Lapses; see CLAIM_HOLD_DAYS. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimedBy: integer("claimed_by").references(() => users.id, { onDelete: "set null" }),
    /** Set when a claim became a real order. Never lapses. */
    boughtAt: timestamp("bought_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("wishlist_items_list_product_unique").on(table.wishlistId, table.productId),
    index("wishlist_items_list_id_idx").on(table.wishlistId),
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
 * Where an order is in the *money*, which is not where it is in the warehouse.
 *
 * Two lifecycles run over one order and conflating them is a classic
 * commerce bug: a basket spanning three vendors can be fully paid while two
 * of the three have shipped nothing. So payment lives here, on the order, and
 * fulfilment lives on the line — see `fulfilmentStatus`.
 *
 * `pending_payment` is the state every order is born in. Nothing else may
 * create one, because an order that exists without a payment attempt behind it
 * is a basket, and a basket is already a different table.
 */
export const orderStatus = pgEnum("order_status", [
  "pending_payment",
  "paid",
  "cancelled",
  "refunded",
]);

/**
 * Where a single line is in the warehouse.
 *
 * Per line rather than per order, and per line rather than per vendor, because
 * partial shipment is ordinary: two items from one seller where one is on the
 * shelf and one is not. Grouping lines by vendor gives the per-vendor view
 * without a table that would then have to be kept in step with the lines.
 */
export const fulfilmentStatus = pgEnum("fulfilment_status", [
  "pending",
  "preparing",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
]);

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

    /**
     * The Ministry of Commerce discount permit, which Kuwaiti law requires
     * before a shop may advertise a saving.
     *
     * A number and a window rather than a flag, because that is what is
     * actually issued — and the window is the part that matters: a permit
     * stops being valid on a date without anybody editing a product, so the
     * rule is applied when the storefront *reads* an offer and not only when a
     * vendor writes one. `shared/inventory/discountLicence.ts` is the rule.
     *
     * Nullable, like every other store detail: an admin recording a seller
     * should not be blocked because the permit is on a document nobody has
     * scanned. What it costs is the ability to run an offer, which is the
     * honest consequence rather than a refused save.
     */
    discountLicenceNumber: varchar("discount_licence_number", { length: 120 }),
    discountLicenceExpiresAt: timestamp("discount_licence_expires_at", { withTimezone: true }),
    /**
     * Whether shoppers may ask this seller for a special price.
     *
     * Off until a seller says otherwise: a "make me an offer" button on a shop
     * that will never answer one is a dead control, and the inbox it fills is
     * the seller's time. Deliberately *not* governed by the discount permit —
     * that covers advertising a saving to the public, and a figure quoted to
     * one shopper who asked for it is not an advertisement.
     */
    acceptsOffers: boolean("accepts_offers").notNull().default(false),
    /**
     * What this seller charges to deliver, and when they stop charging.
     *
     * Per seller rather than per platform, because a NetLet basket is three
     * parcels from three warehouses and one averaged figure charges the cheap
     * seller's customers for the expensive one. `shared/commerce/delivery.ts`
     * is the rule and is pure.
     *
     * Both nullable, and null means "not set": a seller with no fee recorded
     * delivers free, which errs toward the shopper. Charging them a number the
     * seller never typed would be inventing a price.
     */
    deliveryFlat: numeric("delivery_flat", { precision: 12, scale: 3 }),
    deliveryFreeOver: numeric("delivery_free_over", { precision: 12, scale: 3 }),
    /**
     * How soon this store usually ships, as a band (3.2.5).
     *
     * A band rather than hours, because that is what a seller can honestly
     * commit to. Null says nothing, and nothing is what the page shows — a
     * default would be NetLet promising on a seller's behalf.
     * `shared/commerce/deliverySpeed.ts` is the rule.
     */
    deliverySpeed: varchar("delivery_speed", { length: 20 }),
    /**
     * Who this store ships with (3.4.13).
     *
     * Free text and deliberately so: NetLet integrates with no carrier, and a
     * fixed list would be this codebase asserting which companies exist in
     * Kuwait. It is recorded and shown, and it claims nothing about tracking —
     * a carrier name beside a live-tracking promise NetLet cannot keep would
     * be worse than no name at all.
     */
    deliveryProvider: varchar("delivery_provider", { length: 120 }),
    /**
     * Selling under NetLet's own commercial licence rather than their own.
     *
     * Requirement 3.3.16: an individual who has no trade licence sells through
     * NetLet's. It is a fact about the arrangement, so it is recorded rather
     * than inferred from `licenceNumber` being blank — a seller who simply has
     * not handed their paperwork in is not the same as one trading under ours,
     * and collapsing the two would put NetLet's name behind somebody who never
     * asked for it.
     */
    underPlatformLicence: boolean("under_platform_licence").notNull().default(false),
    /**
     * Cash on delivery (3.2.2), and the most this seller will send a driver
     * to collect.
     *
     * On by default — the requirement says so, and a seller has to opt out —
     * because a new store that has recorded nothing must still be buyable
     * from. The ceiling is the seller's own risk appetite: a driver carrying a
     * thousand dinars is a different proposition from one carrying twenty.
     * Null means no ceiling, the honest reading of a seller who has not
     * thought about it.
     */
    acceptsCod: boolean("accepts_cod").notNull().default(true),
    codCeiling: numeric("cod_ceiling", { precision: 12, scale: 3 }),
    /**
     * Trust badges shown beside the vendor's name on a product page.
     *
     * Awarded by an admin rather than claimed by the vendor — a badge a seller
     * can grant themselves tells a buyer nothing. Stored as a list because the
     * set will grow, and a column per badge would mean a migration each time.
     */
    badges: text("badges").array().notNull().default([]),

    /*
     * The store's own details.
     *
     * All nullable, because a vendor row predating this and a vendor an admin
     * creates in a hurry are both legitimate — a required field here would
     * mean an admin cannot record a seller until they have chased down a
     * licence number. `preflight`-style completeness is a judgement for the
     * page to show, not a constraint that blocks the first save.
     */
    /** Where NetLet writes to the seller; not necessarily the owner's login. */
    contactEmail: varchar("contact_email", { length: 320 }),
    /** Kept as typed, including the +965: formatting a phone number loses it. */
    contactPhone: varchar("contact_phone", { length: 40 }),
    description: text("description"),
    descriptionAr: text("description_ar"),
    logoUrl: text("logo_url"),
    /** One of the six governorates, by the id in `shared/customer.ts`. */
    governorate: varchar("governorate", { length: 40 }),
    addressLine: text("address_line"),
    /** Kuwait trade licence. A string, never a number — it carries leading zeros. */
    licenceNumber: varchar("licence_number", { length: 60 }),
    /** Where payouts go. Stored as typed; validated as an IBAN, not parsed. */
    payoutIban: varchar("payout_iban", { length: 34 }),

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
     * Commission for this product alone, overriding the vendor's rate.
     *
     * The requirements ask for commission "per vendor company or per
     * individual product", so this is the per-product half. Null means "use
     * the vendor's", which is the common case — an override is the exception
     * and should look like one in the data.
     *
     * Like the vendor's, no vendor rank can write these: `vendor.setCommission`
     * is admin-only, and the guard is the same one.
     */
    commissionPercent: numeric("commission_percent", { precision: 5, scale: 2 }),
    commissionFixed: numeric("commission_fixed", { precision: 12, scale: 3 }),
    /**
     * Whether *this* product may be haggled over, overriding the vendor's own
     * answer in either direction.
     *
     * Nullable for the reason the commission columns are: "not this one" and
     * "no opinion about this one" are different instructions, and a boolean
     * defaulting to false would lose the second. A seller who will move on a
     * sofa and not on batteries needs both. `negotiable()` in
     * `shared/commerce/priceOffers.ts` resolves the pair.
     */
    acceptsOffers: boolean("accepts_offers"),
    /**
     * How soon *this* product ships, overriding the store's usual band.
     *
     * Nullable in the shape the commission rate and the price-request flag
     * both use: "no opinion about this one" is a different instruction from
     * picking the slowest band, and a non-null column would lose it. A sofa
     * built to order and a cable off the shelf leave the same warehouse.
     */
    deliverySpeed: varchar("delivery_speed", { length: 20 }),
    /**
     * How big it is, which is what decides the vehicle (3.4.14).
     *
     * A class the seller picks rather than dimensions, because a class is what
     * they can answer without a tape measure and it captures shape as well as
     * bulk — a mattress is light and still needs a van. Weight is the
     * fallback where there is no class, and `shared/commerce/vehicle.ts` is
     * the rule. Null is a real answer: unknown beats guessing small, which is
     * how a sofa gets dispatched on a motorcycle.
     */
    sizeClass: varchar("size_class", { length: 20 }),
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

    /**
     * How many of these the vendor will promise before any exist.
     *
     * A second pool, deliberately not a "sell anyway" flag: taking from it is
     * `preorder_stock = preorder_stock - n WHERE preorder_stock >= n`, exactly
     * the shape of the real stock take, so the property that stops two
     * shoppers being sold the same last item is not weakened by a pre-order —
     * it is applied twice. A vendor who promises 50 sells 50 and the
     * fifty-first is refused by the same mechanism.
     *
     * The allowance is also the flag. "May be pre-ordered" and "has allowance
     * left" are one question, and two columns that must agree eventually do
     * not. `shared/commerce/preorder.ts` is the rule.
     */
    preorderStock: integer("preorder_stock").notNull().default(0),
    /** When it is expected. Null means the vendor has not committed to a date. */
    preorderReleaseAt: timestamp("preorder_release_at", { withTimezone: true }),
    /*
     * Selling things that are not counted — the grocery shelf.
     *
     * `unit` is what the price is quoted against and `stepAmount` is how much
     * one `quantity` represents. A 500 g bag of rice is `("g", 500)` and one
     * quantity is one bag; loose tomatoes in quarter-kilos are `("g", 250)`
     * and six quantities is exactly 1.5 kg.
     *
     * **Quantity stays an integer, everywhere.** Making it fractional so a
     * shopper could buy 1.5 kg would put floating point into cart lines, order
     * lines, the stock take and the `stock >= n` predicate that stops two
     * people being sold the last item — and 0.1 + 0.2 is not 0.3 in any of
     * them. Counting steps keeps every existing query working unchanged and
     * the arithmetic exact, which is the same reason money is held in fils
     * rather than as a float.
     *
     * Defaults of `each` and 1 mean every product that exists today behaves
     * exactly as it did before this column landed.
     */
    unit: sellUnit("unit").notNull().default("each"),
    stepAmount: numeric("step_amount", { precision: 12, scale: 3 }).notNull().default("1"),
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
/**
 * What a product's gallery is made of.
 *
 * One kind column on one ordered table rather than a second table for video,
 * because a video belongs *between* the photographs — "alongside photos" is
 * what the requirement asks for — and two ordered lists would force an
 * interleave rule that has no right answer and would be re-invented at every
 * call site.
 */
export const mediaKind = pgEnum("media_kind", ["image", "video"]);

/**
 * The product gallery: photographs and video, in one order.
 *
 * The table is still called `product_images`, and that is a deliberate wart.
 * Renaming it would be a rename executed against a live database by pasting
 * `docs/supabase-bootstrap.sql`, which is the single riskiest migration shape
 * there is — and the file's whole value is that it can be re-run. A slightly
 * wrong table name costs less than that.
 */
export const productImages = pgTable(
  "product_images",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    altText: varchar("alt_text", { length: 255 }),
    position: integer("position").notNull().default(0),
    /** Defaults to `image`, so every row that predates video stays a photograph. */
    kind: mediaKind("kind").notNull().default("image"),
    /**
     * The still shown before a video plays, and in the thumbnail strip.
     *
     * Null is allowed and ordinary: a vendor may have the clip and no poster.
     * The player then shows its own first frame, which is worse but not
     * broken — refusing the video over a missing poster would be refusing the
     * feature over its garnish.
     */
    posterUrl: text("poster_url"),
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

/**
 * Who did what, and when.
 *
 * The requirements ask for an automatic background audit trail over sensitive
 * operations — commission edits, product approvals and rejections, permission
 * changes, vendor suspensions, admin sign-ins. "Automatic" is the load-bearing
 * word: a log somebody has to remember to write is a log with holes in it
 * exactly where it matters, so these rows are written by the data layer next
 * to the operation itself, the same place the permission guard lives.
 *
 * `before` and `after` hold the values either side of the change. Keeping both
 * is what makes the row answer "what actually changed" rather than only "a
 * change happened" — the difference between an audit trail and a list of
 * timestamps.
 *
 * `actorId` is nullable and `actorEmail` is copied rather than joined: an
 * account can be deleted, and an audit row that loses who performed the action
 * has lost the only thing it was for.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    /** Dotted act, e.g. "vendor.setCommission" or "product.review". */
    action: varchar("action", { length: 64 }).notNull(),
    /** What it was done to: "vendor", "product", "user", "session". */
    subjectType: varchar("subject_type", { length: 32 }).notNull(),
    subjectId: integer("subject_id"),
    /** Human label for the subject, so a deleted row still reads. */
    subjectLabel: varchar("subject_label", { length: 255 }),
    actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorEmail: varchar("actor_email", { length: 320 }),
    /**
     * What the actor was when they did it: `admin`, or a vendor rank.
     *
     * Frozen rather than joined, for the reason every other fact on this row
     * is: somebody promoted from `staff` to `manager` next week did not have
     * that rank when they changed the price, and a trail that answers with
     * today's rank is answering a different question. It is also what makes
     * "changes a seller made" a column filter rather than a join against a
     * membership table that has moved since.
     */
    actorRole: varchar("actor_role", { length: 20 }),
    /** Which vendor the action touched, when it was scoped to one. */
    vendorId: integer("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    /**
     * Who granted the actor the administrator rights they used.
     *
     * The requirement asks for "who changed it **and who authorised them**",
     * and the second half was missing: the trail knew that `alice@` set a
     * commission and, separately, that `bob@` made `alice@` an administrator,
     * with nothing joining the two. This resolves that chain at write time and
     * freezes it, because an audit row records what was true at the moment —
     * reading it back later against a permission table that has since changed
     * would answer a different question. The same instinct the order lines
     * follow.
     *
     * Null is ordinary and means one of two honest things: the actor is the
     * installation's first administrator, granted by whoever set the database
     * up, or the grant predates this column. Neither is a gap worth inventing
     * a name for.
     */
    authorisedById: integer("authorised_by_id").references(() => users.id, { onDelete: "set null" }),
    authorisedByEmail: varchar("authorised_by_email", { length: 320 }),
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index("audit_log_created_idx").on(table.createdAt),
    index("audit_log_action_idx").on(table.action),
    index("audit_log_subject_idx").on(table.subjectType, table.subjectId),
    index("audit_log_actor_idx").on(table.actorId),
  ]
);

/**
 * Failed sign-ins and password-reset requests, for throttling.
 *
 * In Postgres rather than in the process's memory, and that is the whole
 * point. `express-rate-limit` keeps its counters in a `Map`, which is correct
 * for one long-lived server and close to useless on a platform that answers
 * requests from a pool of short-lived instances: each one starts with an empty
 * Map, so the ceiling is really the ceiling times however many instances are
 * warm, and it resets whenever one recycles. A table is the one piece of state
 * every instance already shares.
 *
 * `bucket` is the thing being limited — `account:<email>` or `address:<ip>` —
 * lower-cased and stored as written, never joined to `users`: an attempt
 * against an address that has no account still has to count, or the limiter
 * can be told which addresses exist by which ones it throttles.
 */
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: serial("id").primaryKey(),
    /** `account:<email>` or `address:<ip>`. */
    bucket: varchar("bucket", { length: 340 }).notNull(),
    /** Which door was being tried: "login" or "reset". */
    kind: varchar("kind", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index("auth_attempts_bucket_idx").on(table.bucket, table.kind, table.createdAt),
    // Pruning walks by age alone, across every bucket.
    index("auth_attempts_created_idx").on(table.createdAt),
  ]
);


/* --------------------------------------------------------------- reviews --- */

/**
 * What a shopper thought of something they actually received.
 *
 * **Anchored to an order line, not to a person and a product.** The line is
 * the proof of purchase, so "verified" needs no separate flag and cannot be
 * forged by anything short of writing to `order_items`. It is also the right
 * uniqueness key: somebody who bought a kettle twice has two opinions worth
 * having, and somebody who bought it once cannot write ten. A
 * `(user_id, product_id)` key gets both of those wrong.
 *
 * `product_id` is carried beside it and is `set null` like every other
 * reference out of an order line — a product can be deleted and the review it
 * earned still has to render on the vendor's record. `product_title` is copied
 * for the same reason the order copies it.
 *
 * Nothing here is a rating a merchant typed. The star row on a product page
 * reads this table or shows nothing at all.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    /*
     * The proof, and the uniqueness key. Cascade rather than set null: a
     * review whose order line has been erased can no longer be shown to be a
     * real purchase, and an unverifiable review is exactly what this table
     * exists to make impossible.
     */
    orderItemId: integer("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    vendorId: integer("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    /** Copied, so an old review still names what it was about. */
    productTitle: varchar("product_title", { length: 255 }).notNull(),
    /** One to five whole stars. The floor and ceiling are in `shared/`. */
    rating: integer("rating").notNull(),
    title: varchar("title", { length: 120 }),
    body: text("body"),
    /**
     * Hidden by an admin, rather than deleted.
     *
     * A removed review is a fact about moderation and the vendor's record
     * should keep it. Hiding takes it off the page; deleting would also delete
     * the evidence of why it was taken off.
     */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenReason: varchar("hidden_reason", { length: 200 }),
    /** The vendor's public answer, if they gave one. */
    vendorReply: text("vendor_reply"),
    vendorRepliedAt: timestamp("vendor_replied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("reviews_order_item_unique").on(table.orderItemId),
    index("reviews_product_idx").on(table.productId, table.createdAt),
    index("reviews_vendor_idx").on(table.vendorId, table.createdAt),
    index("reviews_user_idx").on(table.userId),
  ]
);

/* --------------------------------------------------------- price offers --- */

/**
 * A shopper asking the seller for a better price, and the seller's answer.
 *
 * Requirement 3.1.13. The rules are in `shared/commerce/priceOffers.ts` and are
 * pure; this is where the negotiation lives.
 *
 * **Four stored states, two derived.** `expired` comes from `expires_at` and
 * `used` from `used_on_order_id`, neither of them stored — a stored `expired`
 * needs a job to go round and write it, and until that job runs the row claims
 * a price is still good when it is not. The same decision the discount permit
 * makes, for the same reason.
 *
 * **The cart still stores no price.** A granted price is a fact about a shopper
 * and a variant, so the cart and the order look it up rather than carrying it:
 * `cart_items` is untouched, and "a cart is a list of intentions" survives
 * intact. The order freezes the resolved figure the way it freezes every other.
 */
export const priceOffers = pgTable(
  "price_offers",
  {
    id: serial("id").primaryKey(),
    /*
     * Signed in, always. A grant is attached to an account because a discount
     * somebody can collect again by clearing their cookies is not a discount,
     * and an anonymous cart token is not an identity.
     */
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /*
     * The variant rather than the product: two sizes of the same thing are two
     * prices, and a discount agreed on the large one is not an answer about
     * the small one. Cascade, because a price for a variant that no longer
     * exists cannot be honoured.
     */
    variantId: integer("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    vendorId: integer("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    /** Copied, so an answered request still names what it was about. */
    productTitle: varchar("product_title", { length: 255 }).notNull(),
    /**
     * What the shelf said when the shopper asked.
     *
     * Frozen for the reason an order line freezes its price: the seller is
     * answering a question about a number, and if the catalog moves underneath
     * them the inbox would quietly rewrite what they were asked.
     */
    listPrice: numeric("list_price", { precision: 12, scale: 3 }).notNull(),
    /** What the shopper asked to pay, per unit. */
    askedPrice: numeric("asked_price", { precision: 12, scale: 3 }).notNull(),
    /** How many they said they wanted — context for the seller, not a reservation. */
    quantity: integer("quantity").notNull().default(1),
    /** What the shopper wrote, and what the seller wrote back. */
    shopperNote: text("shopper_note"),
    vendorNote: text("vendor_note"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    /** The seller's answer, per unit. Null until they give one. */
    offeredPrice: numeric("offered_price", { precision: 12, scale: 3 }),
    /**
     * When this stops meaning anything — the seller's deadline to reply while
     * it is pending, the shopper's deadline to buy once it is answered.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    answeredBy: integer("answered_by").references(() => users.id, { onDelete: "set null" }),
    /** Set null rather than cascade: spending it is a fact even if the order goes. */
    usedOnOrderId: integer("used_on_order_id").references(() => orders.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  table => [
    /*
     * One live request per shopper per variant, enforced here rather than by a
     * check in application code: two browser tabs are enough to make a
     * read-then-insert race, and a seller looking at the same question twice
     * is the kind of noise that makes them stop reading the inbox.
     */
    uniqueIndex("price_offers_open_unique")
      .on(table.userId, table.variantId)
      .where(sql`${table.status} in ('pending', 'offered') and ${table.usedOnOrderId} is null`),
    index("price_offers_vendor_idx").on(table.vendorId, table.status, table.createdAt),
    index("price_offers_user_idx").on(table.userId, table.createdAt),
    index("price_offers_variant_idx").on(table.variantId),
  ]
);

/* ---------------------------------------------------------------- orders --- */

/**
 * A purchase, and the point at which intentions become obligations.
 *
 * `carts` holds no prices on purpose — a cart is a list of intentions, and the
 * price is whatever the variant costs when the shopper looks. Freezing it is
 * *this* table's job, and it happens once, here, at placement.
 *
 * Almost everything about the shopper is copied rather than joined. `userId`
 * is nullable because guest checkout is a real case, and `email` is stored
 * beside it because an account can be deleted and an order that has lost who
 * placed it has lost the thing it was for. The delivery address is copied for
 * the same reason in the other direction: somebody correcting a typo in their
 * address next March must not rewrite where a parcel was sent last September.
 */
export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    /**
     * What a shopper quotes on the phone.
     *
     * Not the serial id: that tells anyone who orders twice exactly how many
     * orders NetLet took in between, which is nobody's business and is the
     * first number a competitor would collect.
     */
    reference: varchar("reference", { length: 24 }).notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    email: varchar("email", { length: 320 }).notNull(),
    status: orderStatus("status").notNull().default("pending_payment"),
    currency: varchar("currency", { length: 3 }).notNull().default("KWD"),

    /* Money, frozen. `grandTotal` is stored rather than derived because it is
       what was charged — a later change to how totals are computed must not
       silently restate an old invoice. */
    itemsTotal: numeric("items_total", { precision: 12, scale: 3 }).notNull(),
    deliveryTotal: numeric("delivery_total", { precision: 12, scale: 3 }).notNull().default("0.000"),
    grandTotal: numeric("grand_total", { precision: 12, scale: 3 }).notNull(),
    /** NetLet's cut across every line, for reporting without a re-sum. */
    commissionTotal: numeric("commission_total", { precision: 12, scale: 3 }).notNull().default("0.000"),
    /**
     * Loyalty points spent on this order, and what they took off (3.1.15).
     *
     * Frozen beside every other figure, for the reason the commission rate is:
     * an order is an obligation and what the shopper was charged is not
     * recomputed later. `grand_total` is already net of `points_value`, so the
     * column that says what is owed needs no arithmetic to read.
     *
     * **It comes out of NetLet's cut and never the seller's.** No line changes:
     * `line_total`, `commission_amount` and `vendor_net` are what they would
     * have been, so a seller is paid the same whether or not the shopper spent
     * points. A marketing scheme funded out of somebody else's revenue is one
     * they never agreed to.
     */
    pointsSpent: integer("points_spent").notNull().default(0),
    pointsValue: numeric("points_value", { precision: 12, scale: 3 }).notNull().default("0.000"),
    /**
     * Who charged what to deliver, frozen beside the total.
     *
     * An order is an obligation, so the breakdown is copied the way the
     * commission rate is: recomputing last year's delivery against today's
     * fees is how a refund comes out at a different figure from the payment.
     * A list rather than a third table, for the reason the per-vendor view of
     * an order is derived from its lines rather than stored twice.
     */
    /**
     * How the shopper said they would pay.
     *
     * Only `cod` today, and the order stays `pending_payment` until somebody
     * records that the driver collected — nothing is authorised or captured,
     * so marking it paid at checkout would record a payment that has not
     * happened, which the finance panel would then report as revenue.
     */
    paymentMethod: varchar("payment_method", { length: 20 }),
    /** When the cash actually arrived, which is what makes the order paid. */
    paymentCollectedAt: timestamp("payment_collected_at", { withTimezone: true }),
    deliveryBreakdown: jsonb("delivery_breakdown").$type<{ vendorId: number | null; vendorName: string; fee: string }[] | null>(),

    /* Where it goes, as it was given. */
    contactName: varchar("contact_name", { length: 160 }),
    contactPhone: varchar("contact_phone", { length: 32 }),
    deliveryZoneId: varchar("delivery_zone_id", { length: 32 }),
    addressLine: text("address_line"),
    addressNotes: text("address_notes"),

    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("orders_reference_unique").on(table.reference),
    index("orders_user_id_idx").on(table.userId),
    index("orders_status_idx").on(table.status),
    index("orders_placed_idx").on(table.placedAt),
  ]
);

/**
 * One line of an order, frozen at the moment of sale.
 *
 * Every reference out of this table is `set null`, and every fact that matters
 * is copied beside it. A product can be deleted, a variant renamed, a vendor
 * removed — and an order from last year still has to render, still has to be
 * refundable, and still has to say what was actually bought at what price. A
 * line that renders as "(deleted product) × 2" has lost the record.
 *
 * The commission rate is copied for the same reason and it matters more:
 * raising a vendor's rate in October must not change what they were owed in
 * September. `commissionAmount` is the money; the percent and fixed beside it
 * are so a statement can say *why* rather than only how much.
 */
export const orderItems = pgTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    /** Denormalised: per-vendor views and payouts both need it, and the
        vendor row can go away while the obligation does not. */
    vendorId: integer("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    variantId: integer("variant_id").references(() => productVariants.id, { onDelete: "set null" }),

    /* What was bought, as it read on the day. */
    vendorName: varchar("vendor_name", { length: 160 }),
    productTitle: varchar("product_title", { length: 255 }).notNull(),
    variantTitle: varchar("variant_title", { length: 255 }),
    sku: varchar("sku", { length: 120 }),

    unitPrice: numeric("unit_price", { precision: 12, scale: 3 }).notNull(),
    quantity: integer("quantity").notNull(),
    lineTotal: numeric("line_total", { precision: 12, scale: 3 }).notNull(),

    /* The rate that was in force, and what it came to. */
    commissionPercent: numeric("commission_percent", { precision: 5, scale: 2 }).notNull().default("0.00"),
    commissionFixed: numeric("commission_fixed", { precision: 12, scale: 3 }).notNull().default("0.000"),
    commissionAmount: numeric("commission_amount", { precision: 12, scale: 3 }).notNull().default("0.000"),
    /** What the vendor is owed for this line: line total less commission. */
    vendorNet: numeric("vendor_net", { precision: 12, scale: 3 }).notNull().default("0.000"),

    /*
     * Whether this line was sold before the goods existed, and when it was
     * promised for.
     *
     * Frozen beside the price for the same reason the commission rate is: an
     * order is an obligation, and what the shopper was told at the moment of
     * sale is the fact a complaint or a refund is measured against. A vendor
     * moving the expected date in October must not rewrite what was promised
     * in September — they can still say so, but the order records what was
     * agreed.
     *
     * `fulfilment` stays the same lifecycle. A pre-ordered line sits at
     * `pending` for longer; it does not need a state of its own, and adding
     * one would put the same fact in two places.
     */
    preordered: boolean("preordered").notNull().default(false),
    preorderReleaseAt: timestamp("preorder_release_at", { withTimezone: true }),

    fulfilment: fulfilmentStatus("fulfilment").notNull().default("pending"),
    /*
     * When the goods actually arrived.
     *
     * Two features were standing `updatedAt` in for this — the return window
     * and, later, review eligibility — and both carried a comment saying it
     * was one line to change when the column landed. This is that line.
     *
     * It is a *date*, not a restatement of `fulfilment`, and the two are
     * deliberately allowed to disagree: a line that was delivered and then
     * returned reads `returned` today while keeping the date it arrived. That
     * is what lets somebody review a product they sent back, which is the most
     * useful review on the shelf.
     */
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  table => [
    index("order_items_order_id_idx").on(table.orderId),
    index("order_items_vendor_id_idx").on(table.vendorId),
    index("order_items_fulfilment_idx").on(table.fulfilment),
  ]
);

/* ------------------------------------------------------------- referrals --- */

/**
 * Who brought whom, and the points that came of it.
 *
 * Requirements 3.1.14 (two tracks) and 3.1.15 (spend the points or cash out at
 * a tenth). The arithmetic is in `shared/commerce/referral.ts` and is pure;
 * these two tables are the record it sums.
 *
 * **A referral is a fact about the referred account, so the unique index is on
 * that column.** One shopper can bring a hundred friends; nobody can be
 * brought twice. Enforcing it here rather than by a read-then-insert is the
 * same argument the price-offer index makes — two tabs beat a check in
 * application code, and the second credit is money.
 *
 * No code is stored. It is derived from the account id, so one account has one
 * code for ever and there is no second copy to edit into a collision.
 */
export const referrals = pgTable(
  "referrals",
  {
    id: serial("id").primaryKey(),
    /** Who did the inviting. Cascade: their referrals go with the account. */
    referrerId: integer("referrer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Who arrived. One row per person, for ever — see the index below. */
    referredId: integer("referred_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * The order that earned it, and null until one completes.
     *
     * Points are paid on a *sale*, never on a sign-up: a referral scheme that
     * pays for registrations pays for registrations, and the people who notice
     * that first are not the ones a shop wants. `set null`, because an order
     * that later disappears does not undo a payout that already happened.
     */
    qualifiedOrderId: integer("qualified_order_id").references(() => orders.id, { onDelete: "set null" }),
    qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex("referrals_referred_unique").on(table.referredId),
    index("referrals_referrer_idx").on(table.referrerId, table.createdAt),
  ]
);

/**
 * The points ledger. Every movement, with its reason.
 *
 * **There is no balance column anywhere**, and that is the design rather than
 * an omission. A stored balance beside a list of entries is two records of one
 * fact, and the first write that fails halfway makes them disagree — with the
 * shop's own answer being the one nobody can audit. `balanceOf` sums, which is
 * cheap and cannot drift.
 *
 * Every row carries why it exists, because "your balance went up" is not
 * something a shopper can check and "because Noura placed her first order" is.
 */
export const pointEntries = pgTable(
  "point_entries",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Positive earns, negative spends. Never zero: an entry moving nothing is noise. */
    points: integer("points").notNull(),
    /** One of `POINT_REASONS`. Kept as text rather than an enum so a new reason is not a migration. */
    reason: varchar("reason", { length: 32 }).notNull(),
    /** What it was about, when there is something: an order, a referral. */
    orderId: integer("order_id").references(() => orders.id, { onDelete: "set null" }),
    referralId: integer("referral_id").references(() => referrals.id, { onDelete: "set null" }),
    /** An admin's own words on an adjustment, so the ledger explains itself. */
    note: varchar("note", { length: 200 }),
    /**
     * When NetLet actually paid a cash-out.
     *
     * Only ever set on a `cashed_out` row. The *entry* is written when the
     * shopper asks, because the balance has to fall then or the same points
     * get spent in another tab; this records when the money left, which is a
     * separate fact a human does by bank transfer — the same arrangement the
     * seller payout report already describes.
     */
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index("point_entries_user_idx").on(table.userId, table.createdAt),
    /*
     * One welcome credit and one referrer bonus per referral, whatever races.
     * The partial index is on the rows that name a referral; spends and
     * adjustments name none and are unconstrained.
     */
    uniqueIndex("point_entries_referral_reason_unique")
      .on(table.referralId, table.reason)
      .where(sql`${table.referralId} is not null`),
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

export const wishlistsRelations = relations(wishlists, ({ one, many }) => ({
  user: one(users, { fields: [wishlists.userId], references: [users.id] }),
  items: many(wishlistItems),
}));

export const wishlistItemsRelations = relations(wishlistItems, ({ one }) => ({
  wishlist: one(wishlists, { fields: [wishlistItems.wishlistId], references: [wishlists.id] }),
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

export type Review = typeof reviews.$inferSelect;
export type InsertReview = typeof reviews.$inferInsert;

export type Wishlist = typeof wishlists.$inferSelect;
export type InsertWishlist = typeof wishlists.$inferInsert;

export type WishlistItem = typeof wishlistItems.$inferSelect;
export type InsertWishlistItem = typeof wishlistItems.$inferInsert;

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

export type AuditEntry = typeof auditLog.$inferSelect;

export type Referral = typeof referrals.$inferSelect;
export type PointEntryRow = typeof pointEntries.$inferSelect;
