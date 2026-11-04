import { describe, expect, it } from "vitest";
import { MAX_PROFILE_PHOTO_BYTES, profilePhotoPath, profilePhotoProblem } from "./profilePhoto.js";

function webp(width: number, height: number, length = 40): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set([..."RIFF"].map(c => c.charCodeAt(0)), 0);
  bytes.set([..."WEBP"].map(c => c.charCodeAt(0)), 8);
  bytes.set([..."VP8X"].map(c => c.charCodeAt(0)), 12);
  const w = width - 1, h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
  return bytes;
}

describe("what a profile photo may be", () => {
  it("takes the square the device makes", () => {
    expect(profilePhotoProblem(webp(512, 512), "image/webp")).toBeNull();
    /* A crop rounded by a pixel is still a square. */
    expect(profilePhotoProblem(webp(512, 511), "image/webp")).toBeNull();
  });

  it("refuses what is not a square, too large, too small or not what it says", () => {
    expect(profilePhotoProblem(webp(800, 600), "image/webp")).toBe("profilePhoto.notSquare");
    expect(profilePhotoProblem(webp(2048, 2048), "image/webp")).toBe("media.tooLarge");
    expect(profilePhotoProblem(webp(512, 512, MAX_PROFILE_PHOTO_BYTES + 1), "image/webp")).toBe("media.tooLarge");
    expect(profilePhotoProblem(webp(200, 200), "image/webp")).toBe("media.tooSmall");
    expect(profilePhotoProblem(webp(512, 512), "image/jpeg")).toBe("media.wrongType");
    expect(profilePhotoProblem(new TextEncoder().encode("<svg></svg>"), "image/webp")).toBe("media.notAnImage");
  });

  it("is read from an address that names the account and the version", () => {
    expect(profilePhotoPath(7, 1793742806345)).toBe("/api/profile/photo/7?v=1793742806345");
  });
});
