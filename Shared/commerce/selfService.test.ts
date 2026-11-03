import { describe, expect, it } from "vitest";
import { doneForReturn, handoverParts, issueNeeds, offerAllowed, resolveIssue, topicFor, type IssueFacts, type IssueLine } from "./selfService.js";

const day = (iso: string) => `day(${iso.slice(0, 10)})`;

const line = (over: Partial<IssueLine>): IssueLine => ({
  id: 1,
  title: "Lamp",
  fulfilment: "delivered",
  returnable: true,
  returnStatus: null,
  warranty: false,
  claimOpen: false,
  changeable: false,
  rebuyable: true,
  reviewable: true,
  promise: null,
  ...over,
});

const facts = (lines: IssueLine[], over: Partial<IssueFacts> = {}): IssueFacts => ({
  cancelled: false,
  cancellable: false,
  addressChangeable: false,
  paid: true,
  owed: "KWD 12.500",
  returnWindowDays: 14,
  lines,
  ...over,
});

const keys = (said: { key: string }[]) => said.map(part => part.key);

describe("self-service", () => {
  it("knows what each issue needs and where it is filed", () => {
    expect(issueNeeds("damaged")).toBe("item");
    expect(issueNeeds("late")).toBe("order");
    expect(issueNeeds("account")).toBe("nothing");
    expect(topicFor("late")).toBe("delivery");
    expect(topicFor("exchange")).toBe("return");
    expect(topicFor(null)).toBe("order");
  });

  it("offers a return a fault decides at once, refund or the same item again", () => {
    const answer = resolveIssue("damaged", facts([line({})]), 1, day);
    expect(keys(answer.say)).toEqual(["help.damaged.return"]);
    expect(answer.offers).toEqual([{ kind: "return", lineId: 1, returnKinds: ["refund", "exchange"], reasons: ["damaged", "defective"] }]);
    expect(answer.person).toBe("offer");
  });

  it("asks which item before answering an item's issue", () => {
    expect(keys(resolveIssue("wrong", facts([line({})]), null, day).say)).toEqual(["help.pickItem"]);
    expect(keys(resolveIssue("wrong", facts([line({})]), 99, day).say)).toEqual(["help.pickItem"]);
  });

  it("goes to the warranty once the window has closed, and to a person when nothing covers it", () => {
    const covered = resolveIssue("damaged", facts([line({ returnable: false, warranty: true })]), 1, day);
    expect(covered.offers).toEqual([{ kind: "open", panel: "warranty", lineId: 1 }]);
    const bare = resolveIssue("damaged", facts([line({ returnable: false })]), 1, day);
    expect(bare.offers).toEqual([]);
    expect(bare.person).toBe("next");
  });

  it("never offers a return on something still coming, and offers to cancel it while it can be", () => {
    const answer = resolveIssue("return", facts([line({ fulfilment: "preparing", returnable: false, changeable: true })]), 1, day);
    expect(keys(answer.say)).toEqual(["help.item.notArrivedCancel"]);
    expect(answer.offers).toEqual([{ kind: "open", panel: "track", lineId: 1 }, { kind: "cancelItem", lineId: 1 }]);
  });

  it("says a return already asked for rather than offering another", () => {
    const answer = resolveIssue("return", facts([line({ returnable: false, returnStatus: "approved" })]), 1, day);
    expect(keys(answer.say)).toEqual(["help.item.returnOpen"]);
    expect(answer.offers).toEqual([{ kind: "page", to: "returns" }]);
  });

  it("never offers an exchange for a size", () => {
    const answer = resolveIssue("exchange", facts([line({})]), 1, day);
    expect(answer.offers[0]).toMatchObject({ kind: "return", returnKinds: ["exchange"] });
    expect((answer.offers[0] as { reasons: string[] }).reasons).not.toContain("tooSmall");
  });

  it("names a late parcel's promised day, and a person to chase it", () => {
    const answer = resolveIssue(
      "late",
      facts([line({ fulfilment: "shipped", returnable: false, promise: { kind: "window", from: "2026-11-01", to: "2026-11-02", late: true } })], { cancellable: false }),
      null,
      day,
    );
    expect(answer.say[0]).toEqual({ key: "help.late.late", params: { date: "day(2026-11-02)" } });
    expect(keys(answer.say)).toContain("help.late.withDriver");
    expect(answer.person).toBe("next");
    const early = resolveIssue("late", facts([line({ fulfilment: "pending", returnable: false })], { cancellable: true, paid: false }), null, day);
    expect(early.offers).toEqual([{ kind: "open", panel: "track", lineId: null }, { kind: "cancelOrder" }]);
  });

  it("says what is owed in cash, and sends a payment problem to a person", () => {
    const answer = resolveIssue("payment", facts([line({ fulfilment: "pending" })], { paid: false }), null, day);
    expect(answer.say[0]).toEqual({ key: "help.payment.cod", params: { owed: "KWD 12.500" } });
    expect(answer.person).toBe("next");
  });

  it("answers the account with its own pages, no order needed", () => {
    const answer = resolveIssue("account", null, null, day);
    expect(answer.offers.map(offer => offer.kind)).toEqual(["page", "page", "page", "page"]);
  });

  it("allows only what the order allows now", () => {
    const order = facts([line({ id: 3, fulfilment: "preparing", returnable: false, changeable: true })], { cancellable: true });
    expect(offerAllowed({ kind: "return", lineId: 3, returnKinds: ["refund"], reasons: ["damaged"] }, order)).toBe(false);
    expect(offerAllowed({ kind: "cancelItem", lineId: 3 }, order)).toBe(true);
    expect(offerAllowed({ kind: "cancelItem", lineId: 4 }, order)).toBe(false);
    expect(offerAllowed({ kind: "cancelOrder" }, order)).toBe(true);
    expect(offerAllowed({ kind: "return", lineId: 3, returnKinds: ["refund"], reasons: ["other"] }, facts([line({ id: 3 })]))).toBe(false);
    expect(offerAllowed({ kind: "open", panel: "address", lineId: null }, order)).toBe(false);
  });

  it("hands a person the issue, the item and what was done", () => {
    expect(doneForReturn("refund", "approved")).toBe("returnApproved");
    expect(doneForReturn("exchange", "requested")).toBe("exchangeWaiting");
    const parts = handoverParts({ issue: "damaged", item: "Lamp", done: [{ act: "returnApproved", item: "Lamp" }] });
    expect(keys(parts)).toEqual(["support.handover.title", "support.handover.issue.damaged", "support.handover.item", "support.handover.did.returnApproved"]);
    expect(keys(handoverParts({ issue: null, item: null, done: [] }))).toEqual(["support.handover.title", "support.handover.nothingDone"]);
  });
});
