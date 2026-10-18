import { describe, expect, it } from "vitest";
import {
  MAX_ADDRESSES,
  addressAcceptable,
  addressProblems,
  destinationCount,
  freezeDestination,
  missingFromAddress,
  parcelKey,
  splitAcrossSeller,
  type DestinedLine,
  type ShippingAddress,
} from "./addresses.js";
import { FREE, groupForDelivery, quoteDelivery, type DeliveryRule } from "./delivery.js";

const home: ShippingAddress = {
  label: "Home",
  contactName: "Noura",
  contactPhone: "+96550123456",
  governorate: "hawalli",
  addressLine: "Block 4, Street 12, House 7",
};

describe("what an address must have", () => {
  it("accepts an ordinary Kuwaiti address", () => {
    expect(addressProblems(home)).toEqual([]);
    expect(addressAcceptable(home)).toBe(true);
  });

  it("refuses an address with no label and no line", () => {
    expect(addressProblems({ label: "  ", addressLine: "" })).toEqual([
      "address.needsLabel",
      "address.needsLine",
    ]);
  });

  it("refuses a governorate that is not one of the six", () => {
    expect(addressProblems({ ...home, governorate: "dubai" })).toEqual(["address.unknownZone"]);
  });

  it("refuses a phone that is not a phone, in either script", () => {
    expect(addressProblems({ ...home, contactPhone: "12" })).toEqual(["address.badPhone"]);
    // Arabic-Indic digits are the obvious way to type a number on an Arabic page.
    expect(addressProblems({ ...home, contactPhone: "٥٠١٢٣٤٥٦" })).toEqual([]);
  });

  it("reports what is merely absent rather than refusing it", () => {
    const bare: ShippingAddress = { label: "Office", addressLine: "Block 1" };
    expect(addressAcceptable(bare)).toBe(true);
    expect(missingFromAddress(bare)).toEqual(["address.noZone", "address.noPhone", "address.noName"]);
  });

  it("keeps the book a book", () => {
    expect(MAX_ADDRESSES).toBeGreaterThan(2);
    expect(MAX_ADDRESSES).toBeLessThanOrEqual(20);
  });
});

describe("freezing a destination", () => {
  it("copies the facts and blanks what is empty", () => {
    expect(freezeDestination({ ...home, addressNotes: "   " })).toEqual({
      label: "Home",
      contactName: "Noura",
      contactPhone: "+96550123456",
      governorate: "hawalli",
      addressLine: "Block 4, Street 12, House 7",
      addressNotes: null,
      pin: null,
      parts: null,
    });
  });

  it("freezes a pin to a metre and drops one outside Kuwait", () => {
    expect(freezeDestination({ ...home, pin: { lat: 29.332812345, lng: 48.028612345 } }).pin).toEqual({ lat: 29.33281, lng: 48.02861 });
    expect(freezeDestination({ ...home, pin: { lat: 51.5, lng: -0.12 } }).pin).toBeNull();
  });
});

describe("a pin on an address", () => {
  it("is optional, and refused only when it is somewhere else", () => {
    expect(addressProblems({ ...home, pin: null })).toEqual([]);
    expect(addressProblems({ ...home, pin: { lat: 29.33, lng: 48.02 } })).toEqual([]);
    expect(addressProblems({ ...home, pin: { lat: 30.5, lng: 47.78 } })).toEqual(["address.pinOutsideKuwait"]);
  });
});

describe("a parcel is a seller and a destination", () => {
  const acme: DeliveryRule = { flat: "2.000", freeOver: "20.000" };
  const rules = new Map<number | null, DeliveryRule>([[1, acme]]);

  it("keys a parcel so one id cannot bleed into another", () => {
    expect(parcelKey(1, 12)).not.toBe(parcelKey(11, 2));
    expect(parcelKey(1, null)).toBe(parcelKey(1, null));
  });

  it("charges one seller twice for two doors", () => {
    const lines: DestinedLine[] = [
      { vendorId: 1, vendorName: "Acme", destinationId: null, destinationLabel: null, value: "15.000" },
      { vendorId: 1, vendorName: "Acme", destinationId: 7, destinationLabel: "Office", value: "15.000" },
    ];
    const quote = quoteDelivery(groupForDelivery(lines, rules));

    expect(quote.perVendor).toHaveLength(2);
    // Thirty pounds with this seller and neither door clears their twenty.
    expect(quote.total).toBe("4.000");
    expect(quote.perVendor.map(row => row.toFree)).toEqual(["5.000", "5.000"]);
    expect(quote.perVendor[1].destinationLabel).toBe("Office");
  });

  it("clears the threshold at the door that actually earned it", () => {
    const lines: DestinedLine[] = [
      { vendorId: 1, vendorName: "Acme", destinationId: null, destinationLabel: null, value: "25.000" },
      { vendorId: 1, vendorName: "Acme", destinationId: 7, destinationLabel: "Office", value: "5.000" },
    ];
    const quote = quoteDelivery(groupForDelivery(lines, rules));

    expect(quote.perVendor[0].free).toBe(true);
    expect(quote.perVendor[1].fee).toBe("2.000");
    expect(quote.total).toBe("2.000");
  });

  it("charges a basket going to one door exactly as it always did", () => {
    const lines: DestinedLine[] = [
      { vendorId: 1, vendorName: "Acme", destinationId: 7, destinationLabel: "Office", value: "10.000" },
      { vendorId: 1, vendorName: "Acme", destinationId: 7, destinationLabel: "Office", value: "5.000" },
    ];
    const quote = quoteDelivery(groupForDelivery(lines, rules));

    expect(quote.perVendor).toHaveLength(1);
    expect(quote.perVendor[0].goods).toBe("15.000");
    expect(quote.total).toBe("2.000");
  });

  it("gives a seller with no recorded fee away free, at every door", () => {
    const lines: DestinedLine[] = [
      { vendorId: 4, vendorName: "Bolt", destinationId: null, destinationLabel: null, value: "5.000" },
      { vendorId: 4, vendorName: "Bolt", destinationId: 7, destinationLabel: "Office", value: "5.000" },
    ];
    const quote = quoteDelivery(groupForDelivery(lines, new Map([[4, FREE]])));
    expect(quote.total).toBe("0.000");
  });

  it("counts the doors and notices which seller was split", () => {
    const twoSellersOneDoor: DestinedLine[] = [
      { vendorId: 1, vendorName: "Acme", destinationId: 7, destinationLabel: "Office", value: "5.000" },
      { vendorId: 2, vendorName: "Bolt", destinationId: 7, destinationLabel: "Office", value: "5.000" },
    ];
    expect(destinationCount(twoSellersOneDoor)).toBe(1);
    expect(splitAcrossSeller(twoSellersOneDoor)).toBe(false);

    const oneSellerTwoDoors: DestinedLine[] = [
      { vendorId: 1, vendorName: "Acme", destinationId: 7, destinationLabel: "Office", value: "5.000" },
      { vendorId: 1, vendorName: "Acme", destinationId: null, destinationLabel: null, value: "5.000" },
    ];
    expect(destinationCount(oneSellerTwoDoors)).toBe(2);
    expect(splitAcrossSeller(oneSellerTwoDoors)).toBe(true);
  });
});
