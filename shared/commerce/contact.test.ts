import { describe, expect, it } from "vitest";
import { companyDetails, contactEmail, displayNumber, nameInSentence, socialLink, socialLinks } from "./contact.js";

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
