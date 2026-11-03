import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdUntilConnectionsIdle } from "./connectionRelease.js";
import { DB_IDLE_SECONDS } from "../services/db.js";

/*
 * The live shop ran out of its 200 pooled connections because a frozen Vercel
 * instance never closed its idle ones. These hold the fix to its two halves:
 * on Vercel a request keeps the instance awake past the idle timeout, and
 * anywhere else nothing is asked of a request context that is not there.
 */
const CONTEXT = Symbol.for("@vercel/request-context");
const scope = globalThis as unknown as Record<symbol, unknown>;

describe("holdUntilConnectionsIdle", () => {
  const waitUntil = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    waitUntil.mockReset();
    scope[CONTEXT] = { get: () => ({ waitUntil }) };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete scope[CONTEXT];
    vi.unstubAllEnvs();
  });

  it("keeps a Vercel instance awake until the idle timeout has passed since the request closed", async () => {
    vi.stubEnv("VERCEL", "1");
    const response = new EventEmitter();
    holdUntilConnectionsIdle(response);
    expect(waitUntil).toHaveBeenCalledTimes(1);

    let settled = false;
    void (waitUntil.mock.calls[0][0] as Promise<void>).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled, "the hold ends only once the request has closed").toBe(false);

    response.emit("close");
    await vi.advanceTimersByTimeAsync(DB_IDLE_SECONDS * 1000);
    expect(settled, "an idle connection is still open at the idle timeout itself").toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(settled).toBe(true);
  });

  it("asks nothing off Vercel, where a process lives on and closes idle connections itself", () => {
    vi.stubEnv("VERCEL", "");
    holdUntilConnectionsIdle(new EventEmitter());
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
