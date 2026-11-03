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
import {
  MAX_ORDER_HELP_PER_HOUR,
  orderHelpPieces,
  orderHelpProblem,
  orderHelpPrompt,
  orderHelpSystem,
  type OrderHelpAction,
  type OrderHelpTurn,
} from "../../../Shared/commerce/orderHelp.js";
import type { HelpIssue, HelpOffer, IssueFacts } from "../../../Shared/commerce/selfService.js";
import { gatewayAvailable } from "./aiGateway.js";
import { featureOn } from "./features.js";
import { askModel } from "./gemini.js";
import { orderDetailForShopper } from "./orderDetail.js";
import { takeHourlyAllowance } from "./rateLimit.js";
import { issueFactsFrom } from "./selfHelp.js";

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
  | { kind: "answer"; text: string; actions: OrderHelpAction[]; offers: HelpOffer[]; person: boolean }
  | { kind: "unavailable" }
  | { kind: "tooMany" }
  | { kind: "refused"; reason: string };

/**
 * What the order offers the shopper now — the only buttons the model may
 * point at, read off the self-service facts so the help centre and this
 * panel offer the same.
 */
export function actionsFor(facts: IssueFacts): OrderHelpAction[] {
  const actions: OrderHelpAction[] = [];
  if (!facts.cancelled) actions.push("track");
  if (facts.lines.some(line => line.returnable)) actions.push("refund");
  if (facts.lines.some(line => line.warranty)) actions.push("warranty");
  if (facts.cancellable) actions.push("cancel");
  if (facts.lines.some(line => line.changeable)) actions.push("modify");
  if (facts.addressChangeable) actions.push("address");
  if (facts.lines.some(line => line.rebuyable)) actions.push("buyAgain");
  if (facts.lines.some(line => line.reviewable)) actions.push("rate");
  return actions;
}

/** One answer about one of the shopper's own orders. */
export async function askAboutOrder(
  userId: number,
  input: { reference: string; turns: OrderHelpTurn[]; locale: "en" | "ar"; issue?: HelpIssue | null; lineId?: number | null },
): Promise<OrderHelpAnswer> {
  const last = [...input.turns].reverse().find(turn => turn.role === "shopper");
  if (!last) return { kind: "refused", reason: "orderHelp.empty" };
  const problem = orderHelpProblem(last.text);
  if (problem) return { kind: "refused", reason: problem };

  const detail = await orderDetailForShopper(userId, input.reference);
  if (!detail) return { kind: "refused", reason: "orders.detailMissing" };
  if (!(await orderHelpAvailable())) return { kind: "unavailable" };
  if (!(await takeHourlyAllowance(userId, "orderHelp", MAX_ORDER_HELP_PER_HOUR))) return { kind: "tooMany" };

  const facts = issueFactsFrom(detail, await featureOn("returns"));
  const actions = actionsFor(facts);
  const lineIndex = input.lineId ? detail.lines.findIndex(line => line.id === input.lineId) : -1;
  const system = orderHelpSystem(
    {
      placedAt: new Date(detail.order.placedAt).toISOString(),
      paid: detail.order.status === "paid",
      owed: detail.owedNow,
      currency: detail.order.currency,
      lines: detail.lines.map((line, index) => ({
        title: line.productTitle,
        quantity: line.quantity,
        state: STATE[line.fulfilment] ?? line.fulfilment,
        deliveredAt: line.deliveredAt ? new Date(line.deliveredAt).toISOString() : null,
        returnable: facts.lines[index].returnable,
        returnDaysLeft: line.returnState.returnable ? line.returnState.daysLeft : null,
        changeable: facts.lines[index].changeable,
        warranty: facts.lines[index].warranty,
      })),
      actions,
      returnWindowDays: detail.windowDays,
      focus: { issue: input.issue ?? null, item: lineIndex >= 0 ? lineIndex + 1 : null },
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
  const read = orderHelpPieces(text, actions, facts);
  if (!read.text) return { kind: "unavailable" };
  return { kind: "answer", ...read };
}
