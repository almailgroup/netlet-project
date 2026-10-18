import { describe, expect, it } from "vitest";
import { CODE_LENGTH, isCodeShaped, normaliseCode } from "./emailCode";

describe("reading a typed code", () => {
  it("keeps six ASCII digits as they are", () => {
    expect(normaliseCode("482913")).toBe("482913");
    expect(isCodeShaped("482913")).toBe(true);
  });

  it("reads Arabic-Indic and extended Arabic-Indic digits as digits", () => {
    expect(normaliseCode("٤٨٢٩١٣")).toBe("482913");
    expect(normaliseCode("۴۸۲۹۱۳")).toBe("482913");
  });

  it("drops the spaces, dashes and invisible marks a pasted code carries", () => {
    expect(normaliseCode(" 482 913 ")).toBe("482913");
    expect(normaliseCode("482-913")).toBe("482913");
    expect(normaliseCode("‏482913‎")).toBe("482913");
  });

  it("never holds more than the code's length", () => {
    expect(normaliseCode("4829131234")).toHaveLength(CODE_LENGTH);
  });

  it("is not a code until every digit is there", () => {
    expect(isCodeShaped("48291")).toBe(false);
    expect(isCodeShaped("")).toBe(false);
    expect(isCodeShaped("48291a")).toBe(false);
  });
});
