import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '../../shared/const.js';
import { initTRPC, TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import superjson from "superjson";
import type { TrpcContext } from "./context.js";
import { rootCauseOf } from "./describeError.js";
import { featureForEntry } from "../../shared/features.js";
import { featureOn } from "../features.js";
import { isMessageKey } from "../../shared/i18n/dictionary.js";

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
    if (error.code === "BAD_REQUEST" && error.cause instanceof ZodError) {
      return { ...shape, message: inputRefusal(error.cause) };
    }
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

/**
 * What an input the schema refused says.
 *
 * tRPC's message for one is zod's whole list of issues as JSON, and every page
 * put that in a toast — a wall of brackets and paths where a sentence belongs,
 * in English on the Arabic page. Where a schema was given a message key of its
 * own (`admin.invalidPhone`, `sell.badLink`) the first one is the answer, since
 * it names the field; otherwise a sentence that something in the form is not
 * right. The page's own checks catch nearly all of these first, so this is
 * what a value typed past them meets.
 */
export function inputRefusal(error: ZodError): string {
  return error.issues.find(issue => isMessageKey(issue.message))?.message ?? "error.invalidInput";
}

export const router = t.router;

/**
 * Whether any string anywhere in an input carries a NUL character.
 *
 * Keys as well as values, and bounded in depth so a hostile nesting cannot make
 * the walk itself the problem.
 */
export function carriesNul(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return value.includes("\u0000");
  if (depth > 32 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(item => carriesNul(item, depth + 1));
  return Object.entries(value).some(([key, item]) => key.includes("\u0000") || carriesNul(item, depth + 1));
}

/**
 * Refuses a NUL character before any procedure sees it.
 *
 * Postgres `text` cannot hold one, so a NUL in any string — a search box, a
 * product title, a cart id, a review — went through every zod check this API
 * has and then failed inside the driver with "invalid byte sequence for
 * encoding UTF8: 0x00": a 500, and a raw database sentence where a message key
 * belongs, for something anybody can send by hand. A fuzz of every procedure
 * found it in twenty-nine of them at once.
 *
 * One refusal here rather than a `.refine` on every string field, because the
 * rule is about the database, not about any one field, and a field added next
 * month would not have it. Refused rather than stripped: no human types a NUL,
 * so whatever sent one is not a person whose text should be quietly edited.
 */
const refuseNul = t.middleware(async ({ getRawInput, next }) => {
  if (carriesNul(await getRawInput())) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "error.invalidText" });
  }
  return next();
});

/**
 * Refuses starting something under a feature that is switched off (2.3).
 *
 * By path, from the one list in `shared/features.ts`, on the base procedure —
 * so a router cannot forget it and a procedure renamed out from under its
 * switch fails `server/features.test.ts` rather than going quietly unguarded.
 * Only an entry path costs a read; browsing never does.
 *
 * `PRECONDITION_FAILED`, not `FORBIDDEN`: nobody lacks permission, the shop
 * has the thing turned off, and the page says so in those words.
 */
const refuseSwitchedOff = t.middleware(async ({ path, next }) => {
  const feature = featureForEntry(path);
  if (feature && !(await featureOn(feature))) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "features.off" });
  }
  return next();
});

/** Every procedure starts here, so every procedure refuses a NUL and a switched-off entry. */
const base = t.procedure.use(refuseNul).use(refuseSwitchedOff);

export const publicProcedure = base;

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

export const protectedProcedure = base.use(requireUser);

export const adminProcedure = base.use(
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
