/**
 * Every act the trail records has words on the audit page.
 *
 * The page falls back to the raw action name when a label is missing, which
 * keeps it from breaking and is also why three of them went unnoticed for so
 * long: "vendor.update" in a list of sentences looks like a typo, not a bug.
 */
import { describe, expect, it } from "vitest";
import { en, ar } from "../shared/i18n/dictionary.js";
import { AUDIT_ACTIONS } from "./audit.js";

describe("the audit trail's words", () => {
  it("names every action in both languages", () => {
    const missing = AUDIT_ACTIONS.filter(action => !(`action.${action}` in en) || !(`action.${action}` in ar));
    expect(missing).toEqual([]);
  });
});
