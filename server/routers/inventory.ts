/**
 * The inventory API: one router for admins and vendors alike.
 *
 * There is deliberately not an `admin.*` router beside a `vendor.*` one. The
 * two would need the same twenty procedures with the same twenty bodies and a
 * different guard at the top of each, which is exactly the arrangement where a
 * guard eventually goes missing from one copy. Instead every procedure resolves
 * *who is asking* and the data layer refuses what they may not do — so an
 * admin and a vendor calling `products.list` get different rows from the same
 * code path.
 */
import { TRPCError } from "@trpc/server";
import { isGovernorate, isValidIban, isValidKuwaitPhone } from "../../shared/inventory/storeProfile.js";
import { z } from "zod";
import { SELL_UNITS } from "../../shared/commerce/units.js";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc.js";
import {
  addMemberByEmail,
  addMemberWithNewAccount,
  adjustStock,
  createProduct,
  createVendorWithOwner,
  sendMemberPasswordReset,
  getVendor,
  updateVendorProfile,
  getProduct,
  listCategories,
  listMembers,
  listPeople,
  listProductsFor,
  listVendors,
  lowStock,
  overview,
  publishedCatalog,
  publishedProduct,
  removeMember,
  removeMemberAsAdmin,
  resolveActor,
  reviewProduct,
  saveVariant,
  setMemberRole,
  setProductImages,
  setProductStatus,
  setUserAdmin,
  setProductCommission,
  setVendorBadges,
  setVendorCommission,
  setVendorStatus,
  stockHistory,
  myStore,
  setProductDeliverySpeed,
  setProductSizeClass,
  updateProduct,
  vendorHealthFor,
} from "../inventory.js";
import { assertCan, VENDOR_ROLES } from "../../shared/inventory/permissions.js";
import { listAudit, markAuditSeen, sellerChangesForAdmin, type AuditAction } from "../audit.js";
import { TRUST_BADGES } from "../../shared/inventory/vendorHealth.js";
import { DELIVERY_SPEEDS } from "../../shared/commerce/deliverySpeed.js";
import { SIZE_CLASSES } from "../../shared/commerce/vehicle.js";

/**
 * Turns the data layer's refusals into the right HTTP shape.
 *
 * `assertCan` throws `FORBIDDEN:<capability>` because it is pure and knows
 * nothing about tRPC. Translating here keeps that true while still giving the
 * client a 403 it can act on rather than a 500 that looks like a bug.
 */
async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FORBIDDEN:")) {
      throw new TRPCError({ code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) });
    }
    // Deliberately not "No such product": products, vendors and variants all
    // raise this, and a vendor profile reported as a missing product sends
    // whoever reads it looking in the wrong place.
    if (message === "NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND", message: "admin.notFound" });
    // These three are refusals a person can act on, not faults: they are
    // told what they may do instead rather than shown a failure.
    if (message === "NO_SUCH_ACCOUNT") {
      throw new TRPCError({ code: "NOT_FOUND", message: "admin.noSuchAccount" });
    }
    if (message === "CANNOT_DEMOTE_SELF") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "admin.cannotDemoteSelf" });
    }
    if (message === "LAST_ADMIN") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "admin.lastAdmin" });
    }
    // Opening a store: both are things the admin can fix in the form in front
    // of them, so they are named rather than reported as a failure.
    if (message === "SLUG_TAKEN") {
      throw new TRPCError({ code: "CONFLICT", message: "admin.slugTaken" });
    }
    if (message === "SLUG_REQUIRED") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "admin.slugRequired" });
    }
    // A refusal the admin can act on: they are one field away from fixing it.
    if (message === "UNPRICED") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "admin.unpriced" });
    }
    /* Two reasons, not one refusal: "record a permit" and "renew the permit"
       are different things for an admin to go and do. */
    if (message === "DISCOUNT_LICENCE_MISSING") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "admin.discountLicenceMissing" });
    }
    if (message === "DISCOUNT_LICENCE_EXPIRED") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "admin.discountLicenceExpired" });
    }
    if (message === "EMAIL_TAKEN") {
      throw new TRPCError({ code: "CONFLICT", message: "admin.emailTaken" });
    }
    throw error;
  }
}

/** Money as a decimal string. Never a float — three decimal places is money. */
const moneySchema = z.string().regex(/^\d{1,9}(\.\d{1,3})?$/, "Expected an amount like 24.500");

const vendorScope = z.object({ vendorId: z.number().int().positive().optional() });

/*
 * A store's details.
 *
 * The IBAN and phone go through the same pure checks the form uses, so a
 * value typed past the form — or posted straight at the API — is refused by
 * the same rule rather than a looser one. Empty is allowed throughout: a
 * detail nobody has yet is not an error.
 */
const blankOr = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([schema, z.literal("")]).nullish();

const storeDetails = {
  nameAr: z.string().trim().max(255).nullish(),
  contactEmail: blankOr(z.string().trim().email().max(320)),
  contactPhone: blankOr(z.string().trim().refine(isValidKuwaitPhone, "admin.invalidPhone")),
  description: z.string().trim().max(4000).nullish(),
  descriptionAr: z.string().trim().max(4000).nullish(),
  logoUrl: blankOr(z.string().trim().url().max(2000)),
  governorate: blankOr(z.string().trim().refine(isGovernorate, "admin.invalidGovernorate")),
  addressLine: z.string().trim().max(500).nullish(),
  licenceNumber: z.string().trim().max(60).nullish(),
  payoutIban: blankOr(z.string().trim().refine(isValidIban, "admin.invalidIban")),
  /* The Ministry of Commerce discount permit. Kuwaiti law requires one before
     a shop may advertise a saving — `shared/inventory/discountLicence.ts`. */
  discountLicenceNumber: z.string().trim().max(120).nullish(),
  discountLicenceExpiresAt: z.coerce.date().nullish(),
  /* What this store charges to deliver (3.2.4). Blank or absent is free —
     `shared/commerce/delivery.ts` treats an unset fee as no charge, which
     errs toward the shopper rather than inventing a price. */
  deliveryFlat: blankOr(moneySchema),
  deliveryFreeOver: blankOr(moneySchema),
  /* The store's usual shipping band (3.2.5). Validated against the list rather
     than accepted as free text, so a typo cannot reach a page that then has no
     translation for it. */
  deliverySpeed: blankOr(z.enum(DELIVERY_SPEEDS)),
  /* Who this store ships with (3.4.13). Free text, because NetLet integrates
     with no carrier and a fixed list would be asserting which companies exist
     in Kuwait. */
  deliveryProvider: blankOr(z.string().trim().max(120)),
};

export const inventoryRouter = router({
  /** Who the caller is, so the portal knows what to render before asking. */
  me: protectedProcedure
    .input(vendorScope.optional())
    .query(({ ctx, input }) => resolveActor(ctx.user, input?.vendorId)),

  categories: publicProcedure.query(() => listCategories()),

  /** The storefront's reads. No actor: only ever published, approved products. */
  storefront: router({
    list: publicProcedure
      .input(z.object({ limit: z.number().int().min(1).max(200).optional(), categoryId: z.number().int().optional() }).optional())
      .query(({ input }) => publishedCatalog(input ?? {})),
    byHandle: publicProcedure
      .input(z.object({ handle: z.string().min(1).max(191) }))
      .query(({ input }) => publishedProduct(input.handle)),
  }),

  products: router({
    list: protectedProcedure
      .input(vendorScope.extend({
        query: z.string().trim().max(160).optional(),
        status: z.enum(["draft", "pending_review", "published", "archived"]).optional(),
        page: z.number().int().min(1).max(100_000).optional(),
        pageSize: z.number().int().min(1).max(200).optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user, input?.vendorId);
        return guard(() => listProductsFor(actor, input?.vendorId, input ?? {}));
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => getProduct(actor, input.id));
      }),

    create: protectedProcedure
      .input(z.object({
        vendorId: z.number().int().positive(),
        title: z.string().trim().min(1).max(255),
        titleAr: z.string().trim().max(255).nullable().optional(),
        description: z.string().max(20000).nullable().optional(),
        categoryId: z.number().int().positive().nullable().optional(),
        tags: z.array(z.string().max(60)).max(40).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user, input.vendorId);
        return guard(() => createProduct(actor, input));
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        title: z.string().trim().min(1).max(255).optional(),
        titleAr: z.string().trim().max(255).nullable().optional(),
        description: z.string().max(20000).nullable().optional(),
        descriptionAr: z.string().max(20000).nullable().optional(),
        categoryId: z.number().int().positive().nullable().optional(),
        tags: z.array(z.string().max(60)).max(40).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...patch } = input;
        const actor = await resolveActor(ctx.user);
        return guard(() => updateProduct(actor, id, patch));
      }),

    /**
     * This product's own shipping band, or null to follow the store's.
     *
     * Its own procedure saving on its own, like every section of a store's
     * page: one Save across the editor writes a change somebody made while
     * editing something else.
     */
    setDeliverySpeed: protectedProcedure
      .input(z.object({ productId: z.number().int().positive(), speed: z.enum(DELIVERY_SPEEDS).nullable() }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(async () => {
          await setProductDeliverySpeed(actor, input.productId, input.speed);
          return { ok: true } as const;
        });
      }),

    /** How big it is for delivery, or null for unknown (3.4.14). */
    setSizeClass: protectedProcedure
      .input(z.object({ productId: z.number().int().positive(), sizeClass: z.enum(SIZE_CLASSES).nullable() }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(async () => {
          await setProductSizeClass(actor, input.productId, input.sizeClass);
          return { ok: true } as const;
        });
      }),

    /**
     * Replaces the product's images.
     *
     * The URL is validated as an absolute http(s) one: a relative path or a
     * `javascript:` string reaching an <img src> is not imagery, and the
     * storefront would render the failure as a broken card.
     */
    setImages: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        images: z.array(z.object({
          url: z.string().url().max(2000).refine(
            value => /^https?:\/\//i.test(value),
            "Image URLs must start with http:// or https://",
          ),
          altText: z.string().trim().max(255).nullable().optional(),
          kind: z.enum(["image", "video"]).optional(),
          /* Held to the same http(s) rule as the media URL beside it: a
             poster is fetched by the browser exactly as an image is. */
          posterUrl: z.string().url().max(2000).refine(
            value => /^https?:\/\//i.test(value),
            "Poster URLs must start with http:// or https://",
          ).nullable().optional(),
        })).max(12),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => setProductImages(actor, input.id, input.images));
      }),

    /**
     * Commission for this product alone. Admin only, like the vendor rate —
     * an override a vendor could set would be that rule with a loophole.
     */
    setCommission: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        percent: moneySchema.nullable().optional(),
        fixed: moneySchema.nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => setProductCommission(actor, input.id, { percent: input.percent, fixed: input.fixed }));
      }),

    setStatus: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        status: z.enum(["draft", "published", "archived"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => setProductStatus(actor, input.id, input.status));
      }),

    /** Admin only — the data layer refuses anyone else. */
    review: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        approve: z.boolean(),
        note: z.string().max(2000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => reviewProduct(actor, input.id, input.approve, input.note));
      }),
  }),

  variants: router({
    save: protectedProcedure
      .input(z.object({
        id: z.number().int().positive().optional(),
        productId: z.number().int().positive(),
        title: z.string().trim().min(1).max(255),
        sku: z.string().trim().max(120).nullable().optional(),
        price: moneySchema,
        compareAtPrice: moneySchema.nullable().optional(),
        stock: z.number().int().min(0).max(1_000_000).optional(),
        options: z.record(z.string().max(60), z.string().max(120)).optional(),
        /* The grocery shelf. `each` and 1 are what every product is today. */
        unit: z.enum(SELL_UNITS).optional(),
        stepAmount: z.number().positive().max(1_000_000).optional(),
        /* Pre-order: how many the vendor will promise ahead of stock, and when. */
        preorderStock: z.number().int().min(0).max(1_000_000).optional(),
        preorderReleaseAt: z.coerce.date().nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => saveVariant(actor, input));
      }),

    adjustStock: protectedProcedure
      .input(z.object({
        variantId: z.number().int().positive(),
        delta: z.number().int().min(-1_000_000).max(1_000_000),
        reason: z.enum(["received", "sold", "damaged", "correction", "returned"]),
        note: z.string().max(500).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => adjustStock(actor, input.variantId, input.delta, input.reason, input.note));
      }),
  }),

  /**
   * What the portal opens on, and the two reports it links to.
   *
   * All three are scoped by the data layer rather than the router: a vendor
   * asking gets their own numbers from the same call an admin uses to get
   * everyone's.
   */
  overview: protectedProcedure
    .input(vendorScope.optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user, input?.vendorId);
      return guard(() => overview(actor));
    }),

  lowStock: protectedProcedure
    .input(z.object({
        page: z.number().int().min(1).max(100_000).optional(),
        pageSize: z.number().int().min(1).max(200).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => lowStock(actor, input ?? {}));
    }),

  stockHistory: protectedProcedure
    .input(z.object({
      variantId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => stockHistory(actor, input ?? {}));
    }),

  /**
   * Who reaches the admin panel.
   *
   * Every procedure here needs `platform.manageUsers`, which no vendor rank
   * can reach — a vendor owner runs their own team through `vendors.members`,
   * which is a different question and a different guard.
   */
  /**
   * The audit trail, admin only.
   *
   * Guarded by `platform.viewAll` rather than a capability of its own: seeing
   * every vendor's sensitive operations is the same reach as seeing every
   * vendor, and a separate capability would be a second thing to forget to
   * check.
   */
  audit: protectedProcedure
    .input(z.object({
      action: z.string().max(64).optional(),
      subjectType: z.string().max(32).optional(),
      vendorId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(async () => {
        assertCan(actor, "platform.viewAll");
        return listAudit({
          action: input?.action as AuditAction | undefined,
          subjectType: input?.subjectType,
          vendorId: input?.vendorId,
          limit: input?.limit ?? 100,
        });
      });
    }),

  /**
   * What sellers changed, and how much of it this administrator has not seen.
   *
   * Requirement 3.3.8. Separate from `audit` rather than a filter on it,
   * because the question is different: the trail answers "what happened", this
   * answers "what happened that I have not read", and folding the second into
   * the first would make every caller pass a flag to opt out of it.
   */
  sellerChanges: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(async ({ ctx, input }) =>
      guard(async () => sellerChangesForAdmin(await resolveActor(ctx.user), input?.limit ?? 100))),

  /** Mark the trail read. A mutation, because it writes. */
  markAuditSeen: protectedProcedure
    .mutation(async ({ ctx }) => guard(async () => {
      await markAuditSeen(await resolveActor(ctx.user));
      return { ok: true } as const;
    })),

  /** Which store the caller acts for, by name. Null for an admin. */
  myStore: protectedProcedure
    .input(vendorScope.optional())
    .query(async ({ ctx, input }) => guard(async () => myStore(await resolveActor(ctx.user, input?.vendorId)))),

  /** A vendor's own performance numbers, or any vendor's for an admin. */
  health: protectedProcedure
    .input(vendorScope.optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user, input?.vendorId);
      return guard(() => vendorHealthFor(actor, input?.vendorId));
    }),

  people: router({
    list: protectedProcedure
      .input(z.object({
        query: z.string().trim().max(160).optional(),
        page: z.number().int().min(1).max(100_000).optional(),
        pageSize: z.number().int().min(1).max(200).optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => listPeople(actor, input ?? {}));
      }),

    setAdmin: protectedProcedure
      .input(z.object({ userId: z.number().int().positive(), isAdmin: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => setUserAdmin(actor, input.userId, input.isAdmin));
      }),

    addToVendor: protectedProcedure
      .input(z.object({
        vendorId: z.number().int().positive(),
        email: z.string().trim().email().max(320),
        role: z.enum(VENDOR_ROLES),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => addMemberByEmail(actor, input.vendorId, input.email, input.role));
      }),

    removeFromVendor: protectedProcedure
      .input(z.object({ vendorId: z.number().int().positive(), userId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => removeMemberAsAdmin(actor, input.vendorId, input.userId));
      }),
  }),

  vendors: router({
    list: protectedProcedure
      .input(z.object({
        page: z.number().int().min(1).max(100_000).optional(),
        pageSize: z.number().int().min(1).max(200).optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => listVendors(actor, input ?? {}));
      }),

    get: protectedProcedure
      .input(z.object({ vendorId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => getVendor(actor, input.vendorId));
      }),

    /**
     * Opens a store, with its owner's login if one was given.
     *
     * Admin only — `platform.manageUsers`, the same grant that administers
     * NetLet — because this both creates a company and hands somebody a
     * password for it.
     */
    create: protectedProcedure
      .input(z.object({
        name: z.string().trim().min(1).max(255),
        slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/, "admin.slugFormat"),
        status: z.enum(["pending", "approved", "suspended"]).optional(),
        commissionPercent: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).optional(),
        commissionFixed: moneySchema.nullish(),
        autoPublish: z.boolean().optional(),
        ...storeDetails,
        owner: z.object({
          email: z.string().trim().email().max(320),
          // The same floor the storefront's own registration uses: an admin
          // opening an account must not be able to set a weaker password
          // than the person could set for themselves.
          password: z.string().min(10).max(200),
          name: z.string().trim().max(255).nullish(),
          role: z.enum(["owner", "manager", "staff"]).optional(),
        }).nullish(),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => createVendorWithOwner(actor, input));
      }),

    updateProfile: protectedProcedure
      .input(z.object({
        vendorId: z.number().int().positive(),
        name: z.string().trim().min(1).max(255).optional(),
        ...storeDetails,
      }))
      .mutation(async ({ ctx, input }) => {
        const { vendorId, ...patch } = input;
        const actor = await resolveActor(ctx.user);
        return guard(() => updateVendorProfile(actor, vendorId, patch));
      }),

    members: protectedProcedure
      .input(z.object({ vendorId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user, input.vendorId);
        return guard(() => listMembers(actor, input.vendorId));
      }),

    setMemberRole: protectedProcedure
      .input(z.object({
        vendorId: z.number().int().positive(),
        userId: z.number().int().positive(),
        role: z.enum(VENDOR_ROLES),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user, input.vendorId);
        return guard(() => setMemberRole(actor, input.vendorId, input.userId, input.role));
      }),

    removeMember: protectedProcedure
      .input(z.object({ vendorId: z.number().int().positive(), userId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user, input.vendorId);
        return guard(() => removeMember(actor, input.vendorId, input.userId));
      }),

    /**
     * Creates a login for this store and attaches it, in one call.
     *
     * Admin only: `vendor.manageMembers` lets an owner rank and unrank their
     * own people, but minting a NetLet account is `platform.manageUsers`.
     */
    addNewMember: protectedProcedure
      .input(z.object({
        vendorId: z.number().int().positive(),
        email: z.string().trim().email().max(320),
        // The same floor the storefront's own registration uses, so an admin
        // cannot set a weaker password than the person could set themselves.
        password: z.string().min(10).max(200),
        name: z.string().trim().max(255).nullish(),
        role: z.enum(["owner", "manager", "staff"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const { vendorId, ...account } = input;
        const actor = await resolveActor(ctx.user);
        return guard(() => addMemberWithNewAccount(actor, vendorId, account));
      }),

    /** Emails a member a link to set a new password. Admin only. */
    sendPasswordReset: protectedProcedure
      .input(z.object({
        userId: z.number().int().positive(),
        locale: z.enum(["en", "ar"]).default("en"),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => sendMemberPasswordReset(actor, input.userId, input.locale));
      }),

    setBadges: protectedProcedure
      .input(z.object({
        vendorId: z.number().int().positive(),
        badges: z.array(z.enum(TRUST_BADGES)).max(TRUST_BADGES.length),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => setVendorBadges(actor, input.vendorId, input.badges));
      }),

    setCommission: protectedProcedure
      .input(z.object({
        vendorId: z.number().int().positive(),
        percent: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/),
        fixed: moneySchema.nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => setVendorCommission(actor, input.vendorId, input.percent, input.fixed));
      }),

    setStatus: protectedProcedure
      .input(z.object({
        vendorId: z.number().int().positive(),
        status: z.enum(["pending", "approved", "suspended"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => setVendorStatus(actor, input.vendorId, input.status));
      }),
  }),
});
