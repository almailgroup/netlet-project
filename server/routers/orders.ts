/**
 * A shopper's own orders and returns.
 *
 * `server/orders.ts` has had `listOrdersForUser` and `getOrderForUser` since
 * the orders tables landed, and nothing could call them: there was no router,
 * so the account page had no way to ask. This is that missing half.
 *
 * Every procedure is `protectedProcedure` and every query is scoped by
 * `ctx.user.id` inside the data layer rather than filtered here. An order id is
 * a serial and a reference is guessable enough to try, so "show me order 4"
 * must not be a way to read somebody else's purchase — and a scope applied in
 * the router is one a second caller added later skips silently, which is the
 * same argument that puts the inventory guards next to their queries.
 */
import { z } from "zod";
import { getOrderForUser, listOrdersForUser } from "../orders.js";
import { protectedProcedure, router } from "../_core/trpc.js";
import { returnStateFor, RETURN_WINDOW_DAYS } from "../../shared/commerce/returns.js";

export const ordersRouter = router({
  /**
   * The shopper's orders, newest first and paged.
   *
   * Paged from the start rather than when somebody complains: this is the one
   * list on the site that only grows, and an unbounded query over a decade of
   * orders is the admin lists' ceiling problem with a longer fuse.
   */
  list: protectedProcedure
    .input(z.object({ page: z.number().int().min(1).optional(), pageSize: z.number().int().min(1).max(100).optional() }).optional())
    .query(({ ctx, input }) => listOrdersForUser(ctx.user.id, input ?? {})),

  /**
   * One order with its lines, and what each line's return looks like.
   *
   * The return state is resolved here rather than on the client for the reason
   * the password floor is: `returnStateFor` is the same function both sides
   * import, so a page cannot offer a return the API would refuse. Sending the
   * decision rather than the ingredients also means the clock is the server's,
   * and a shopper cannot reopen a closed window by changing their system date.
   */
  get: protectedProcedure
    .input(z.object({ reference: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const found = await getOrderForUser(ctx.user.id, input.reference);
      if (!found) return null;

      const now = new Date();
      return {
        order: found.order,
        windowDays: RETURN_WINDOW_DAYS,
        lines: found.lines.map(line => ({
          ...line,
          /*
           * `order_items` has no `delivered_at`, so `updatedAt` stands in. It
           * is wrong in one direction — a vendor editing the line pushes the
           * window out rather than shortening it — which is the safe direction
           * to be wrong in while the column is missing, and it is one line to
           * change when it lands. Only a delivered line is asked, so an edit
           * to a line still in the warehouse costs nothing.
           */
          returnState: returnStateFor(
            found.order,
            { fulfilment: line.fulfilment, deliveredAt: line.fulfilment === "delivered" ? line.updatedAt : null },
            now,
          ),
        })),
      };
    }),
});
