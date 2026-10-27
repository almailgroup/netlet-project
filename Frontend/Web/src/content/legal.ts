/**
 * The terms of use and the privacy policy, as sections of message keys.
 *
 * Every sentence states what the shop actually does — cash on delivery, each
 * store's own delivery fee, `RETURN_WINDOW_DAYS`, the one sign-in cookie, the
 * services a shopper's information reaches — so the pages cannot promise what
 * the code does not do. When a rule in the code changes, the sentence here
 * that describes it changes with it, and `LEGAL_UPDATED` moves.
 *
 * The seller agreement (`/seller-agreement`) is the third document, the one
 * a store accepts on `/sell` — its version is `AGREEMENT_VERSION`, frozen on
 * the application, so the text below is what that version means. Change a
 * sentence in it and the version moves with it.
 *
 * They were written from the code, not by a lawyer; somebody qualified in
 * Kuwaiti consumer and data law should read them before they are relied on.
 */
import type { MessageKey } from "@shared/i18n/dictionary";

/** When either page last changed, as a Kuwaiti calendar day. */
export const LEGAL_UPDATED = "2026-10-27";

export type LegalParagraph = {
  key: MessageKey;
  /** Drawn only while the deployment does what it describes. */
  only?: "analytics" | "email" | "tryOn" | "drivingTimes";
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
  { id: "writing", title: "terms.writing.title", body: [{ key: "terms.writing.honest" }] },
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
      { key: "privacy.who.email", only: "email" },
      { key: "privacy.who.google" },
      { key: "privacy.who.ai" },
      { key: "privacy.who.tryOn", only: "tryOn" },
      { key: "privacy.who.drivers" },
      { key: "privacy.who.drivingTimes", only: "drivingTimes" },
      { key: "privacy.who.sell" },
    ],
  },
  { id: "cookies", title: "privacy.cookies.title", body: [{ key: "privacy.cookies.body" }, { key: "privacy.cookies.analytics", only: "analytics" }] },
  { id: "long", title: "privacy.long.title", body: [{ key: "privacy.long.body" }] },
  { id: "choices", title: "privacy.choices.title", body: [{ key: "privacy.choices.body" }] },
  { id: "changes", title: "privacy.changes.title", body: [{ key: "privacy.changes.body" }] },
];

export const SELLER_TERMS: LegalSection[] = [
  { id: "parties", title: "sellerTerms.parties.title", body: [{ key: "sellerTerms.parties.body" }, { key: "sellerTerms.parties.accept" }] },
  { id: "store", title: "sellerTerms.store.title", body: [{ key: "sellerTerms.store.yours" }, { key: "sellerTerms.store.documents" }] },
  {
    id: "listings",
    title: "sellerTerms.listings.title",
    body: [{ key: "sellerTerms.listings.honest" }, { key: "sellerTerms.listings.review" }, { key: "sellerTerms.listings.warnings" }],
  },
  { id: "prices", title: "sellerTerms.prices.title", body: [{ key: "sellerTerms.prices.permit" }, { key: "sellerTerms.prices.requests" }] },
  { id: "commission", title: "sellerTerms.commission.title", body: [{ key: "sellerTerms.commission.rate" }, { key: "sellerTerms.commission.frozen" }] },
  { id: "payouts", title: "sellerTerms.payouts.title", body: [{ key: "sellerTerms.payouts.when" }, { key: "sellerTerms.payouts.deductions" }] },
  {
    id: "delivery",
    title: "sellerTerms.delivery.title",
    body: [{ key: "sellerTerms.delivery.terms" }, { key: "sellerTerms.delivery.damage" }, { key: "sellerTerms.delivery.cancel" }],
  },
  { id: "returns", title: "sellerTerms.returns.title", body: [{ key: "sellerTerms.returns.window" }, { key: "sellerTerms.returns.refund" }] },
  { id: "conduct", title: "sellerTerms.conduct.title", body: [{ key: "sellerTerms.conduct.contact" }, { key: "sellerTerms.conduct.data" }] },
  { id: "placements", title: "sellerTerms.placements.title", body: [{ key: "sellerTerms.placements.body" }] },
  { id: "ending", title: "sellerTerms.ending.title", body: [{ key: "sellerTerms.ending.body" }, { key: "sellerTerms.ending.paid" }] },
  { id: "law", title: "sellerTerms.law.title", body: [{ key: "sellerTerms.law.changes" }, { key: "sellerTerms.law.kuwait" }] },
];
