import { describe, expect, it } from "vitest";
import { DEFAULT_RETURN_PATH, returnPath } from "./returnPath";

describe("returnPath", () => {
  it.each(["/checkout", "/account/orders?order=NL-20261012-QRTVW", "/products/smart-watch#reviews", "/"])("keeps %s", path => {
    expect(returnPath(path)).toBe(path);
  });

  it.each([
    null,
    "",
    "account",
    "https://evil.example/",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "\n//evil.example",
    "javascript:alert(1)",
    "/signin",
    "/signup?next=/checkout",
    "/LOGIN",
  ])("sends %j to the account instead", raw => {
    expect(returnPath(raw)).toBe(DEFAULT_RETURN_PATH);
  });
});
