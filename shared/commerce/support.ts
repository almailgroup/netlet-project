/**
 * Talking to NetLet itself (3.5.1, the chat leg of the contact centre).
 *
 * Pure and shared: what a conversation's state becomes after each act, and the
 * automatic first answer — both decide what a shopper is told, and both are
 * checkable without a database.
 *
 * ## The first answer is computed, not generated
 *
 * Most of what people write to a shop's support is a question the shop's own
 * records already answer: where is my order, can I still return this, how do I
 * pay, how do I get back into my account. So the moment a conversation opens,
 * NetLet answers from **the facts** — the order's lines and where each one is,
 * whether a return is still open on it, the cash-on-delivery rule, the reset
 * flow — and says plainly that the answer was automatic and that a person will
 * read the message anyway. Nothing here is a model's sentence: a wrong
 * automatic answer about somebody's money or parcel is worse than a slow human
 * one, and every fact it states is one the account page already shows.
 *
 * It is stored as message keys with parameters, never as English, so the same
 * answer reads in Arabic when the shopper switches language next week.
 *
 * ## Three states
 *
 * `open` is waiting for NetLet; `waiting` is waiting for the shopper; `resolved`
 * is done, by either side. A shopper writing again reopens it — a conversation
 * somebody is still typing into is not resolved, whatever a button said.
 */
import type { MessageKey } from "../i18n/dictionary.js";
import type { FulfilmentState } from "./fulfilment.js";

export const SUPPORT_TOPICS = ["order", "delivery", "return", "payment", "account", "other"] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export const SUPPORT_STATUSES = ["open", "waiting", "resolved"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** The longest one message may be. */
export const MAX_SUPPORT_MESSAGE = 2000;
/** How many unresolved conversations one shopper may have at once. */
export const MAX_OPEN_CONVERSATIONS = 5;
/** How many messages one shopper may send in an hour, across all of them. */
export const MAX_SUPPORT_MESSAGES_PER_HOUR = 30;

export type SupportEvent = "shopperWrote" | "staffWrote" | "resolved";

/** What a conversation's state becomes after something happens to it. */
export function nextStatus(current: SupportStatus, event: SupportEvent): SupportStatus {
  if (event === "resolved") return "resolved";
  if (event === "staffWrote") return "waiting";
  return "open";
}

/** What is wrong with a message, or null. Blank and too long are the two. */
export function messageProblem(body: string): "support.empty" | "support.tooLong" | null {
  const trimmed = body.trim();
  if (!trimmed) return "support.empty";
  if (trimmed.length > MAX_SUPPORT_MESSAGE) return "support.tooLong";
  return null;
}

/** One paragraph of an automatic answer: a message key and its parameters. */
export type AnswerPart = { key: MessageKey; params?: Record<string, string> };

/** What the automatic answer may know: the order the shopper chose, if any, and the policy. */
export type AnswerFacts = {
  order?: {
    reference: string;
    lines: { fulfilment: FulfilmentState; returnable: boolean }[];
    paymentMethod: string | null;
    paid: boolean;
  } | null;
  returnWindowDays: number;
};

/** The automatic first answer for a topic, from the facts and nothing else. */
export function firstAnswer(topic: SupportTopic, facts: AnswerFacts): AnswerPart[] {
  const parts: AnswerPart[] = [];
  const order = facts.order ?? null;

  if ((topic === "order" || topic === "delivery") && order) {
    const count = (states: FulfilmentState[]) => order.lines.filter(line => states.includes(line.fulfilment)).length;
    parts.push({
      key: "support.answerOrderStatus",
      params: {
        reference: order.reference,
        preparing: String(count(["pending", "preparing"])),
        onTheWay: String(count(["shipped"])),
        delivered: String(count(["delivered"])),
      },
    });
    if (count(["shipped"]) > 0) parts.push({ key: "support.answerTrack" });
    if (count(["cancelled"]) > 0) parts.push({ key: "support.answerCancelled", params: { count: String(count(["cancelled"])) } });
  } else if (topic === "order" || topic === "delivery") {
    parts.push({ key: "support.answerChooseOrder" });
  }

  if (topic === "return") {
    if (order && order.lines.some(line => line.returnable)) {
      parts.push({ key: "support.answerReturnOpen", params: { reference: order.reference } });
    } else if (order) {
      parts.push({ key: "support.answerReturnClosed", params: { reference: order.reference, days: String(facts.returnWindowDays) } });
    } else {
      parts.push({ key: "support.answerReturnPolicy", params: { days: String(facts.returnWindowDays) } });
    }
  }

  if (topic === "payment") {
    parts.push({ key: "support.answerPayment" });
    if (order && order.paymentMethod === "cod") {
      parts.push({ key: order.paid ? "support.answerPaid" : "support.answerUnpaid", params: { reference: order.reference } });
    }
  }

  if (topic === "account") parts.push({ key: "support.answerAccount" });

  /* Always: this was automatic, and a person will still read it. */
  parts.push({ key: "support.answerPerson" });
  return parts;
}

/* ---------------------------------------------------------- other legs --- */

/**
 * NetLet's own number as a channel needs it: international digits only, or
 * null when what was configured is not one. At least ten digits, because a
 * local number with no country code — "5000 1234" — opens a chat with nobody;
 * a leading + or 00 and the spaces people type are dropped.
 */
export function supportNumber(raw: string): string | null {
  const digits = raw.trim().replace(/^(\+|00)/, "").replace(/[\s\-()]/g, "");
  return /^[1-9]\d{9,14}$/.test(digits) ? digits : null;
}

/**
 * A WhatsApp chat with NetLet (3.5.1), opened with the order reference already
 * written so whoever answers can look it up. Nothing else about the shopper
 * goes into the message: they are about to send it from their own phone, and
 * what they add is theirs to add.
 */
export function whatsappLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export function phoneLink(number: string): string {
  return `tel:+${number}`;
}
