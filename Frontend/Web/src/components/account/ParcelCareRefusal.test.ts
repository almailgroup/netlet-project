import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/* A delivery rating or a damage claim the server could not be reached for
   toasted "Failed to fetch", the browser's words, as it came. */
vi.mock("@/lib/trpc", () => ({ trpc: {} }));
vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => `t:${key}`, tError: (message: string) => `said:${message}`, locale: "en", isArabic: false }),
}));

const { useRefusal } = await import("./ParcelCare");

function refusalFor(message: string) {
  let say: ((key: string) => string) | undefined;
  function Probe() {
    say = useRefusal();
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return say!(message);
}

describe("a parcel's refusal", () => {
  it("never shows the browser's words as they came", () => {
    expect(refusalFor("Failed to fetch")).toBe("said:Failed to fetch");
  });

  it("says a key in words", () => {
    expect(refusalFor("claims.noCourier")).toBe("t:claims.noCourier");
  });
});
