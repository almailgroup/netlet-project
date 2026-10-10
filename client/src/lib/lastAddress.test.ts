import { describe, expect, it } from "vitest";
import { addressToUse, zoneFromAddressBook } from "./lastAddress";

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
