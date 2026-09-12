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
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc.js";
import {
  addMemberByEmail,
  adjustStock,
  createProduct,
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
  updateProduct,
  vendorHealthFor,
} from "../inventory.js";
import { assertCan, VENDOR_ROLES } from "../../shared/inventory/permissions.js";
import { listAudit, type AuditAction } from "../audit.js";
import { TRUST_BADGES } from "../../shared/inventory/vendorHealth.js";

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
    if (message === "NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND", message: "No such product" });
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
    throw error;
  }
}

/** Money as a decimal string. Never a float — three decimal places is money. */
const moneySchema = z.string().regex(/^\d{1,9}(\.\d{1,3})?$/, "Expected an amount like 24.500");

const vendorScope = z.object({ vendorId: z.number().int().positive().optional() });

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
      .input(vendorScope.optional())
      .query(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user, input?.vendorId);
        return guard(() => listProductsFor(actor, input?.vendorId));
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
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => lowStock(actor, input?.limit ?? 50));
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
        limit: z.number().int().min(1).max(200).optional(),
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
    list: protectedProcedure.query(async ({ ctx }) => {
      const actor = await resolveActor(ctx.user);
      return guard(() => listVendors(actor));
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
