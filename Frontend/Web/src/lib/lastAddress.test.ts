import { describe, expect, it } from "vitest";
import { addressInUse, addressToUse, zoneFromAddressBook } from "./lastAddress";

const book = [
  { id: 4, governorate: "hawalli" },
  { id: 9, governorate: "jahra" },
  { id: 12, governorate: null },
];

describe("the address book's say in the delivery area", () => {
  it("starts from the address used last on this device, else the first", () => {
    expect(zoneFromAddressBook(book, 9)).toBe("jahra");
    expect(zoneFromAddressBook(book, null)).toBe("hawalli");
    /* An address that is gone falls back to the book's first, the rule checkout uses. */
    expect(addressToUse(book, 77)?.id).toBe(4);
  });

  it("passes over an address that names no governorate", () => {
    expect(zoneFromAddressBook(book, 12)).toBe("hawalli");
    expect(zoneFromAddressBook([{ id: 1, governorate: null }], 1)).toBeNull();
    expect(zoneFromAddressBook([], null)).toBeNull();
  });
});

describe("the address being delivered to", () => {
  const shelf = [
    { id: 4, governorate: "hawalli" },
    { id: 5, governorate: "hawalli" },
    { id: 9, governorate: "jahra" },
  ];

  it("is the one used last, while it is still the area in use", () => {
    expect(addressInUse(shelf, 5, "hawalli")?.id).toBe(5);
    /* Used last, but the area has moved on since: the area's own first. */
    expect(addressInUse(shelf, 9, "hawalli")?.id).toBe(4);
  });

  it("is nobody's when no address is in the area", () => {
    expect(addressInUse(shelf, 4, "ahmadi")).toBeNull();
    expect(addressInUse(shelf, 4, null)).toBeNull();
    expect(addressInUse([], null, "hawalli")).toBeNull();
  });
});
