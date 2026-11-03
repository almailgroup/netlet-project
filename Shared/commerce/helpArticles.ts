/**
 * The help page's answers, and the brief the help assistant is given.
 *
 * Message keys rather than prose, so both languages say the same thing, and
 * every answer is a rule the shop applies — the return window is
 * `RETURN_WINDOW_DAYS`, the payment is the one method checkout offers — so the
 * page cannot promise what the API refuses. The assistant is handed exactly
 * these answers and nothing else (`helpBrief`), so it cannot know more than
 * the page does, and nothing about the shopper reaches it.
 */
import type { MessageKey } from "../i18n/dictionary.js";
import { RETURN_WINDOW_DAYS } from "./returns.js";

export type HelpEntry = {
  id: string;
  question: MessageKey;
  answer: MessageKey;
  params?: Record<string, string | number>;
  /** Where the answer is acted on, when there is a page for it. */
  link?: { href: string; label: MessageKey };
};

export const HELP_GROUPS: { id: string; title: MessageKey; entries: HelpEntry[] }[] = [
  {
    id: "orders",
    title: "help.groupOrders",
    entries: [
      { id: "pay", question: "help.q.pay", answer: "help.a.pay" },
      { id: "where", question: "help.q.where", answer: "help.a.where", link: { href: "/account/orders", label: "help.lookupOpenOrders" } },
    ],
  },
  {
    id: "delivery",
    title: "help.groupDelivery",
    entries: [
      { id: "deliveryCost", question: "help.q.deliveryCost", answer: "help.a.deliveryCost" },
      { id: "deliveryWhen", question: "help.q.deliveryWhen", answer: "help.a.deliveryWhen" },
      { id: "areas", question: "help.q.areas", answer: "help.a.areas" },
    ],
  },
  {
    id: "returns",
    title: "help.groupReturns",
    entries: [
      { id: "returns", question: "help.q.returns", answer: "help.a.returns", params: { days: RETURN_WINDOW_DAYS }, link: { href: "/returns", label: "returnsPage.title" } },
      { id: "refund", question: "help.q.refund", answer: "help.a.refund" },
    ],
  },
  {
    id: "account",
    title: "help.groupAccount",
    entries: [
      { id: "password", question: "help.q.password", answer: "help.a.password" },
      { id: "language", question: "help.q.language", answer: "help.a.language" },
    ],
  },
  {
    id: "selling",
    title: "help.groupSelling",
    entries: [
      { id: "sell", question: "help.q.sell", answer: "help.a.sell", link: { href: "/sell", label: "footer.sellWithUs" } },
    ],
  },
];

/** Longest question the assistant is sent. */
export const MAX_HELP_QUESTION = 300;

/** The shop's own figures an answer quotes — the return window an administrator sets. */
export type HelpPolicy = { returnWindowDays: number };

/**
 * An answer's parameters with the shop's current figures in them: the return
 * window is an administrator's setting (`returns.windowDays`), so the help
 * page and the assistant quote today's figure rather than the code's default.
 */
export function helpParams(entry: HelpEntry, policy?: HelpPolicy): Record<string, string | number> | undefined {
  if (!entry.params || !policy || !("days" in entry.params)) return entry.params;
  return { ...entry.params, days: policy.returnWindowDays };
}

/**
 * The page's answers as one block of text, in the asker's language, for the
 * model to answer from. `say` is the dictionary's own translate.
 */
export function helpBrief(say: (key: MessageKey, params?: Record<string, string | number>) => string, policy?: HelpPolicy): string {
  return HELP_GROUPS.flatMap(group =>
    group.entries.map(entry => `Q: ${say(entry.question)}\nA: ${say(entry.answer, helpParams(entry, policy))}`),
  ).join("\n\n");
}
