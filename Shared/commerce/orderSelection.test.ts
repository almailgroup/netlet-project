import { describe, expect, it } from "vitest";
import { chosenState, firstToRate, selectionOffers, type ChosenLine } from "./orderSelection";

/* An order of four. The Swift app's `OrderSelectionTests` runs these same cases. */
const line = (id: number, facts: Partial<ChosenLine> = {}): ChosenLine => ({
  id,
  fulfilment: "pending",
  quantity: 1,
  returnable: false,
  warranty: false,
  changeable: false,
  rateable: false,
  rebuyable: true,
  ...facts,
});
const waiting = line(1, { changeable: true, quantity: 3 }); // not yet with a driver, three of it
const single = line(2, { changeable: true }); // not yet with a driver, one of it
const arrived = line(3, { fulfilment: "delivered", returnable: true, warranty: true, rateable: true });
const gone = line(4, { fulfilment: "cancelled", rebuyable: false });

const actions = (chosen: ChosenLine[], cancelled = false) => selectionOffers(chosen, { cancelled }).map(offer => offer.action);

describe("what the chosen items of an order offer", () => {
  it("offers nothing until something is chosen", () => {
    expect(selectionOffers([], { cancelled: false })).toEqual([]);
  });

  it("offers one item exactly its own acts, in the bar's order", () => {
    expect(actions([waiting])).toEqual(["track", "quantity", "buyAgain", "help", "cancelItems"]);
    expect(actions([single])).toEqual(["track", "buyAgain", "help", "cancelItems"]);
    expect(actions([arrived])).toEqual(["track", "return", "warranty", "rate", "buyAgain", "help"]);
    expect(actions([gone])).toEqual(["help"]);
  });

  it("offers several a refund across them, never one item's return form", () => {
    expect(actions([arrived, waiting])).toEqual(["track", "refund", "warranty", "quantity", "rate", "buyAgain", "help", "cancelItems"]);
  });

  it("says which of the chosen each act is about", () => {
    const offers = selectionOffers([waiting, single, arrived, gone], { cancelled: false });
    const about = Object.fromEntries(offers.map(offer => [offer.action, offer.lineIds]));
    expect(about).toEqual({
      track: [1, 2, 3],
      refund: [3],
      warranty: [3],
      quantity: [1],
      rate: [3],
      buyAgain: [1, 2, 3],
      help: [1, 2, 3, 4],
      cancelItems: [1, 2],
    });
  });

  it("offers nothing to follow on an order cancelled whole", () => {
    expect(actions([gone], true)).toEqual(["help"]);
    expect(actions([line(5)], true)).toEqual(["buyAgain", "help"]);
  });
});

describe("the whole order's acts, whatever is chosen", () => {
  const whole = (facts: Partial<{ modifiable: boolean; address: boolean; payment: boolean; cancellable: boolean }> = {}) => ({
    modifiable: false,
    address: false,
    payment: false,
    cancellable: false,
    ...facts,
  });
  const open = { modifiable: true, address: true, payment: true, cancellable: true };
  const wholeActions = (chosen: ChosenLine[], facts = {}, everyChosen = true, cancelled = false) =>
    selectionOffers(chosen, { cancelled, whole: whole(facts), everyChosen }).map(offer => offer.action);

  it("with every item chosen, the order's change form, address, way to pay and receipt, and cancels the order itself", () => {
    expect(wholeActions([waiting, single], open)).toEqual([
      "track", "modify", "buyAgain", "address", "payment", "receipt", "help", "cancelOrder",
    ]);
  });

  /* The owner's screenshots: an unpaid order of two, nothing with a driver.
     One chosen offered Track, Buy again, Help and Cancel; both offered eight. */
  it("offers one chosen item of several the order's acts too, and only Cancel items", () => {
    expect(wholeActions([single], open, false)).toEqual([
      "track", "modify", "buyAgain", "address", "payment", "receipt", "help", "cancelItems",
    ]);
    /* Its own quantity beside the order's change form, when there is more than one of it. */
    expect(wholeActions([waiting], open, false)).toEqual([
      "track", "quantity", "modify", "buyAgain", "address", "payment", "receipt", "help", "cancelItems",
    ]);
    /* Never fewer than with every item chosen. */
    const one = new Set(wholeActions([single], open, false));
    for (const action of wholeActions([waiting, single], open)) expect(one.has(action) || action === "cancelOrder").toBe(true);
  });

  it("says the order's acts are about everything chosen, the item's about the item", () => {
    const offers = selectionOffers([waiting], { cancelled: false, whole: whole(open), everyChosen: false });
    const about = Object.fromEntries(offers.map(offer => [offer.action, offer.lineIds]));
    expect(about.cancelItems).toEqual([1]);
    expect(about.cancelOrder).toBeUndefined();
    expect(about.modify).toEqual([1]);
  });

  /* The owner's screenshot: five of eight chosen offered Cancel items and
     Cancel order side by side. The order is cancelled only from All. */
  it("offers Cancel order only with every item chosen, and never beside Cancel items", () => {
    expect(wholeActions([waiting, single], open, false)).not.toContain("cancelOrder");
    expect(wholeActions([waiting, single], open, false)).toContain("cancelItems");
    expect(wholeActions([waiting, single], open, true)).toContain("cancelOrder");
    expect(wholeActions([waiting, single], open, true)).not.toContain("cancelItems");
  });

  it("offers only what the order allows now, the receipt always", () => {
    expect(wholeActions([arrived])).toEqual(["track", "return", "warranty", "rate", "buyAgain", "receipt", "help"]);
    expect(wholeActions([arrived], {}, false)).toEqual(["track", "return", "warranty", "rate", "buyAgain", "receipt", "help"]);
    expect(wholeActions([gone], {}, true, true)).toEqual(["receipt", "help"]);
  });

  it("offers the order's change form while any item of the order may change, the chosen one or not", () => {
    /* A delivered item chosen on an order whose other item may still change. */
    expect(wholeActions([arrived], { modifiable: true }, false)).toContain("modify");
    expect(wholeActions([arrived], { modifiable: false }, false)).not.toContain("modify");
  });

  it("cancels the items that may change when the order cannot be cancelled whole", () => {
    expect(wholeActions([waiting, arrived], { modifiable: true, address: true })).toEqual([
      "track", "refund", "warranty", "modify", "rate", "buyAgain", "address", "receipt", "help", "cancelItems",
    ]);
    const offers = selectionOffers([waiting, arrived], { cancelled: false, whole: whole({ modifiable: true }), everyChosen: true });
    expect(offers.find(offer => offer.action === "cancelItems")?.lineIds).toEqual([1]);
    expect(offers.find(offer => offer.action === "modify")?.lineIds).toEqual([1, 3]);
    expect(offers.find(offer => offer.action === "receipt")?.lineIds).toEqual([1, 3]);
  });

  it("offers the items' acts alone when the order's facts are not given", () => {
    expect(actions([waiting, single])).toEqual(["track", "quantity", "buyAgain", "help", "cancelItems"]);
    expect(actions([waiting, single])).not.toContain("receipt");
  });
});

describe("the All circle", () => {
  it("reads all, some or none of the order", () => {
    expect(chosenState([1, 2, 3], [])).toBe("none");
    expect(chosenState([1, 2, 3], [2])).toBe("some");
    expect(chosenState([1, 2, 3], [3, 1, 2])).toBe("all");
    /* An id the order no longer has counts for nothing. */
    expect(chosenState([1, 2], [1, 9])).toBe("some");
  });
});

describe("which item Rate opens", () => {
  it("is the first not yet reviewed, else the first", () => {
    const lines = [{ id: 1, reviewed: true }, { id: 2, reviewed: false }, { id: 3, reviewed: false }];
    expect(firstToRate(lines, [1, 2, 3])).toBe(2);
    expect(firstToRate(lines, [3, 1])).toBe(3);
    expect(firstToRate(lines, [1])).toBe(1);
    expect(firstToRate(lines, [])).toBeNull();
  });
});
