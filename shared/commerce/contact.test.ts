import { describe, expect, it } from "vitest";
import { NETLET_CONTACT, companyDetails, contactEmail, displayNumber, mapsLink, nameInSentence, socialLink, socialLinks, visitDetails } from "./contact.js";
import { supportNumber } from "./support.js";

describe("contactEmail", () => {
  it("takes an ordinary address and lowercases it", () => {
    expect(contactEmail("  Support@NetLet.com.kw ")).toBe("support@netlet.com.kw");
  });

  it("is absent when unset or not an address", () => {
    expect(contactEmail("")).toBeNull();
    expect(contactEmail("support")).toBeNull();
    expect(contactEmail("support@netlet")).toBeNull();
    expect(contactEmail("sup port@netlet.com")).toBeNull();
    expect(contactEmail("a@b@netlet.com")).toBeNull();
  });
});

describe("socialLink", () => {
  it("takes a profile on the platform's own host", () => {
    expect(socialLink("instagram", "https://www.instagram.com/netlet.kw")).toBe("https://www.instagram.com/netlet.kw");
    expect(socialLink("x", "https://twitter.com/netlet")).toBe("https://twitter.com/netlet");
    expect(socialLink("snapchat", "https://www.snapchat.com/add/netlet")).toBe("https://www.snapchat.com/add/netlet");
  });

  it("refuses another host, a lookalike, plain http and a bare home page", () => {
    expect(socialLink("instagram", "https://www.tiktok.com/@netlet")).toBeNull();
    expect(socialLink("instagram", "https://instagram.com.evil.example/netlet")).toBeNull();
    expect(socialLink("instagram", "https://notinstagram.com/netlet")).toBeNull();
    expect(socialLink("instagram", "http://instagram.com/netlet")).toBeNull();
    expect(socialLink("instagram", "https://instagram.com/")).toBeNull();
    expect(socialLink("instagram", "javascript:alert(1)")).toBeNull();
    expect(socialLink("instagram", "netlet")).toBeNull();
    expect(socialLink("instagram", "https://user:pass@instagram.com/netlet")).toBeNull();
  });

  it("lists only what is configured, in the footer's order", () => {
    expect(socialLinks({ tiktok: "https://www.tiktok.com/@netlet", instagram: "https://instagram.com/netlet", x: "nonsense" }).map(link => link.platform))
      .toEqual(["instagram", "tiktok"]);
  });
});

describe("companyDetails", () => {
  it("is absent without a name", () => {
    expect(companyDetails({ name: " ", nameAr: "نت لت", licence: "12345", address: "Kuwait City" })).toBeNull();
  });

  it("keeps what was recorded and nulls the blanks", () => {
    expect(companyDetails({ name: "NetLet General Trading Co.", nameAr: "", licence: " 456789 ", address: "" }))
      .toEqual({ name: "NetLet General Trading Co.", nameAr: null, licence: "456789", address: null });
  });
});

describe("displayNumber", () => {
  it("groups a Kuwaiti number the way it is read aloud", () => {
    expect(displayNumber("96550001234")).toBe("+965 5000 1234");
  });

  it("leaves any other number as its digits", () => {
    expect(displayNumber("971501234567")).toBe("+971501234567");
  });
});

describe("nameInSentence", () => {
  it("drops the name's own full stop so the sentence has one", () => {
    expect(nameInSentence("Example Trading Co.")).toBe("Example Trading Co");
    expect(nameInSentence(" NetLet ")).toBe("NetLet");
  });
});

describe("NetLet's own details", () => {
  it("are a number, an address and a place the rules accept", () => {
    expect(supportNumber(NETLET_CONTACT.phone)).toBe("96550808606");
    expect(displayNumber(supportNumber(NETLET_CONTACT.phone)!)).toBe("+965 5080 8606");
    expect(contactEmail(NETLET_CONTACT.email)).toBe("support@netlet.net");
    expect(visitDetails(NETLET_CONTACT.address, NETLET_CONTACT.addressAr)).toEqual({ address: "Kuwait City, Kuwait", addressAr: "مدينة الكويت، الكويت" });
  });
});

describe("visitDetails", () => {
  it("is absent without an address, and the Arabic is optional", () => {
    expect(visitDetails(" ", "مدينة الكويت")).toBeNull();
    expect(visitDetails("Salmiya, Kuwait", "")).toEqual({ address: "Salmiya, Kuwait", addressAr: null });
  });

  it("opens the address on a map", () => {
    expect(mapsLink("Kuwait City, Kuwait")).toBe("https://www.google.com/maps/search/?api=1&query=Kuwait%20City%2C%20Kuwait");
  });
});
