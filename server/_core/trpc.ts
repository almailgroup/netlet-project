import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '../../shared/const.js';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context.js";
import { rootCauseOf } from "./describeError.js";

/**
 * What a failure says, and to whom.
 *
 * Two things were wrong with the default, and a broken deployment showed both
 * at once: the storefront's home page printed a full `select "products"."id",
 * … from "products" inner join "vendors" …` at a shopper, and it still did not
 * say *which* column was missing.
 *
 * **Drizzle's message is the wrapper, not the reason.** It reads "Failed
 * query: select …" and hangs the real cause — `column products.size_class does
 * not exist` — on `cause`. Sending the outermost message is therefore the
 * worst of both: unreadable to a shopper and useless to whoever has to fix it.
 * The same lesson `describeError` was written for, and the same one the
 * wishlist's duplicate-key handling learned: the answer is always one level
 * down.
 *
 * **Only an administrator is shown it.** A database's own words tell them to
 * run the migration, which is the difference between a fix and a guess — that
 * is the rule `QueryGate` already states. A shopper has nothing to do with the
 * answer, and a merchant is not NetLet staff, so both get a sentence they can
 * act on ("try again") while the whole chain goes to the server log, which
 * `app.ts` was already writing.
 *
 * Only `INTERNAL_SERVER_ERROR` is touched. Every refusal this codebase raises
 * deliberately — `bundle.notYours`, `dispatch.badMove`, `order.outOfStock` —
 * is a `BAD_REQUEST` or a `FORBIDDEN` carrying a message key the page
 * translates, and rewriting those would throw away the only thing they say.
 */
const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error, ctx }) {
    if (error.code !== "INTERNAL_SERVER_ERROR") return shape;
    const forAdmin = ctx?.user?.role === "admin";
    if (forAdmin) return { ...shape, message: rootCauseOf(error) };
    /*
     * The stack goes with it. tRPC omits it in production anyway, so this
     * matters for a preview build and for anything run with NODE_ENV unset —
     * and "it does not happen in production" is the assumption that put a
     * `select … from "products"` in front of a shopper in the first place.
     */
    const { stack: _stack, ...data } = shape.data as Record<string, unknown>;
    return { ...shape, message: "error.serverProblem", data };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
