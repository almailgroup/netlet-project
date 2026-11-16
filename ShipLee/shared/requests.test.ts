import { describe, expect, it } from "vitest";
import { MAX_DETAILS, readAddress, readProblem, readReschedule, requestLinks, requestMessage, rescheduleDays } from "./requests.js";

const today = "2026-11-16";

describe("a customer's requests about a parcel", () => {
  it("offers the six days from tomorrow", () => {
    expect(rescheduleDays(today)).toEqual(["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
  });

  it("says what a reschedule is missing, under each box", () => {
    expect(readReschedule({ day: "", slot: "", note: "" }, today)).toEqual({ ok: false, problems: { day: "req.dayNeeded", slot: "req.slotNeeded" } });
    /* A day already gone, or too far ahead, is not one of the days offered. */
    expect(readReschedule({ day: today, slot: "morning", note: "" }, today).ok).toBe(false);
    expect(readReschedule({ day: "2026-12-30", slot: "morning", note: "" }, today).ok).toBe(false);
    expect(readReschedule({ day: "2026-11-18", slot: "evening", note: "  Call first  " }, today)).toEqual({ ok: true, request: { kind: "reschedule", day: "2026-11-18", slot: "evening", note: "Call first" } });
  });

  it("needs a real governorate, an area and an address to change the address", () => {
    expect(readAddress({ governorate: "atlantis", area: " ", address: "", note: "" })).toEqual({ ok: false, problems: { governorate: "form.governorateNeeded", area: "req.areaNeeded", address: "req.addressNeeded" } });
    expect(readAddress({ governorate: "hawalli", area: "Salmiya", address: "Block 10, Street 4, House 12", note: "" }).ok).toBe(true);
  });

  it("asks for more than a word about a problem, and not an essay", () => {
    expect(readProblem({ problem: "", details: "bad" })).toEqual({ ok: false, problems: { problem: "req.problemNeeded", details: "req.detailsShort" } });
    expect(readProblem({ problem: "damaged", details: "x".repeat(MAX_DETAILS + 1) })).toEqual({ ok: false, problems: { details: "form.tooLong" } });
    expect(readProblem({ problem: "damaged", details: "The box was crushed on one side." }).ok).toBe(true);
  });

  it("writes the tracking number into the message's first line, in either language", () => {
    const request = readReschedule({ day: "2026-11-18", slot: "morning", note: "" }, today);
    if (!request.ok) throw new Error("expected a request");
    const english = requestMessage("en", "SL4820619379", request.request).split("\n");
    expect(english[0]).toContain("SL4820619379");
    expect(english[1]).toContain("Wednesday 18 November");
    const arabic = requestMessage("ar", "SL4820619379", request.request).split("\n");
    expect(arabic[0]).toContain("SL4820619379");
    expect(arabic[1]).toContain("صباحاً");
  });

  it("goes to WhatsApp with the message in, or to an email with its subject, only where the deployment names them", () => {
    const request = readProblem({ problem: "late", details: "It was due yesterday." });
    if (!request.ok) throw new Error("expected a request");
    const links = requestLinks({ whatsapp: "96512345678", email: null }, "en", "SL4820619379", request.request);
    expect(links.email).toBeNull();
    expect(links.whatsapp).toMatch(/^https:\/\/wa\.me\/96512345678\?text=/);
    expect(decodeURIComponent(links.whatsapp!.split("text=")[1]!)).toContain("It's late");
    const mail = requestLinks({ whatsapp: null, email: "help@shiplee.delivery" }, "en", "SL4820619379", request.request).email!;
    expect(mail).toContain("subject=Problem%20with%20parcel%20SL4820619379");
  });
});
