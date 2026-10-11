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
import { lastDay, percentSchema, rowId } from "../_core/schemas.js";
import { MAX_SUBSCRIPTION_PERCENT } from "../../shared/commerce/subscriptions.js";
import { acceptableImageUrl } from "../../shared/commerce/media.js";
import { SELL_UNITS } from "../../shared/commerce/units.js";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc.js";
import {
  addMemberByEmail,
  addMemberWithNewAccount,
  adjustStock,
  bulkCreateProducts,
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
  removeMember,
  removeMemberAsAdmin,
  resolveActor,
  reviewProduct,
  saveVariant,
  setMemberRole,
  setProductAddons,
  setProductImages,
  setProductStatus,
  setUserAdmin,
  setProductCommission,
  setVendorBadges,
  setVendorCommission,
  setVendorStatus,
  setVendorAutoPublish,
  VENDOR_STATUSES,
  stockHistory,
  myStore,
  setProductAttributes,
  setProductDeliverySpeed,
  setProductSizeChart,
  setProductSizeClass,
  updateProduct,
  vendorHealthFor,
} from "../inventory.js";
import { assertCan, VENDOR_ROLES } from "../../shared/inventory/permissions.js";
import { listAudit, markAuditSeen, sellerChangesForAdmin, type AuditAction } from "../audit.js";
import { AWARDED_BADGES } from "../../shared/inventory/vendorHealth.js";
import { DELIVERY_SPEEDS } from "../../shared/commerce/deliverySpeed.js";
import { SIZE_CLASSES } from "../../shared/commerce/vehicle.js";
import { ADDON_KINDS } from "../../shared/commerce/addons.js";
import { modelConcernFor, modelReviewAvailable, reviewProducts } from "../productReview.js";
import {
  ApplicationError,
  approveApplication,
  countWaitingApplications,
  listApplications,
  myApplication,
  rejectApplication,
  saveApplication,
  submitApplication,
} from "../applications.js";
import { APPLICATION_STATES, MAX_COMMISSION_NOTE } from "../../shared/inventory/sellerApplication.js";
import { BundleError, listBundles, saveBundle, setBundleActive } from "../bundles.js";
import { deleteProduct, deletionCheck } from "../productDeletion.js";
import { moveProductToVendor } from "../productMove.js";
import { BULK_UPLOAD_LIMIT } from "../../shared/inventory/bulkUpload.js";
import { MAX_SIZE_LABEL, MAX_SIZES, MEASURES, type BodyMeasure, type SizeChart } from "../../shared/commerce/sizeGuide.js";

/** One size's range for one measure, in centimetres. */
const sizeRange = z.tuple([z.number().finite(), z.number().finite()]);

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
    /* A seller's own code, already on one of their own products. It used to
       reach here as a raw "duplicate key value violates unique constraint",
       which is a 500 for something the seller fixes by typing a different
       code — and the index it bounced off was global, so the code they had to
       change might have been taken by a shop they have never heard of. */
    if (message === "SKU_TAKEN") {
      throw new TRPCError({ code: "CONFLICT", message: "admin.skuTaken" });
    }
    // A refusal the admin can act on: they are one field away from fixing it.
    if (message === "UNPRICED") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "admin.unpriced" });
    }
    if (message === "EMAIL_TAKEN") {
      throw new TRPCError({ code: "CONFLICT", message: "admin.emailTaken" });
    }
    /* A size chart that would recommend wrongly (3.1.20), named by the rule
       it broke so the editor can say which. */
    if (message.startsWith("sizeGuide.")) {
      throw new TRPCError({ code: "BAD_REQUEST", message });
    }
    /* An obligation the product outlives — a placement still being paid for,
       stock NetLet holds — named, so the seller knows what to undo first. */
    if (message.startsWith("admin.deleteBlocked") || message.startsWith("admin.moveBlocked") || message === "admin.moveSameStore" || message === "admin.lastOwner") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message });
    }
    /* Moving a product onto a shelf where its code is already in use: the
       same refusal typing that code would get. */
    if (message === "admin.skuTaken") {
      throw new TRPCError({ code: "CONFLICT", message });
    }
    /* A shelf NetLet holds (4.2): the seller is told whose it is, not that
       something failed. */
    if (message.startsWith("fulfilment.") || message.startsWith("membership.")) {
      throw new TRPCError({ code: "BAD_REQUEST", message });
    }
    throw error;
  }
}

/** Money as a decimal string. Never a float — three decimal places is money. */
const moneySchema = z.string().regex(/^\d{1,9}(\.\d{1,3})?$/, "Expected an amount like 24.500");

const vendorScope = z.object({ vendorId: rowId.optional() });

/*
 * A store's details.
 *
 * The IBAN and phone go through the same pure checks the form uses, so a
 * value typed past the form — or posted straight at the API — is refused by
 * the same rule rather than a looser one. Empty is allowed throughout: a
 * detail nobody has yet is not an error.
 */
const webLink = z.string().trim().max(2000).regex(/^https?:\/\/\S+$/i, "sell.badLink");

const blankOr = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([schema, z.literal("")]).nullish();

export const storeDetails = {
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
  discountLicenceExpiresAt: lastDay.nullish(),
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
  /* Selling under NetLet's own licence (3.3.16) — a recorded fact about the
     arrangement, not an inference from a blank licence number. */
  underPlatformLicence: z.boolean().optional(),
  /* Cash on delivery (3.2.2). On unless the seller says otherwise. */
  acceptsCod: z.boolean().optional(),
  codCeiling: blankOr(moneySchema),
  /* Subscribe & Save (3.1.19): blank is "not offered", 0 is "offered at the
     shelf price". Capped at `MAX_SUBSCRIPTION_PERCENT` here so the column can
     never hold a saving the rule would then quietly clamp. */
  subscriptionPercent: blankOr(z.string().trim().regex(/^\d{1,2}(\.\d{1,2})?$/, "admin.invalidPercent")
    .refine(value => Number(value) <= MAX_SUBSCRIPTION_PERCENT, "admin.invalidPercent")),
};

/**
 * An application's own refusals, which are message keys rather than sentences
 * — the same arrangement `assertCan` and the order refusals already use, so a
 * reason can be read on an Arabic page.
 */
/** A bundle's own refusals, as message keys the page can say in either language. */
async function bundleGuard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof BundleError) throw new TRPCError({ code: "BAD_REQUEST", message: error.reason });
    throw error;
  }
}

async function applicationGuard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.reason });
    }
    throw error;
  }
}

export const inventoryRouter = router({
  /** Who the caller is, so the portal knows what to render before asking. */
  me: protectedProcedure
    .input(vendorScope.optional())
    .query(({ ctx, input }) => resolveActor(ctx.user, input?.vendorId)),

  categories: publicProcedure.query(() => listCategories()),

  /*
   * There used to be a `storefront` pair here — the published catalogue and one
   * product by handle, public — and nothing called them: the shop reads through
   * `commerce.*`, which runs every row through `fromInventory`. These answered
   * with the raw rows instead, so anybody could read each product's own
   * commission terms (an administrator's alone), the moderator's review note,
   * every variant's exact stock, reorder point and member price, and a
   * was-price the store's lapsed discount permit forbids showing — every rule
   * the shop's own read applies, skipped by a second door onto the same rows.
   */

  /**
   * Seller self-registration (3.3.1).
   *
   * The applicant's half is `protectedProcedure` and scoped by `ctx.user.id`
   * inside the data layer; the reviewer's half is guarded by
   * `platform.manageUsers` beside its query — approving one creates a store
   * and attaches an owner, which is exactly what that grant is for.
   */
  /**
   * Bundles (3.3.11).
   *
   * The guards are inside `server/bundles.ts` beside each query, because who
   * may make one depends on what is *in* it: a seller may bundle their own
   * goods, and a set spanning two shops is NetLet's own merchandising.
   */
  bundles: router({
    list: protectedProcedure.query(async ({ ctx }) => guard(async () =>
      listBundles(await resolveActor(ctx.user)))),

    save: protectedProcedure
      .input(z.object({
        id: rowId.optional(),
        name: z.string().trim().min(1).max(200),
        nameAr: z.string().trim().max(200).nullable().optional(),
        /* Null is NetLet's own, which is how a bundle spans two shops. */
        vendorId: rowId.nullable(),
        bundlePrice: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/),
        active: z.boolean().optional(),
        members: z.array(z.object({
          variantId: rowId,
          quantity: z.number().int().min(1).max(99),
        })).min(2).max(20),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user, input.vendorId ?? undefined);
        return guard(() => bundleGuard(() => saveBundle(actor, input)));
      }),

    setActive: protectedProcedure
      .input(z.object({ id: rowId, active: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => bundleGuard(() => setBundleActive(actor, input.id, input.active)));
      }),
  }),

  applications: router({
    /** The applicant's own, or null. Never anybody else's. */
    mine: protectedProcedure.query(({ ctx }) => myApplication(ctx.user.id)),

    save: protectedProcedure
      .input(z.object({
        storeName: z.string().trim().min(1).max(160),
        storeNameAr: z.string().trim().max(160).nullable().optional(),
        contactEmail: z.string().trim().email().max(320).nullable().optional(),
        contactPhone: z.string().trim().max(32).nullable().optional(),
        governorate: z.string().trim().max(32).nullable().optional(),
        addressLine: z.string().trim().max(300).nullable().optional(),
        licenceNumber: z.string().trim().max(64).nullable().optional(),
        licenceExpiresAt: z.coerce.date().nullable().optional(),
        /* Web addresses and nothing else: an administrator opens these from
           the review queue, so a `javascript:` or `data:` value typed here
           would run in the reviewer's session rather than show a document. */
        licenceDocUrl: blankOr(webLink),
        identityDocUrl: blankOr(webLink),
        payoutIban: z.string().trim().max(42).nullable().optional(),
        underPlatformLicence: z.boolean().optional(),
        /* The version they accepted, not a boolean: "they agreed" means
           nothing without "to what". */
        agreementVersion: z.string().trim().max(20).nullable().optional(),
        /* A proposal, shaped like a rate; whether it is a sensible one is
           `proposalProblem`, so the page can say it in the shopper's words. */
        proposedCommissionPercent: z.string().trim().max(8).nullable().optional(),
        commissionNote: z.string().max(MAX_COMMISSION_NOTE + 100).nullable().optional(),
      }))
      .mutation(({ ctx, input }) => applicationGuard(() => saveApplication(ctx.user.id, input))),

    submit: protectedProcedure.mutation(({ ctx }) => applicationGuard(() => submitApplication(ctx.user.id))),

    /* ------------------------------------------------------------ review --- */

    list: protectedProcedure
      .input(z.object({
        status: z.enum(APPLICATION_STATES).optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      }).optional())
      .query(async ({ ctx, input }) => guard(async () =>
        listApplications(await resolveActor(ctx.user), input ?? {}))),

    waiting: protectedProcedure.query(async ({ ctx }) =>
      guard(async () => countWaitingApplications(await resolveActor(ctx.user)))),

    approve: protectedProcedure
      /* The store's rate, chosen by the administrator approving it; the
         standard one when omitted (3.3.2). */
      .input(z.object({ id: rowId, commissionPercent: percentSchema.nullable().optional() }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => applicationGuard(() => approveApplication(actor, input.id, input.commissionPercent)));
      }),

    reject: protectedProcedure
      .input(z.object({ id: rowId, reason: z.string().trim().min(1).max(400) }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => applicationGuard(() => rejectApplication(actor, input.id, input.reason)));
      }),
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
      .input(z.object({ id: rowId }))
      .query(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => getProduct(actor, input.id));
      }),

    create: protectedProcedure
      .input(z.object({
        vendorId: rowId,
        title: z.string().trim().min(1).max(255),
        titleAr: z.string().trim().max(255).nullable().optional(),
        description: z.string().max(20000).nullable().optional(),
        categoryId: rowId.nullable().optional(),
        tags: z.array(z.string().max(60)).max(40).optional(),
        /* The guided form's first variant and pictures. The editor's blank
           draft sends neither and gets the "Default" at 0.000 it always did. */
        variant: z.object({
          price: moneySchema,
          compareAtPrice: moneySchema.nullable().optional(),
          sku: z.string().trim().max(120).nullable().optional(),
          stock: z.number().int().min(0).max(1_000_000).optional(),
        }).optional(),
        images: z.array(z.object({
          url: z.string().trim().max(2000).refine(acceptableImageUrl, "Image URLs must start with http:// or https://"),
          kind: z.enum(["image", "video"]).optional(),
          altText: z.string().trim().max(255).nullable().optional(),
        })).max(12).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user, input.vendorId);
        return guard(() => createProduct(actor, input));
      }),

    /**
     * What deleting a product would touch, for the dialog to show first, and
     * the delete itself. `server/productDeletion.ts` is both, and the delete
     * asks every question again inside its transaction — the check is a
     * preview, not a promise.
     */
    deletionCheck: protectedProcedure
      .input(z.object({ id: rowId }))
      .query(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => deletionCheck(actor, input.id));
      }),

    delete: protectedProcedure
      .input(z.object({ id: rowId }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => deleteProduct(actor, input.id));
      }),

    /**
     * Hands a product to another store (admin only). `server/productMove.ts`
     * says what follows the product and what stays with the store that sold.
     */
    move: protectedProcedure
      .input(z.object({ id: rowId, vendorId: rowId }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => moveProductToVendor(actor, input.id, input.vendorId));
      }),

    /**
     * A whole shelf from a spreadsheet (3.3.3, 3.3.5).
     *
     * The file is read on the client, by the same pure module the server would
     * have used — `planUpload` has no database in it, so parsing a 400-row CSV
     * in a browser and posting the *rows* is one round trip instead of two and
     * an upload endpoint. What arrives here is still checked: the ceiling, the
     * money shape and the vendor guard are all applied again, because the
     * client is not where a rule lives.
     */
    bulkCreate: protectedProcedure
      .input(z.object({
        vendorId: rowId,
        rows: z.array(z.object({
          title: z.string().trim().min(1).max(255),
          sku: z.string().trim().max(64).nullable(),
          price: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/),
          compareAtPrice: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/).nullable(),
          stock: z.number().int().min(0).max(1_000_000),
          category: z.string().trim().max(120).nullable(),
          description: z.string().max(20000),
          imageUrl: z.string().trim().max(2000).nullable(),
        }))
          /* A ceiling, because one request writes every row inside a single
             transaction: a file of fifty thousand lines would hold a
             connection open long enough to look like an outage. */
          .min(1)
          .max(BULK_UPLOAD_LIMIT),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user, input.vendorId);
        return guard(() => bulkCreateProducts(actor, input));
      }),

    update: protectedProcedure
      .input(z.object({
        id: rowId,
        title: z.string().trim().min(1).max(255).optional(),
        titleAr: z.string().trim().max(255).nullable().optional(),
        description: z.string().max(20000).nullable().optional(),
        descriptionAr: z.string().max(20000).nullable().optional(),
        categoryId: rowId.nullable().optional(),
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
      .input(z.object({ productId: rowId, speed: z.enum(DELIVERY_SPEEDS).nullable() }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(async () => {
          await setProductDeliverySpeed(actor, input.productId, input.speed);
          return { ok: true } as const;
        });
      }),

    /**
     * The product's specification rows (3.1.7).
     *
     * Replaces the whole list, because the client sends what the schema editor
     * produced *including* the free-form rows it kept — merging again here
     * would be two places deciding what survives, and they would disagree.
     */
    setAttributes: protectedProcedure
      .input(z.object({
        id: rowId,
        attributes: z.array(z.object({
          namespace: z.string().max(40),
          key: z.string().max(60),
          label: z.string().max(120),
          value: z.string().max(500),
        })).max(60),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(async () => {
          await setProductAttributes(actor, input.id, input.attributes);
          return { ok: true } as const;
        });
      }),

    /** The seller's size chart, or null to remove it (3.1.20). */
    setSizeChart: protectedProcedure
      .input(z.object({
        productId: rowId,
        chart: z.object({
          axis: z.string().trim().min(1).max(60),
          measures: z.array(z.enum(MEASURES)).min(1).max(MEASURES.length),
          rows: z.array(z.object({
            size: z.string().max(MAX_SIZE_LABEL),
            /* Each measure optional and nothing else allowed: a record keyed by
               the enum would demand all six on every row. */
            ranges: z.object(Object.fromEntries(MEASURES.map(measure => [measure, sizeRange.optional()])) as Record<BodyMeasure, z.ZodOptional<typeof sizeRange>>).strict(),
          })).min(1).max(MAX_SIZES),
        }).nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(async () => {
          await setProductSizeChart(actor, input.productId, input.chart as SizeChart | null);
          return { ok: true } as const;
        });
      }),

    /** How big it is for delivery, or null for unknown (3.4.14). */
    setSizeClass: protectedProcedure
      .input(z.object({ productId: rowId, sizeClass: z.enum(SIZE_CLASSES).nullable() }))
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
        id: rowId,
        images: z.array(z.object({
          /* An absolute http(s) URL, or a photo uploaded through NetLet, which
             is stored as its own path (3.3.4). Nothing else reaches an <img>. */
          url: z.string().trim().max(2000).refine(acceptableImageUrl, "Image URLs must start with http:// or https://"),
          altText: z.string().trim().max(255).nullable().optional(),
          kind: z.enum(["image", "video"]).optional(),
          /* Held to the same http(s) rule as the media URL beside it: a
             poster is fetched by the browser exactly as an image is. */
          posterUrl: z.string().trim().max(2000).refine(acceptableImageUrl, "Poster URLs must start with http:// or https://").nullable().optional(),
        })).max(12),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => setProductImages(actor, input.id, input.images));
      }),

    /**
     * The optional extras this product offers (3.1.2).
     *
     * The whole list at once, like the images: these are read as a set, and a
     * per-row endpoint turns reordering two of them into four calls.
     */
    /**
     * What is wrong with the listings waiting for review (3.6.2).
     *
     * Takes the ids the queue is already showing rather than running its own
     * query, so the triage is over the page an administrator has in front of
     * them — and the model pass is asked for separately, because it costs
     * money and a page of twenty would spend twenty calls on a scroll.
     */
    flags: protectedProcedure
      .input(z.object({ ids: z.array(rowId).max(100) }))
      .query(async ({ ctx, input }) => guard(async () =>
        reviewProducts(await resolveActor(ctx.user), input.ids))),

    /**
     * Whether the model pass can run at all (3.6.2).
     *
     * Asked once for the page, so the button is **absent** with no key rather
     * than present and answering "nothing found" — which would be a claim
     * about a question nobody asked. The same choice the shopper's assistant
     * makes with its whole panel.
     */
    modelReviewAvailable: protectedProcedure.query(async () => ({ available: await modelReviewAvailable() })),

    /**
     * A model's opinion on one listing, when a key is configured.
     *
     * One product at a time and only when asked, the same shape the shopper's
     * assistant uses: nothing is spent on somebody scrolling past.
     */
    modelFlag: protectedProcedure
      .input(z.object({ id: rowId }))
      .mutation(async ({ ctx, input }) => guard(async () => {
        const actor = await resolveActor(ctx.user);
        assertCan(actor, "product.review");
        const product = await getProduct(actor, input.id);
        if (!product) return { flag: null, available: await modelReviewAvailable() };
        return {
          available: await modelReviewAvailable(),
          flag: await modelConcernFor({ title: product.title, description: product.description }),
        };
      })),

    setAddons: protectedProcedure
      .input(z.object({
        id: rowId,
        addons: z.array(z.object({
          kind: z.enum(ADDON_KINDS),
          label: z.string().trim().min(1).max(160),
          labelAr: z.string().trim().max(160).nullable().optional(),
          price: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/),
        })).max(10),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => setProductAddons(actor, input.id, input.addons));
      }),

    /**
     * Commission for this product alone. Admin only, like the vendor rate —
     * an override a vendor could set would be that rule with a loophole.
     */
    setCommission: protectedProcedure
      .input(z.object({
        id: rowId,
        /* A percentage, not an amount. It was `moneySchema`, which allows
           nine integer digits: 50123456 overflowed `numeric(5, 2)` as a 500,
           and 500 was accepted outright. `commissionFor` clamps the cut to the
           line, so 500% does not go negative — it takes the whole line and
           pays the seller nothing, which is a rate nobody means to set. The
           store-level rate beside it already had a pattern of its own; now both
           use the same one. */
        percent: percentSchema.nullable().optional(),
        fixed: moneySchema.nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => setProductCommission(actor, input.id, { percent: input.percent, fixed: input.fixed }));
      }),

    setStatus: protectedProcedure
      .input(z.object({
        id: rowId,
        status: z.enum(["draft", "published", "archived"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => setProductStatus(actor, input.id, input.status));
      }),

    /** Admin only — the data layer refuses anyone else. */
    review: protectedProcedure
      .input(z.object({
        id: rowId,
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
        id: rowId.optional(),
        productId: rowId,
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
        /* What a member pays (4.1); null clears it. */
        memberPrice: moneySchema.nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => saveVariant(actor, input));
      }),

    adjustStock: protectedProcedure
      .input(z.object({
        variantId: rowId,
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
      variantId: rowId.optional(),
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
      vendorId: rowId.optional(),
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
      .input(z.object({ userId: rowId, isAdmin: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => setUserAdmin(actor, input.userId, input.isAdmin));
      }),

    addToVendor: protectedProcedure
      .input(z.object({
        vendorId: rowId,
        email: z.string().trim().email().max(320),
        role: z.enum(VENDOR_ROLES),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => addMemberByEmail(actor, input.vendorId, input.email, input.role));
      }),

    removeFromVendor: protectedProcedure
      .input(z.object({ vendorId: rowId, userId: rowId }))
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
        query: z.string().trim().max(160).optional(),
        status: z.enum(VENDOR_STATUSES).optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => listVendors(actor, input ?? {}));
      }),

    get: protectedProcedure
      .input(z.object({ vendorId: rowId }))
      .query(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => getVendor(actor, input.vendorId));
      }),

    setAutoPublish: protectedProcedure
      .input(z.object({ vendorId: rowId, autoPublish: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => setVendorAutoPublish(actor, input.vendorId, input.autoPublish));
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
        vendorId: rowId,
        name: z.string().trim().min(1).max(255).optional(),
        ...storeDetails,
      }))
      .mutation(async ({ ctx, input }) => {
        const { vendorId, ...patch } = input;
        const actor = await resolveActor(ctx.user);
        return guard(() => updateVendorProfile(actor, vendorId, patch));
      }),

    members: protectedProcedure
      .input(z.object({ vendorId: rowId }))
      .query(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user, input.vendorId);
        return guard(() => listMembers(actor, input.vendorId));
      }),

    setMemberRole: protectedProcedure
      .input(z.object({
        vendorId: rowId,
        userId: rowId,
        role: z.enum(VENDOR_ROLES),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user, input.vendorId);
        return guard(() => setMemberRole(actor, input.vendorId, input.userId, input.role));
      }),

    removeMember: protectedProcedure
      .input(z.object({ vendorId: rowId, userId: rowId }))
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
        vendorId: rowId,
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
        userId: rowId,
        locale: z.enum(["en", "ar"]).default("en"),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => sendMemberPasswordReset(actor, input.userId, input.locale));
      }),

    setBadges: protectedProcedure
      .input(z.object({
        vendorId: rowId,
        badges: z.array(z.enum(AWARDED_BADGES)).max(AWARDED_BADGES.length),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => setVendorBadges(actor, input.vendorId, input.badges));
      }),

    setCommission: protectedProcedure
      .input(z.object({
        vendorId: rowId,
        percent: percentSchema,
        fixed: moneySchema.nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => setVendorCommission(actor, input.vendorId, input.percent, input.fixed));
      }),

    setStatus: protectedProcedure
      .input(z.object({
        vendorId: rowId,
        status: z.enum(["pending", "approved", "suspended"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = await resolveActor(ctx.user);
        return guard(() => setVendorStatus(actor, input.vendorId, input.status));
      }),
  }),
});
