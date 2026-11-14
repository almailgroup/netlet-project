import { describe, expect, it } from "vitest";
import { filsOf, kuwaitPhone, shipmentProblems, updateProblems } from "./shipment.js";

describe("a shipment's details", () => {
  const draft = { senderName: "Dar Home", recipientName: "Fatima", recipientPhone: "+965 5512 3456", governorate: "hawalli", area: "Salmiya", address: "Block 10", pieces: "2", cod: "12.5", expectedOn: "2026-11-16" };

  it("are read as staff typed them", () => {
    expect(shipmentProblems(draft)).toEqual({
      details: { senderName: "Dar Home", recipientName: "Fatima", recipientPhone: "55123456", governorate: "hawalli", area: "Salmiya", address: "Block 10", pieces: 2, codFils: 12_500, expectedOn: "2026-11-16" },
      problems: {},
    });
  });

  it("need a sender and a governorate, and nothing else", () => {
    const { details, problems } = shipmentProblems({ senderName: " ", governorate: "" });
    expect(details).toBeNull();
    expect(problems).toEqual({ senderName: "form.senderNeeded", governorate: "form.governorateNeeded" });
    const least = shipmentProblems({ senderName: "Dar Home", governorate: "jahra" });
    expect(least.details).toEqual({ senderName: "Dar Home", recipientName: null, recipientPhone: null, governorate: "jahra", area: null, address: null, pieces: 1, codFils: null, expectedOn: null });
  });

  it("say each thing that is wrong under its own box", () => {
    const { problems } = shipmentProblems({ ...draft, recipientPhone: "1234", governorate: "riyadh", pieces: "0", cod: "12.5555", expectedOn: "2026-02-30", area: "x".repeat(61) });
    expect(problems).toEqual({ recipientPhone: "form.phoneShape", governorate: "form.governorateNeeded", pieces: "form.piecesShape", cod: "form.amountShape", expectedOn: "form.dayShape", area: "form.tooLong" });
  });

  it("read a Kuwaiti phone and an amount however they are typed", () => {
    expect(kuwaitPhone("00965 9988 7766")).toBe("99887766");
    expect(kuwaitPhone("٩٩٨٨٧٧٦٦")).toBe("99887766");
    expect(kuwaitPhone("12345678")).toBeNull();
    expect(filsOf("12")).toBe(12_000);
    expect(filsOf("0.250")).toBe(250);
    expect(filsOf("١٢٫٥")).toBe(12_500);
    expect(filsOf("1,250.000")).toBe(1_250_000);
    expect(filsOf("-1")).toBeNull();
    expect(filsOf("abc")).toBeNull();
  });

  it("treat nothing to collect as no cash on delivery", () => {
    expect(shipmentProblems({ ...draft, cod: "0" }).details?.codFils).toBeNull();
  });
});

describe("an update", () => {
  const now = new Date("2026-11-14T12:00:00Z");

  it("takes a status, and now when no time is given", () => {
    expect(updateProblems({ status: "picked_up" }, now)).toEqual({ update: { status: "picked_up", location: null, note: null, happenedAt: now, expectedOn: null }, problems: {} });
  });

  it("refuses an unknown status, a time not yet come and a day that is not one", () => {
    const { problems } = updateProblems({ status: "lost", happenedAt: "2026-11-14T13:00:00Z", expectedOn: "2026-13-01" }, now);
    expect(problems).toEqual({ status: "form.statusNeeded", happenedAt: "form.timeFuture", expectedOn: "form.dayShape" });
    expect(updateProblems({ status: "delivered", happenedAt: "2026-11-14T12:05:00Z" }, now).problems).toEqual({});
  });
});
