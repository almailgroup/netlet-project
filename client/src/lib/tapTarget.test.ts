/**
 * `.tap-target` grows a small control's hit area to 44px. It is centred with
 * `left`/`top: 50%`, and must stay that way.
 *
 * It was `inset: 50%` with a fixed width, which over-constrains the box: with
 * both `left` and `right` set, the browser keeps the start side of the writing
 * direction and drops the other. In English that is `left` and it centred; in
 * Arabic it is `right`, and every enlarged hit area on the site sat beside its
 * control rather than around it — found because one of them poked 8px past the
 * edge of a phone screen and made the product editor scroll sideways.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(import.meta.dirname, "../index.css"), "utf-8");

describe(".tap-target", () => {
  const rule = /\.tap-target::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

  it("exists", () => {
    expect(rule).not.toBe("");
  });

  it("is centred physically, which is the same in both directions", () => {
    expect(rule).toMatch(/left:\s*50%/);
    expect(rule).toMatch(/top:\s*50%/);
    expect(rule).toMatch(/translate\(-50%,\s*-50%\)/);
  });

  it("never sets both inline sides, which a fixed width over-constrains in RTL", () => {
    expect(rule).not.toMatch(/\binset\s*:/);
    expect(rule).not.toMatch(/\bright\s*:/);
    expect(rule).not.toMatch(/inset-inline/);
  });
});
