/**
 * The terms of use and the privacy policy, as sections of message keys.
 *
 * Every sentence states what the shop actually does — cash on delivery, each
 * store's own delivery fee, `RETURN_WINDOW_DAYS`, the one sign-in cookie, the
 * services a shopper's information reaches — so the pages cannot promise what
 * the code does not do. When a rule in the code changes, the sentence here
 * that describes it changes with it, and `LEGAL_UPDATED` moves.
 *
 * They were written from the code, not by a lawyer; somebody qualified in
 * Kuwaiti consumer and data law should read them before they are relied on.
 */
import type { MessageKey } from "@shared/i18n/dictionary";

/** When either page last changed, as a Kuwaiti calendar day. */
export const LEGAL_UPDATED = "2026-10-17";

export type LegalParagraph = {
  key: MessageKey;
  /** Drawn only while the deployment does what it describes. */
  only?: "analytics";
};

export type LegalSection = { id: string; title: MessageKey; body: LegalParagraph[] };

export const TERMS: LegalSection[] = [
  { id: "seller", title: "terms.seller.title", body: [{ key: "terms.seller.store" }, { key: "terms.seller.netlet" }] },
  { id: "account", title: "terms.account.title", body: [{ key: "terms.account.password" }, { key: "terms.account.suspend" }] },
  {
    id: "paying",
    title: "terms.paying.title",
    body: [{ key: "terms.paying.total" }, { key: "terms.paying.cash" }, { key: "terms.paying.codes" }, { key: "terms.paying.errors" }],
  },
  { id: "delivery", title: "terms.delivery.title", body: [{ key: "terms.delivery.stores" }, { key: "terms.delivery.times" }, { key: "terms.delivery.cancel" }] },
  { id: "returns", title: "terms.returns.title", body: [{ key: "terms.returns.window" }, { key: "terms.returns.mind" }] },
  { id: "writing", title: "terms.writing.title", body: [{ key: "terms.writing.honest" }, { key: "terms.writing.filter" }] },
  { id: "fair", title: "terms.fair.title", body: [{ key: "terms.fair.body" }] },
  { id: "liability", title: "terms.liability.title", body: [{ key: "terms.liability.body" }] },
  { id: "law", title: "terms.law.title", body: [{ key: "terms.law.changes" }, { key: "terms.law.kuwait" }] },
];

export const PRIVACY: LegalSection[] = [
  {
    id: "keep",
    title: "privacy.keep.title",
    body: [{ key: "privacy.keep.account" }, { key: "privacy.keep.orders" }, { key: "privacy.keep.writing" }, { key: "privacy.keep.selling" }],
  },
  { id: "device", title: "privacy.device.title", body: [{ key: "privacy.device.body" }] },
  { id: "why", title: "privacy.why.title", body: [{ key: "privacy.why.orders" }, { key: "privacy.why.abuse" }, { key: "privacy.why.picked" }] },
  {
    id: "who",
    title: "privacy.who.title",
    body: [
      { key: "privacy.who.stores" },
      { key: "privacy.who.services" },
      { key: "privacy.who.google" },
      { key: "privacy.who.ai" },
      { key: "privacy.who.drivers" },
      { key: "privacy.who.sell" },
    ],
  },
  { id: "cookies", title: "privacy.cookies.title", body: [{ key: "privacy.cookies.body" }, { key: "privacy.cookies.analytics", only: "analytics" }] },
  { id: "long", title: "privacy.long.title", body: [{ key: "privacy.long.body" }] },
  { id: "choices", title: "privacy.choices.title", body: [{ key: "privacy.choices.body" }] },
  { id: "changes", title: "privacy.changes.title", body: [{ key: "privacy.changes.body" }] },
];
