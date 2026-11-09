import { describe, expect, it } from "vitest";
import { deviceLabel, deviceNameFrom, isDeviceToken } from "./adminDevice";

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
