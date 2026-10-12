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
/** Longest answer it may give. */
export const MAX_HELP_ANSWER = 700;

/**
 * The page's answers as one block of text, in the asker's language, for the
 * model to answer from. `say` is the dictionary's own translate.
 */
export function helpBrief(say: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  return HELP_GROUPS.flatMap(group =>
    group.entries.map(entry => `Q: ${say(entry.question)}\nA: ${say(entry.answer, entry.params)}`),
  ).join("\n\n");
}

/** An answer cut to the ceiling at a sentence end where one is near, flattened to one paragraph. */
export function clipHelpAnswer(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_HELP_ANSWER) return flat;
  const cut = flat.slice(0, MAX_HELP_ANSWER);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("؟ "), cut.lastIndexOf("? "));
  return stop > MAX_HELP_ANSWER * 0.5 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
}
