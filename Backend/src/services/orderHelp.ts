/**
 * "Get help with this order", the server half: the order's facts for the
 * model, a ceiling per account, and the answer read back
 * (`Shared/commerce/orderHelp.ts` is the rule).
 *
 * The facts are recomputed here from the order as it stands — never sent by
 * the page — and carry nothing about the shopper beyond what they bought. A
 * model that does not answer is "unavailable", which the page turns straight
 * into the hand-off to a person, so the shopper is never left with nothing.
 */
import { inArray } from "drizzle-orm";
import { returnRequests } from "../../database/schema.js";
import { shopperCancelState } from "../../../Shared/commerce/orderCancel.js";
import { addressChangeState, shopperChangeState } from "../../../Shared/commerce/orderChanges.js";
import {
  MAX_ORDER_HELP_PER_HOUR,
  orderHelpPieces,
  orderHelpProblem,
  orderHelpPrompt,
  orderHelpSystem,
  type OrderHelpAction,
  type OrderHelpTurn,
} from "../../../Shared/commerce/orderHelp.js";
import { blocksNewReturn } from "../../../Shared/commerce/returnRequests.js";
import { returnStateFor } from "../../../Shared/commerce/returns.js";
import { eligibilityFor } from "../../../Shared/commerce/reviews.js";
import { gatewayAvailable } from "./aiGateway.js";
import { getDb } from "./db.js";
import { featureOn } from "./features.js";
import { askModel } from "./gemini.js";
import { getOrderForUser } from "./orders.js";
import { takeHourlyAllowance } from "./rateLimit.js";
import { myReviewsForLines } from "./reviews.js";
import { returnWindowDays } from "./settings.js";
import { warrantyStateForLines } from "./warranty.js";

/** How a line's state is put to the model. */
const STATE: Record<string, string> = {
  pending: "received by the store, not yet being prepared",
  preparing: "being prepared by the store",
  shipped: "collected by the driver, on the way",
  delivered: "delivered",
  cancelled: "cancelled",
  returned: "returned",
};

/** Whether the panel may answer at all: the gateway, `ai` and the shop's conversations switched on. */
export async function orderHelpAvailable(): Promise<boolean> {
  return (await gatewayAvailable()) && (await featureOn("assistant"));
}

export type OrderHelpAnswer =
  | { kind: "answer"; text: string; actions: OrderHelpAction[]; person: boolean }
  | { kind: "unavailable" }
  | { kind: "tooMany" }
  | { kind: "refused"; reason: string };

/** What the order offers the shopper now — the only buttons the model may point at. */
async function actionsFor(found: NonNullable<Awaited<ReturnType<typeof getOrderForUser>>>, windowDays: number, now: Date): Promise<OrderHelpAction[]> {
  const { order, lines } = found;
  const actions: OrderHelpAction[] = [];
  if (order.status !== "cancelled") actions.push("track");
  const db = await getDb();
  const requests = db && lines.length
    ? await db.select({ orderItemId: returnRequests.orderItemId, status: returnRequests.status }).from(returnRequests).where(inArray(returnRequests.orderItemId, lines.map(line => line.id)))
    : [];
  const held = new Set(requests.filter(request => blocksNewReturn(request.status)).map(request => request.orderItemId));
  if ((await featureOn("returns")) && lines.some(line => !held.has(line.id) && returnStateFor(order, line, now, windowDays).returnable)) actions.push("refund");
  const warranty = await warrantyStateForLines(lines);
  if ([...warranty.values()].some(state => state.eligibility.allowed)) actions.push("warranty");
  if (shopperCancelState(order, lines).cancellable) actions.push("cancel");
  if (shopperChangeState(order, lines).changeable && lines.some(line => line.bundleId === null && (line.fulfilment === "pending" || line.fulfilment === "preparing"))) actions.push("modify");
  if (addressChangeState(order, lines).changeable) actions.push("address");
  if (lines.some(line => line.variantId !== null)) actions.push("buyAgain");
  const reviewed = await myReviewsForLines(order.userId ?? 0, lines.map(line => line.id));
  if (lines.some(line => eligibilityFor({ orderStatus: order.status, deliveredAt: line.deliveredAt, reviewed: reviewed.has(line.id) }).allowed)) actions.push("rate");
  return actions;
}

/** One answer about one of the shopper's own orders. */
export async function askAboutOrder(
  userId: number,
  input: { reference: string; turns: OrderHelpTurn[]; locale: "en" | "ar" },
  now = new Date(),
): Promise<OrderHelpAnswer> {
  const last = [...input.turns].reverse().find(turn => turn.role === "shopper");
  if (!last) return { kind: "refused", reason: "orderHelp.empty" };
  const problem = orderHelpProblem(last.text);
  if (problem) return { kind: "refused", reason: problem };

  const found = await getOrderForUser(userId, input.reference);
  if (!found) return { kind: "refused", reason: "orders.detailMissing" };
  if (!(await orderHelpAvailable())) return { kind: "unavailable" };
  if (!(await takeHourlyAllowance(userId, "orderHelp", MAX_ORDER_HELP_PER_HOUR))) return { kind: "tooMany" };

  const windowDays = await returnWindowDays();
  const actions = await actionsFor(found, windowDays, now);
  const system = orderHelpSystem(
    {
      placedAt: found.order.placedAt.toISOString(),
      paid: found.order.status === "paid",
      owed: found.owed?.owed ?? found.order.grandTotal,
      currency: found.order.currency,
      lines: found.lines.map(line => {
        const state = returnStateFor(found.order, line, now, windowDays);
        return {
          title: line.productTitle,
          quantity: line.quantity,
          state: STATE[line.fulfilment] ?? line.fulfilment,
          deliveredAt: line.deliveredAt ? line.deliveredAt.toISOString() : null,
          returnable: state.returnable,
          returnDaysLeft: state.returnable ? state.daysLeft : null,
        };
      }),
      actions,
      returnWindowDays: windowDays,
    },
    input.locale,
  );

  /* Earlier turns are kept only if they too are clean — a shopper's words are
     never forwarded with contact details in them. */
  const turns = input.turns.filter(turn => turn.role === "assistant" || orderHelpProblem(turn.text) === null);
  const text = await askModel("orderHelp", {
    system,
    prompt: orderHelpPrompt(turns),
    json: false,
    temperature: 0.2,
    maxOutputTokens: 400,
    deadlineMs: 12_000,
  });
  if (!text) return { kind: "unavailable" };
  const read = orderHelpPieces(text, actions);
  if (!read.text) return { kind: "unavailable" };
  return { kind: "answer", ...read };
}
