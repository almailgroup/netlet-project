import { describe, expect, it } from "vitest";
import { kuwaitMobile, phoneProblem, shownPhone } from "./phone";

describe("signing in with a phone number", () => {
  it("reads a Kuwaiti mobile however it is typed", () => {
    expect(kuwaitMobile("50808606")).toBe("+96550808606");
    expect(kuwaitMobile("+965 5080 8606")).toBe("+96550808606");
    expect(kuwaitMobile("0096550808606")).toBe("+96550808606");
    expect(kuwaitMobile("٥٠٨٠٨٦٠٦")).toBe("+96550808606");
    expect(kuwaitMobile("9988-7766")).toBe("+96599887766");
    expect(kuwaitMobile("41234567")).toBe("+96541234567");
    expect(kuwaitMobile("6 123 4567")).toBe("+96561234567");
  });

  it("refuses a landline, a short number and anything abroad", () => {
    expect(kuwaitMobile("22345678")).toBeNull();
    expect(kuwaitMobile("1234567")).toBeNull();
    expect(kuwaitMobile("+966501234567")).toBeNull();
    expect(kuwaitMobile("+447700900123")).toBeNull();
    expect(kuwaitMobile("")).toBeNull();
  });

  it("says what is wrong, as the form and the server both say it", () => {
    expect(phoneProblem("")).toBe("auth.phoneRequired");
    expect(phoneProblem("2234 5678")).toBe("auth.phoneInvalid");
    expect(phoneProblem("5080 8606")).toBeNull();
  });

  it("says a number back to its owner in two fours", () => {
    expect(shownPhone("+96550808606")).toBe("+965 5080 8606");
  });
});
