/**
 * Wishlists, and the one public door in the storefront that answers a question
 * about somebody else.
 *
 * Every owner procedure is `protectedProcedure` and every query is scoped by
 * `ctx.user.id` inside `server/wishlists.ts` rather than filtered here — a list
 * id is a serial, short enough to type, so "show me list 4" has to be refused
 * by the query and not by a check a later caller can skip.
 *
 * The lookup is the interesting half. It is `publicProcedure` because the
 * whole point is that an aunt with no NetLet account can use it, and that
 * makes it the one endpoint where a stranger hands us an identifier for
 * another person and gets an answer. Three things hold it together, and they
 * are all deliberate:
 *
 * **It is throttled in Postgres, counting every request rather than every
 * failure.** There is no such thing as a failed lookup here — the reply is the
 * same for a number with no account and a number whose owner publishes
 * nothing — so a failure-counting throttle would count nothing at all. The
 * ceiling is `MAX_LOOKUPS_PER_ADDRESS` over an hour, which is far more than a
 * family needs and far too few to walk an eight-digit number space.
 *
 * **The reply is identical for "nobody" and "nothing published".** Both are an
 * empty array. Distinguishing them turns the lookup into a way to ask which
 * phone numbers shop at NetLet — the same reason sign-in and password reset
 * answer an unknown address exactly as they answer a known one.
 *
 * **A throttled caller is told to wait, never given a result.** Same as
 * sign-in: behaving differently when the answer would have been interesting is
 * what makes a throttle into an oracle.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { rowId } from "../_core/schemas.js";
import {
  addItem,
  claimItem,
  createList,
  deleteList,
  itemsForOwner,
  listMine,
  phoneFor,
  publicListByToken,
  publicListsByPhone,
  releaseClaim,
  removeItem,
  setPhone,
  shareTokenFor,
  updateList,
  WishlistError,
} from "../wishlists.js";
import { checkLookupAllowed, recordLookup } from "../rateLimit.js";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc.js";
import {
  MAX_ITEMS_PER_LIST,
  VISIBILITIES,
  normalisePhone,
} from "../../Shared/commerce/wishlist.js";

/** A refusal code becomes a 4xx with a message key the page translates. */
function asTrpcError(error: unknown): never {
  if (error instanceof WishlistError) {
    throw new TRPCError({
      code: error.reason === "notFound" ? "NOT_FOUND" : "BAD_REQUEST",
      message: `wishlist.${error.reason}`,
    });
  }
  throw error;
}

const guard = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    asTrpcError(error);
  }
};

const listId = z.object({ listId: rowId });

/**
 * The phone number as typed, refined by the *same* function the server
 * normalises with.
 *
 * `normalisePhone` on both sides, so the form cannot offer a number the API
 * would refuse — the argument the password floor makes, applied to a field
 * where the failure is quieter: a number the client accepts and the server
 * cannot key would simply never find anybody.
 */
const phoneInput = z.string().min(1).max(32).refine(value => normalisePhone(value) !== null, {
  message: "wishlist.phoneInvalid",
});

export const wishlistsRouter = router({
  /* ------------------------------------------------------------ owner --- */

  mine: protectedProcedure.query(({ ctx }) => listMine(ctx.user.id)),

  get: protectedProcedure
    .input(listId)
    .query(({ ctx, input }) => guard(() => itemsForOwner(ctx.user.id, input.listId))),

  /**
   * The share link, asked for separately from the list itself.
   *
   * A token is a capability: it belongs on the screen where somebody pressed
   * Share, not in the payload of every page that happens to render their
   * wishlists. Null for a list that is not published, because there is nothing
   * to share yet and handing back a live token for a private list is how one
   * ends up in a group chat before its owner has decided.
   */
  shareLink: protectedProcedure
    .input(listId)
    .query(({ ctx, input }) => guard(() => shareTokenFor(ctx.user.id, input.listId))),

  create: protectedProcedure
    .input(z.object({ title: z.string().trim().min(1).max(120) }))
    .mutation(({ ctx, input }) => guard(() => createList(ctx.user.id, input.title))),

  update: protectedProcedure
    .input(listId.extend({
      title: z.string().trim().min(1).max(120).optional(),
      visibility: z.enum(VISIBILITIES).optional(),
      /** Empty string clears it, so the page can say "This list" instead. */
      ownerName: z.string().trim().max(120).nullable().optional(),
    }))
    .mutation(({ ctx, input }) => guard(() => {
      const { listId: id, ...patch } = input;
      return updateList(ctx.user.id, id, { ...patch, ownerName: patch.ownerName === "" ? null : patch.ownerName });
    })),

  remove: protectedProcedure
    .input(listId)
    .mutation(({ ctx, input }) => guard(() => deleteList(ctx.user.id, input.listId))),

  addItem: protectedProcedure
    .input(listId.extend({
      productId: z.string().min(1).max(191),
      note: z.string().trim().max(280).nullable().optional(),
      quantity: z.number().int().min(1).max(MAX_ITEMS_PER_LIST).optional(),
    }))
    .mutation(({ ctx, input }) => guard(() => {
      const { listId: id, ...item } = input;
      return addItem(ctx.user.id, id, item);
    })),

  removeItem: protectedProcedure
    .input(listId.extend({ itemId: rowId }))
    .mutation(({ ctx, input }) => guard(() => removeItem(ctx.user.id, input.listId, input.itemId))),

  /* ------------------------------------------------------------ phone --- */

  phone: protectedProcedure.query(({ ctx }) => phoneFor(ctx.user.id)),

  setPhone: protectedProcedure
    .input(z.object({ phone: phoneInput.nullable() }))
    .mutation(({ ctx, input }) => guard(() => setPhone(ctx.user.id, input.phone))),

  /* ----------------------------------------------------------- public --- */

  /**
   * Find somebody's published lists by their phone number.
   *
   * Public on purpose: a relative buying a gift has no reason to hold a NetLet
   * account, and requiring one would make the feature a registration wall with
   * a wishlist behind it.
   *
   * The throttle is checked *and recorded* before anything is read, so a
   * caller cannot spend a lookup only when it finds something — which would
   * make the counter itself an oracle for whether the number was interesting.
   */
  findByPhone: publicProcedure
    .input(z.object({ phone: phoneInput }))
    .query(async ({ ctx, input }) => {
      const address = ctx.req.ip ?? null;

      const verdict = await checkLookupAllowed(address);
      if (!verdict.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "wishlist.tooManyLookups",
          cause: { retryAfterSeconds: verdict.retryAfterSeconds },
        });
      }
      await recordLookup(address);

      // An empty array for a number nobody has, and for a number whose owner
      // publishes nothing. One answer, so the lookup cannot be used to ask
      // who shops here.
      return publicListsByPhone(input.phone, ctx.user?.id ?? null);
    }),

  /** One published list from a pasted link. Not throttled: a token is not guessable. */
  byToken: publicProcedure
    .input(z.object({ token: z.string().min(8).max(64) }))
    .query(({ ctx, input }) => publicListByToken(input.token, ctx.user?.id ?? null)),

  /**
   * "I am getting this one."
   *
   * Public, because a giver need not have an account — the token is the
   * capability. When they do happen to be signed in the claim is recorded
   * against them, which is the only thing that later lets them release it.
   */
  claim: publicProcedure
    .input(z.object({ token: z.string().min(8).max(64), productId: z.string().min(1).max(191) }))
    .mutation(({ ctx, input }) => guard(() => claimItem(input.token, input.productId, ctx.user?.id ?? null))),

  /** Let go of a claim. Signed in only; see `releaseClaim`. */
  release: protectedProcedure
    .input(z.object({ token: z.string().min(8).max(64), productId: z.string().min(1).max(191) }))
    .mutation(({ ctx, input }) => guard(() => releaseClaim(input.token, input.productId, ctx.user.id))),
});
