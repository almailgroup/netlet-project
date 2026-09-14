import { describe, expect, it } from "vitest";
import {
  ATTEMPT_WINDOW_MS,
  MAX_FAILURES_PER_ACCOUNT,
  MAX_FAILURES_PER_ADDRESS,
  limitVerdict,
  strictest,
} from "./rateLimit.js";

const NOW = new Date("2026-09-14T12:00:00.000Z");
const agoMs = (ms: number) => new Date(NOW.getTime() - ms);
const minutes = (n: number) => n * 60_000;

describe("limitVerdict", () => {
  it("allows anything below the ceiling", () => {
    const failures = Array.from({ length: 9 }, () => agoMs(minutes(1)));
    expect(limitVerdict(failures, 10, NOW)).toEqual({ allowed: true });
  });

  it("refuses at the ceiling", () => {
    const failures = Array.from({ length: 10 }, () => agoMs(minutes(1)));
    expect(limitVerdict(failures, 10, NOW).allowed).toBe(false);
  });

  it("ignores failures that have aged out of the window", () => {
    const stale = Array.from({ length: 50 }, () => agoMs(ATTEMPT_WINDOW_MS + minutes(1)));
    expect(limitVerdict(stale, 10, NOW)).toEqual({ allowed: true });
  });

  /*
   * The point of the whole design: waiting has to work. A lockout measured
   * from the most recent attempt never expires for anyone who keeps trying,
   * which turns a throttle into a permanent lock needing a human to undo.
   */
  it("counts down from the oldest failure still in the window", () => {
    const failures = [agoMs(minutes(14)), ...Array.from({ length: 9 }, () => agoMs(minutes(1)))];
    const verdict = limitVerdict(failures, 10, NOW);
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    // One minute left of that first failure's fifteen.
    expect(verdict.retryAfterSeconds).toBe(60);
  });

  it("never reports a wait of zero, which reads as 'try again now'", () => {
    const failures = Array.from({ length: 10 }, () => agoMs(ATTEMPT_WINDOW_MS - 1));
    const verdict = limitVerdict(failures, 10, NOW);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("frees up as soon as one failure expires, not only when all do", () => {
    const failures = [
      agoMs(minutes(14)),
      ...Array.from({ length: 9 }, () => agoMs(minutes(2))),
    ];
    expect(limitVerdict(failures, 10, NOW).allowed).toBe(false);
    const oneMinuteLater = new Date(NOW.getTime() + minutes(1) + 1000);
    expect(limitVerdict(failures, 10, oneMinuteLater)).toEqual({ allowed: true });
  });
});

describe("strictest", () => {
  it("lets a refusal beat an allowance either way round", () => {
    const no = { allowed: false, retryAfterSeconds: 30 } as const;
    expect(strictest({ allowed: true }, no)).toEqual(no);
    expect(strictest(no, { allowed: true })).toEqual(no);
  });

  it("keeps the longer wait when both refuse", () => {
    const short = { allowed: false, retryAfterSeconds: 30 } as const;
    const long = { allowed: false, retryAfterSeconds: 600 } as const;
    expect(strictest(short, long)).toEqual(long);
    expect(strictest(long, short)).toEqual(long);
  });
});

describe("the thresholds themselves", () => {
  /*
   * If the address ceiling were at or below the account ceiling, one person
   * failing to sign in would lock out their whole office — the exact failure
   * the two-key design exists to avoid.
   */
  it("lets an address absorb more failures than any one account", () => {
    expect(MAX_FAILURES_PER_ADDRESS).toBeGreaterThan(MAX_FAILURES_PER_ACCOUNT);
  });
});
