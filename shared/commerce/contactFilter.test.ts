/**
 * Keeping a conversation on NetLet (3.8).
 *
 * Two lists, and both are the requirement: the ways people actually write a
 * number or an address to get round a filter, and the ordinary messages a
 * filter must not refuse — a filter that refuses "I need two by Thursday" is
 * one people learn to route around.
 */
import { describe, expect, it } from "vitest";
import { contactFindings, isOnPlatform, normaliseForContact } from "./contactFilter.js";

describe("phone numbers", () => {
  it.each([
    "call me on 99887766",
    "+965 9988 7766",
    "00965 99887766",
    "99 88 77 66",
    "9988-7766",
    "99.88.77.66",
    "9-9-8-8-7-7-6-6",
    "(9988) 7766",
    "٩٩٨٨٧٧٦٦",
    "رقمي ٩٩٨٨ ٧٧٦٦",
    "۹۹۸۸۷۷۶۶",
    "nine nine eight eight seven seven six six",
    "9 nine 8 eight 7 seven 6 six",
    "تسعة تسعة ثمانية ثمانية سبعة سبعة ستة ستة",
    "خمسة وخمسة وستة وستة وسبعة وسبعة وثمانية وثمانية",
    "９９８８７７６６",
    "+44 20 7946 0958",
    "9988/77/66",
  ])("catches %s", text => {
    expect(contactFindings(text)).toContain("phone");
  });
});

describe("email addresses", () => {
  it.each([
    "noura@gmail.com",
    "noura @ gmail . com",
    "noura at gmail dot com",
    "noura (at) gmail (dot) com",
    "noura [at] gmail [dot] com",
    "n o u r a @ g m a i l . c o m",
    "NOURA@GMAIL.COM",
    "noura آت gmail نقطة com",
    "my gmail is noura1990",
    "send it to my hotmail",
  ])("catches %s", text => {
    expect(contactFindings(text)).toContain("email");
  });

  /* An address is one finding, not an address and a link. */
  it("reports an address as an address, not also as a link", () => {
    expect(contactFindings("noura@gmail.com")).toEqual(["email"]);
  });
});

describe("links", () => {
  it.each([
    "https://example.com/deal",
    "www.cheaper-sofas.com",
    "cheaper-sofas.com",
    "wa.me/96599887766",
    "wa dot me slash 96599887766",
    "t.me/noura_shop",
    "bit.ly/abc123",
    "my shop is sofas.kw",
  ])("catches %s", text => {
    expect(contactFindings(text)).toContain("link");
  });
});

describe("handles on other platforms", () => {
  it.each([
    "follow @noura.shop",
    "add me on whatsapp",
    "Whats App me",
    "dm me on insta",
    "my instagram is noura",
    "snapchat: noura",
    "telegram please",
    "كلمني واتساب",
    "على الواتس",
    "تابعني انستا",
    "سنابي noura",
    "تيك توك",
  ])("catches %s", text => {
    expect(contactFindings(text)).toContain("handle");
  });
});

describe("ordinary messages", () => {
  it.each([
    "Hello, is the sofa still available?",
    "I need two by Thursday.",
    "Can you do one, two or three cushions?",
    "It was KWD 12,500.000 at the other shop",
    "السعر 12,500.000 د.ك",
    "My order is NL-20260915-QRTVW and it has not arrived",
    "It was delivered on 2026-09-15",
    "delivered 15/09/2026, box was fine",
    "The lamp is 45 cm tall and weighs 1500 g",
    "I'll be at home after 5. Thanks!",
    "Meet at the shop. Come early",
    "هل يتوفر باللون الأزرق؟ أحتاج اثنين",
    "Is it compatible with model 7840?",
    "The install guide says insert the battery first",
    "Grade A, 100% cotton, 3 sizes",
    "Thanks — 5 stars from me",
    "Email confirmation came through, thank you",
  ])("lets through %s", text => {
    expect(contactFindings(text)).toEqual([]);
    expect(isOnPlatform(text)).toBe(true);
  });
});

describe("what it reports", () => {
  it("names every kind it found, in a fixed order", () => {
    expect(contactFindings("whatsapp 99887766 or noura@gmail.com or sofas.com")).toEqual(["phone", "email", "link", "handle"]);
  });

  it("reads Arabic-Indic digits and spelled numbers as digits", () => {
    expect(normaliseForContact("٩٩ nine")).toBe("99 9");
  });
});
