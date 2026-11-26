import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let locale: "en" | "ar" = "en";
vi.mock("@/contexts/CustomerContext", () => ({
  useCustomer: () => ({ locale, direction: locale === "ar" ? "rtl" : "ltr", isArabic: locale === "ar" }),
}));
vi.mock("@/hooks/useDisplayCurrency", () => ({ useShownCurrency: () => null }));

const { useTranslation } = await import("./useTranslation");

function said(message: string): string {
  function Line() {
    const { tError } = useTranslation();
    return createElement("p", null, tError(message));
  }
  return renderToStaticMarkup(createElement(Line)).replace(/<\/?p>/g, "").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
}

describe("tError", () => {
  /* A shopper read "Unexpected token 'd', "down" is not valid JSON" under
     the help centre's answer when the server answered with no JSON. */
  it("says a transport failure in words, in the shopper's language", () => {
    locale = "en";
    expect(said(`Unexpected token 'd', "down" is not valid JSON`)).toBe("NetLet could not be reached. Try again in a moment.");
    expect(said("Failed to fetch")).toBe("NetLet could not be reached. Try again in a moment.");
    locale = "ar";
    expect(said("Load failed")).toBe("تعذّر الوصول إلى نت‑لت. حاول مرة أخرى بعد قليل.");
  });

  it("translates a key and leaves the server's own sentence alone", () => {
    locale = "en";
    expect(said("error.serverProblem")).toBe("Something went wrong on our side. Please try again.");
    expect(said("That code has already been used.")).toBe("That code has already been used.");
  });

  it("never draws a blank line for an empty message", () => {
    locale = "en";
    expect(said("")).toBe("Something went wrong on our side. Please try again.");
  });
});
