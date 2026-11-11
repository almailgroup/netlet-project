import { describe, expect, it } from "vitest";
import { DEVICE_STATES, deviceActive, deviceAuditAction, deviceLabel, deviceMove, deviceNameFrom, isBlocked, isDeviceToken, moveOf, statesFor } from "./adminDevice";

describe("a device secret", () => {
  it("is long, random and URL-safe", () => {
    expect(isDeviceToken("a".repeat(43))).toBe(true);
    expect(isDeviceToken("A-_9".repeat(16))).toBe(true);
    expect(isDeviceToken("a".repeat(42))).toBe(false);
    expect(isDeviceToken("a".repeat(129))).toBe(false);
    expect(isDeviceToken("a".repeat(42) + "=")).toBe(false);
    expect(isDeviceToken(42)).toBe(false);
    expect(isDeviceToken(null)).toBe(false);
  });
});

describe("a device's name", () => {
  it("is the browser and the system", () => {
    expect(deviceNameFrom("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(deviceNameFrom("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0")).toBe("Edge on Windows");
    expect(deviceNameFrom("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15")).toBe("Safari on Mac");
    expect(deviceNameFrom("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(deviceNameFrom("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1")).toBe("Chrome on iPhone");
    expect(deviceNameFrom("Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0")).toBe("Firefox on Linux");
    expect(deviceNameFrom("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36")).toBe("Chrome on Android");
  });

  it("names the app", () => {
    expect(deviceNameFrom("NetLet/1.0 (iPhone; iOS 26.0) NetLetApp")).toBe("NetLet app on iPhone");
    expect(deviceNameFrom("NetLet/1.0 (iPad; iOS 26.0)")).toBe("NetLet app on iPad");
  });

  it("says when it cannot tell", () => {
    expect(deviceNameFrom("")).toBe("Unknown device");
    expect(deviceNameFrom(undefined)).toBe("Unknown device");
    expect(deviceNameFrom("curl/8.4.0")).toBe("Unknown device");
  });

  it("is trimmed and cut to the column when the owner names it", () => {
    expect(deviceLabel("  Office   PC ")).toBe("Office PC");
    expect(deviceLabel("   ")).toBeNull();
    expect(deviceLabel("x".repeat(100))).toHaveLength(80);
  });
});

describe("what the owner decides about a device", () => {
  it("authorises one that waits or is blocked, and not one already authorised", () => {
    expect(deviceMove("pending", "approve")).toBe("approved");
    expect(deviceMove("denied", "approve")).toBe("approved");
    expect(deviceMove("revoked", "approve")).toBe("approved");
    expect(deviceMove("approved", "approve")).toBeNull();
  });

  it("blocks one that waits or is authorised, keeping which it was", () => {
    expect(deviceMove("pending", "block")).toBe("denied");
    expect(deviceMove("approved", "block")).toBe("revoked");
    expect(deviceMove("denied", "block")).toBeNull();
    expect(deviceMove("revoked", "block")).toBeNull();
    expect(isBlocked("denied")).toBe(true);
    expect(isBlocked("revoked")).toBe(true);
    expect(isBlocked("pending")).toBe(false);
    expect(isBlocked("approved")).toBe(false);
  });

  it("removes one from the list whatever it was", () => {
    for (const state of DEVICE_STATES) expect(deviceMove(state, "remove")).toBe("removed");
    expect(statesFor("remove")).toEqual([...DEVICE_STATES]);
  });

  it("reads the older names as blocking", () => {
    expect(moveOf("deny")).toBe("block");
    expect(moveOf("revoke")).toBe("block");
    expect(deviceMove("pending", "deny")).toBe("denied");
    expect(deviceMove("approved", "revoke")).toBe("revoked");
    expect(statesFor("block")).toEqual(["pending", "approved"]);
    expect(statesFor("approve")).toEqual(["pending", "denied", "revoked"]);
  });

  it("names each decision for the trail by what it found", () => {
    expect(deviceAuditAction("pending", "approve")).toBe("device.approve");
    expect(deviceAuditAction("approved", "block")).toBe("device.block");
    expect(deviceAuditAction("pending", "deny")).toBe("device.block");
    expect(deviceAuditAction("approved", "remove")).toBe("device.remove");
    expect(deviceAuditAction("pending", "remove")).toBe("device.decline");
    expect(deviceAuditAction("denied", "remove")).toBe("device.unblock");
    expect(deviceAuditAction("revoked", "remove")).toBe("device.unblock");
  });

  it("calls a device active only while it was seen in the last five minutes", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    expect(deviceActive(new Date("2026-11-11T11:57:00Z"), now)).toBe(true);
    expect(deviceActive("2026-11-11T11:55:01Z", now)).toBe(true);
    expect(deviceActive(new Date("2026-11-11T11:54:59Z"), now)).toBe(false);
    expect(deviceActive(null, now)).toBe(false);
    expect(deviceActive("not a date", now)).toBe(false);
  });
});
