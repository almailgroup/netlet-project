/**
 * Every procedure the demo build can reach must have a demo answer.
 *
 * `demoLink` throws for an unhandled path, so a procedure added to the router
 * and wired to a button — but not listed there — turns that button into an
 * error in the demo. That is exactly how "New product" came to throw: the
 * procedure existed, the button existed, and nothing compared the two lists.
 *
 * The paths come from tRPC's own registry rather than a regex over the source,
 * because a parser that mis-tracks nesting reports the wrong names and a guard
 * that lies is worse than no guard.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appRouter } from "../routers.js";

const ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * Procedures the demo never reaches, with the reason.
 *
 * Auth is the storefront's own path and `demoLink` answers what it needs;
 * `search.refine` requires a Mistral key and falls back to local filtering by
 * design, which is behaviour worth keeping in the demo rather than faking.
 */
const NOT_IN_DEMO = new Set([
  "auth.login",
  "auth.register",
  // Registering needs a server to send the code and take it back.
  "auth.verifyEmail",
  "auth.resendCode",
  "auth.logout",
  // The demo has no backend and no mail: there is nothing to send from.
  "auth.requestPasswordReset",
  "auth.me",
  "search.refine",
]);

describe("demo mode", () => {
  it("answers every procedure it can be asked", () => {
    const demo = readFileSync(path.join(ROOT, "client/src/lib/demoLink.ts"), "utf-8");
    const exposed = Object.keys((appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures);

    expect(exposed.length).toBeGreaterThan(20);

    const missing = exposed
      .filter(name => !NOT_IN_DEMO.has(name))
      .filter(name => !demo.includes(`"${name}"`));

    expect(missing).toEqual([]);
  });
});
