/**
 * The help centre's self-service (on the owner's word: "the AI assistant
 * should understand customer issues and provide immediate solutions … perform
 * authorized actions directly after receiving customer confirmation … support
 * should be the last resort, but easily accessible").
 *
 * Pure and shared: the eight issues a shopper can name, what each one offers
 * for an order as it stands, which offers are allowed, and what a person is
 * handed when it goes to them. The server builds the facts from the order and
 * answers with the resolution; the web and the app draw it. Nothing here
 * decides money by itself: an offer is something the shopper may confirm, and
 * every act it leads to asks its own rule again under a lock when pressed.
 *
 * ## An answer is said, then offered, then done on a press
 *
 * A resolution is a few sentences (message keys, so they read in either
 * language), the acts that would settle it, and whether a person is the next
 * step or only there if this did not help. An act is one of two shapes:
 *
 * - **done on the press, after a confirmation** — a return or an exchange of
 *   one item for a stated reason, cancelling the order or one item before a
 *   driver has it, buying again. Each is one call the API already has, asked
 *   with the same input its own form sends.
 * - **opened, filled in** — tracking, a warranty claim (it needs the words
 *   and the photos), another address, a quantity, a rating, a return for a
 *   reason only words can give. The panel opens on the item.
 *
 * ## A person is handed everything
 *
 * "All relevant order details, issue descriptions, and previous actions
 * should automatically be transferred to the support team. Customers should
 * not have to repeat themselves." `handoverParts` is what the person reads
 * first: the issue, the item, and what was already done, as message keys; the
 * shopper's own words and what NetLet AI said follow as their message.
 */
import type { FulfilmentState } from "./fulfilment.js";
import type { TrackPromise } from "./orderTracking.js";
import { isOpenReturn, RETURN_KINDS, RETURN_REASONS, type ReturnKind, type ReturnReason } from "./returnRequests.js";
import type { AnswerPart, SupportTopic } from "./support.js";

export const HELP_ISSUES = ["late", "damaged", "wrong", "return", "exchange", "warranty", "payment", "account"] as const;
export type HelpIssue = (typeof HELP_ISSUES)[number];

/** Issues about one item: the page asks which before answering. */
export const ITEM_ISSUES: readonly HelpIssue[] = ["damaged", "wrong", "return", "exchange", "warranty"];

/** What an issue needs before it can be answered. */
export function issueNeeds(issue: HelpIssue): "item" | "order" | "nothing" {
  if (issue === "account") return "nothing";
  return ITEM_ISSUES.includes(issue) ? "item" : "order";
}

/** Where a conversation about an issue is filed on NetLet's desk. */
export function topicFor(issue: HelpIssue | null | undefined): SupportTopic {
  if (!issue) return "order";
  if (issue === "late") return "delivery";
  if (issue === "payment") return "payment";
  if (issue === "account") return "account";
  return "return";
}

/** Panels the page opens on an item, filled in. */
export const HELP_PANELS = ["track", "refund", "returnForm", "warranty", "address", "modify", "rate"] as const;
export type HelpPanel = (typeof HELP_PANELS)[number];

/**
 * Account pages an answer can send a shopper to. Account security went into
 * "Your profile", on the owner's word, so the password and deleting the
 * account are `profile` now.
 */
export const HELP_PAGES = ["profile", "notifications", "addresses", "returns"] as const;
export type HelpPage = (typeof HELP_PAGES)[number];

/** Reasons an exchange makes sense for: the same item again fixes a fault, never a size. */
export const EXCHANGE_REASONS: readonly ReturnReason[] = ["damaged", "defective", "wrongItem", "notAsDescribed"];
/** Reasons a quick return may be confirmed with; "other" needs words, so it opens the form. */
export const QUICK_RETURN_REASONS: readonly ReturnReason[] = RETURN_REASONS.filter(reason => reason !== "other");

export type HelpOffer =
  /** A return of one item, done on the press with the kind and reason chosen from these. */
  | { kind: "return"; lineId: number; returnKinds: ReturnKind[]; reasons: ReturnReason[] }
  | { kind: "cancelOrder" }
  | { kind: "cancelItem"; lineId: number }
  | { kind: "buyAgain"; lineId: number | null }
  | { kind: "open"; panel: HelpPanel; lineId: number | null }
  | { kind: "page"; to: HelpPage };

export type HelpResolution = {
  say: AnswerPart[];
  offers: HelpOffer[];
  /** "next": a person is the next step; "offer": a person is there if this did not settle it. */
  person: "next" | "offer";
};

export type IssueLine = {
  id: number;
  title: string;
  fulfilment: FulfilmentState;
  /** Inside the return window with nothing open, refunded or swapped on it. */
  returnable: boolean;
  /** The newest return request's status on it, if any. */
  returnStatus: string | null;
  /** A warranty claim may be filed on it now. */
  warranty: boolean;
  /** A claim on it is still open. */
  claimOpen: boolean;
  /** It can still be cancelled or its quantity lowered. */
  changeable: boolean;
  rebuyable: boolean;
  reviewable: boolean;
  /** What its parcel's store said about when, while it is still coming. */
  promise: TrackPromise | null;
};

export type IssueFacts = {
  cancelled: boolean;
  cancellable: boolean;
  addressChangeable: boolean;
  paid: boolean;
  /** What the driver collects, already written with its currency. */
  owed: string;
  returnWindowDays: number;
  lines: IssueLine[];
};

/** Formats a stored day for a sentence, in the shopper's language. */
export type DayFormat = (iso: string) => string;

/**
 * "Wed 14 Oct", in Kuwait's calendar — the web's `useShortDayFormat`, for
 * the server to write a resolution's dates in the language it was asked in.
 */
export function shortDayIn(locale: "en" | "ar"): DayFormat {
  return iso => new Date(iso).toLocaleDateString(locale === "ar" ? "ar-KW-u-nu-latn" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kuwait",
  });
}

const COMING: readonly FulfilmentState[] = ["pending", "preparing", "shipped"];
const say = (key: AnswerPart["key"], params?: Record<string, string>): AnswerPart => (params ? { key, params } : { key });

/** Where an item is when it has not reached the shopper, or null once it has. */
function notHere(line: IssueLine): AnswerPart | null {
  if (line.fulfilment === "cancelled") return say("help.item.cancelled", { item: line.title });
  if (line.fulfilment === "returned") return say("help.item.returned", { item: line.title });
  if (line.fulfilment !== "delivered") return say("help.item.notArrived", { item: line.title });
  return null;
}

/** A request already on the item, said instead of offering another. */
function alreadyAsked(line: IssueLine): AnswerPart | null {
  if (!line.returnStatus) return null;
  if (isOpenReturn(line.returnStatus)) return say("help.item.returnOpen", { item: line.title });
  if (line.returnStatus === "refunded" || line.returnStatus === "exchanged") return say("help.item.returnDone", { item: line.title });
  return null;
}

/** What to say and offer when an item has not arrived: where it is, and a way out while it can be cancelled. */
function beforeArrival(line: IssueLine, facts: IssueFacts, said: AnswerPart): HelpResolution {
  const offers: HelpOffer[] = [];
  if (line.fulfilment !== "cancelled" && line.fulfilment !== "returned" && !facts.cancelled) offers.push({ kind: "open", panel: "track", lineId: line.id });
  if (line.changeable) offers.push({ kind: "cancelItem", lineId: line.id });
  return { say: [said], offers, person: "offer" };
}

/**
 * The answer to one issue about one order (or none, for the account), from
 * the order's facts. `lineId` is the item an item's issue is about.
 */
export function resolveIssue(issue: HelpIssue, facts: IssueFacts | null, lineId: number | null, day: DayFormat): HelpResolution {
  if (issue === "account") {
    return {
      say: [say("help.account.say")],
      offers: [{ kind: "page", to: "profile" }, { kind: "page", to: "notifications" }, { kind: "page", to: "addresses" }],
      person: "offer",
    };
  }
  if (!facts) return { say: [say("help.pickOrder")], offers: [], person: "offer" };
  const line = lineId === null ? null : facts.lines.find(candidate => candidate.id === lineId) ?? null;
  if (issueNeeds(issue) === "item" && !line) return { say: [say("help.pickItem")], offers: [], person: "offer" };

  switch (issue) {
    case "late": return late(facts, line, day);
    case "payment": return payment(facts);
    case "warranty": return warranty(facts, line!);
    default: return itemProblem(issue, facts, line!);
  }
}

function late(facts: IssueFacts, line: IssueLine | null, day: DayFormat): HelpResolution {
  if (facts.cancelled) return { say: [say("help.late.cancelled")], offers: [], person: "offer" };
  const lines = line ? [line] : facts.lines;
  const coming = lines.filter(candidate => COMING.includes(candidate.fulfilment));
  if (coming.length === 0) {
    const gone = line ? notHere(line) : null;
    if (gone && line!.fulfilment !== "delivered") return { say: [gone], offers: [], person: "offer" };
    return { say: [say("help.late.delivered")], offers: [], person: "next" };
  }

  const parts: AnswerPart[] = [];
  const lateOnes = coming.filter(candidate => candidate.promise?.kind === "window" && candidate.promise.late);
  const promise = (lateOnes[0] ?? coming.find(candidate => candidate.promise))?.promise ?? null;
  if (lateOnes.length && promise?.kind === "window") parts.push(say("help.late.late", { date: day(promise.to) }));
  else if (promise?.kind === "window") parts.push(say("help.late.onTime", { date: day(promise.to) }));
  else if (promise?.kind === "preorder") parts.push(promise.at ? say("help.late.preorder", { date: day(promise.at) }) : say("help.late.preorderOpen"));
  else if (promise?.kind === "madeToOrder") parts.push(say("help.late.madeToOrder"));
  else parts.push(say("help.late.noEstimate"));
  if (coming.some(candidate => candidate.fulfilment === "shipped")) parts.push(say("help.late.withDriver"));

  const offers: HelpOffer[] = [{ kind: "open", panel: "track", lineId: line?.id ?? null }];
  if (line?.changeable) {
    parts.push(say("help.late.canCancelItem"));
    offers.push({ kind: "cancelItem", lineId: line.id });
  } else if (!line && facts.cancellable) {
    parts.push(say("help.late.canCancel"));
    offers.push({ kind: "cancelOrder" });
  }
  if (lateOnes.length) parts.push(say("help.late.chase"));
  return { say: parts, offers, person: lateOnes.length ? "next" : "offer" };
}

function payment(facts: IssueFacts): HelpResolution {
  const parts = [
    facts.cancelled ? say("help.payment.cancelled") : facts.paid ? say("help.payment.paid") : say("help.payment.cod", { owed: facts.owed }),
    say("help.payment.person"),
  ];
  const offers: HelpOffer[] = facts.lines.some(line => line.returnStatus) ? [{ kind: "page", to: "returns" }] : [];
  return { say: parts, offers, person: "next" };
}

function warranty(facts: IssueFacts, line: IssueLine): HelpResolution {
  if (line.claimOpen) return { say: [say("help.warranty.open", { item: line.title })], offers: [], person: "offer" };
  if (line.warranty) {
    /* Inside the window a return is quicker, and a fault is approved at once. */
    if (line.returnable) {
      return {
        say: [say("help.warranty.returnFirst", { item: line.title })],
        offers: [
          { kind: "return", lineId: line.id, returnKinds: ["refund", "exchange"], reasons: ["defective", "damaged"] },
          { kind: "open", panel: "warranty", lineId: line.id },
        ],
        person: "offer",
      };
    }
    return { say: [say("help.warranty.file", { item: line.title })], offers: [{ kind: "open", panel: "warranty", lineId: line.id }], person: "offer" };
  }
  const gone = notHere(line);
  if (gone) return beforeArrival(line, facts, gone);
  if (line.returnable) {
    return {
      say: [say("help.warranty.returnInstead", { item: line.title })],
      offers: [{ kind: "return", lineId: line.id, returnKinds: ["refund", "exchange"], reasons: ["defective", "damaged"] }],
      person: "offer",
    };
  }
  return { say: [say("help.warranty.none", { item: line.title })], offers: [], person: "next" };
}

function itemProblem(issue: Exclude<HelpIssue, "late" | "payment" | "warranty" | "account">, facts: IssueFacts, line: IssueLine): HelpResolution {
  const gone = notHere(line);
  if (gone) {
    if (line.fulfilment === "pending" || line.fulfilment === "preparing" || line.fulfilment === "shipped") {
      return beforeArrival(line, facts, line.changeable && (issue === "return" || issue === "exchange") ? say("help.item.notArrivedCancel", { item: line.title }) : gone);
    }
    return { say: [gone], offers: [], person: "offer" };
  }
  const asked = alreadyAsked(line);
  if (asked) return { say: [asked], offers: [{ kind: "page", to: "returns" }], person: "offer" };

  if (!line.returnable) {
    const closed = say("help.item.windowClosed", { item: line.title, days: String(facts.returnWindowDays) });
    if (line.warranty) return { say: [closed, say("help.item.warrantyCovers")], offers: [{ kind: "open", panel: "warranty", lineId: line.id }], person: "offer" };
    if (line.claimOpen) return { say: [say("help.warranty.open", { item: line.title })], offers: [], person: "offer" };
    return { say: [closed], offers: [], person: issue === "return" || issue === "exchange" ? "offer" : "next" };
  }

  if (issue === "damaged") {
    return {
      say: [say("help.damaged.return", { item: line.title })],
      offers: [{ kind: "return", lineId: line.id, returnKinds: ["refund", "exchange"], reasons: ["damaged", "defective"] }],
      person: "offer",
    };
  }
  if (issue === "wrong") {
    return {
      say: [say("help.wrong.return", { item: line.title }), say("help.wrong.missing")],
      offers: [{ kind: "return", lineId: line.id, returnKinds: ["refund", "exchange"], reasons: ["wrongItem", "notAsDescribed"] }],
      person: "offer",
    };
  }
  if (issue === "exchange") {
    return {
      say: [say("help.exchange.how", { item: line.title }), say("help.exchange.size")],
      offers: [{ kind: "return", lineId: line.id, returnKinds: ["exchange"], reasons: [...EXCHANGE_REASONS] }],
      person: "offer",
    };
  }
  return {
    say: [say("help.return.how", { item: line.title })],
    offers: [
      { kind: "return", lineId: line.id, returnKinds: ["refund"], reasons: [...QUICK_RETURN_REASONS] },
      { kind: "open", panel: "returnForm", lineId: line.id },
    ],
    person: "offer",
  };
}

/* ------------------------------------------------------------ allowed --- */

/**
 * Whether an offer may be made on this order now — the check every offer a
 * model proposes passes before it is drawn. The API asks its own rule again
 * when the shopper confirms; this keeps a button off the page that it would
 * refuse.
 */
export function offerAllowed(offer: HelpOffer, facts: IssueFacts): boolean {
  const line = "lineId" in offer && offer.lineId !== null ? facts.lines.find(candidate => candidate.id === offer.lineId) ?? null : null;
  if ("lineId" in offer && offer.lineId !== null && !line) return false;
  switch (offer.kind) {
    case "return":
      return Boolean(line?.returnable)
        && offer.returnKinds.length > 0 && offer.returnKinds.every(kind => (RETURN_KINDS as readonly string[]).includes(kind))
        && offer.reasons.length > 0 && offer.reasons.every(reason => QUICK_RETURN_REASONS.includes(reason));
    case "cancelOrder": return facts.cancellable;
    case "cancelItem": return Boolean(line?.changeable);
    case "buyAgain": return line ? line.rebuyable : facts.lines.some(candidate => candidate.rebuyable);
    case "page": return (HELP_PAGES as readonly string[]).includes(offer.to);
    case "open":
      switch (offer.panel) {
        case "track": return !facts.cancelled && (!line || COMING.includes(line.fulfilment) || line.fulfilment === "delivered");
        case "refund": return facts.lines.some(candidate => candidate.returnable);
        case "returnForm": return Boolean(line?.returnable);
        case "warranty": return line ? line.warranty : facts.lines.some(candidate => candidate.warranty);
        case "address": return facts.addressChangeable;
        case "modify": return line ? line.changeable : facts.lines.some(candidate => candidate.changeable);
        case "rate": return line ? line.reviewable : facts.lines.some(candidate => candidate.reviewable);
        default: return false;
      }
    default: return false;
  }
}

/* ----------------------------------------------------------- handover --- */

/** What the page reports it already did, in the words a person reads. */
export const HELP_DONE = [
  "returnApproved", "returnDeclined", "returnWaiting",
  "exchangeApproved", "exchangeDeclined", "exchangeWaiting",
  "cancelOrder", "cancelItem", "buyAgain", "failed",
] as const;
export type HelpDone = (typeof HELP_DONE)[number];

/** How a return request's answer is reported. */
export function doneForReturn(kind: ReturnKind, status: string): HelpDone {
  const decided = status === "approved" ? "Approved" : status === "declined" ? "Declined" : "Waiting";
  return `${kind === "exchange" ? "exchange" : "return"}${decided}` as HelpDone;
}

export type Handover = {
  issue: HelpIssue | null;
  /** The item it is about, its title read from the order — never from the page. */
  item: string | null;
  done: { act: HelpDone; item: string | null }[];
};

/** At most this many acts are carried into a handover. */
export const MAX_HANDOVER_DONE = 10;

/** What a person reads first: the issue, the item and what was already done. */
export function handoverParts(handover: Handover): AnswerPart[] {
  const parts: AnswerPart[] = [say("support.handover.title")];
  if (handover.issue) parts.push(say(`support.handover.issue.${handover.issue}`));
  if (handover.item) parts.push(say("support.handover.item", { item: handover.item }));
  for (const done of handover.done.slice(0, MAX_HANDOVER_DONE)) parts.push(say(`support.handover.did.${done.act}`, { item: done.item ?? "—" }));
  if (handover.done.length === 0) parts.push(say("support.handover.nothingDone"));
  return parts;
}
