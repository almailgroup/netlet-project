import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  acceptableImageUrl,
  contentBox,
  isMediaPath,
  levelsFor,
  levelsTable,
  mediaPath,
  sniffImage,
  squareAround,
  uniformBackground,
  uploadProblem,
} from "./media.js";

/** A minimal baseline JPEG header: SOI, an APP0 segment, and a SOF0 giving the size. */
function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
}

/** A VP8X WebP header, which states width − 1 and height − 1 in 24 bits each. */
function webp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set([..."RIFF"].map(c => c.charCodeAt(0)), 0);
  bytes.set([..."WEBP"].map(c => c.charCodeAt(0)), 8);
  bytes.set([..."VP8X"].map(c => c.charCodeAt(0)), 12);
  const w = width - 1, h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
  return bytes;
}

describe("what a file is", () => {
  it("reads a JPEG's and a WebP's size from their own headers", () => {
    expect(sniffImage(jpeg(1200, 900))).toEqual({ type: "image/jpeg", width: 1200, height: 900 });
    expect(sniffImage(webp(1200, 1200))).toEqual({ type: "image/webp", width: 1200, height: 1200 });
  });

  it("knows a PNG, an SVG and a text file are not what it stores", () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
  });

  it("refuses a file whose bytes disagree with its declared type, and one too small or too heavy", () => {
    expect(uploadProblem(jpeg(1200, 900), "image/jpeg")).toBeNull();
    expect(uploadProblem(jpeg(1200, 900), "image/webp")).toBe("media.wrongType");
    expect(uploadProblem(jpeg(200, 150), "image/jpeg")).toBe("media.tooSmall");
    expect(uploadProblem(new Uint8Array(MAX_UPLOAD_BYTES + 1), "image/jpeg")).toBe("media.tooLarge");
    expect(uploadProblem(new Uint8Array(100), "image/jpeg")).toBe("media.notAnImage");
  });
});

describe("where it is served", () => {
  it("is a path NetLet serves, accepted beside an ordinary https URL", () => {
    const path = mediaPath("AbCdEfGhIjKlMnOpQrStUvWx", "image/webp");
    expect(path).toBe("/media/AbCdEfGhIjKlMnOpQrStUvWx.webp");
    expect(isMediaPath(path)).toBe(true);
    expect(acceptableImageUrl(path)).toBe(true);
    expect(acceptableImageUrl("https://cdn.example.com/a.jpg")).toBe(true);
    expect(acceptableImageUrl("/media/../../etc/passwd")).toBe(false);
    expect(acceptableImageUrl("javascript:alert(1)")).toBe(false);
    expect(acceptableImageUrl("/elsewhere/a.jpg")).toBe(false);
  });
});

/** A width × height RGBA frame of one colour with a coloured block inside. */
function frame(width: number, height: number, background: number[], block?: { x: number; y: number; w: number; h: number; colour: number[] }) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = block && x >= block.x && x < block.x + block.w && y >= block.y && y < block.y + block.h;
      const colour = inside ? block.colour : background;
      data.set([...colour, 255], (y * width + x) * 4);
    }
  }
  return data;
}

describe("the fixes", () => {
  it("finds a uniform background and the product inside it", () => {
    const data = frame(200, 100, [245, 245, 245], { x: 120, y: 30, w: 40, h: 50, colour: [40, 60, 90] });
    const background = uniformBackground(data, 200, 100);
    expect(background).toEqual([245, 245, 245]);
    const box = contentBox(data, 200, 100, background!);
    expect(box).toEqual({ x: 119, y: 29, width: 42, height: 52 });
    expect(squareAround(box!)).toBe(60);
  });

  it("does not claim a border on a photo whose corners disagree", () => {
    const data = frame(100, 100, [245, 245, 245], { x: 0, y: 0, w: 30, h: 30, colour: [20, 20, 20] });
    expect(uniformBackground(data, 100, 100)).toBeNull();
  });

  it("finds nothing in a blank frame", () => {
    const data = frame(50, 50, [255, 255, 255]);
    expect(contentBox(data, 50, 50, [255, 255, 255])).toBeNull();
  });

  it("stretches a flat photo, gently, and leaves a full-range one alone", () => {
    const flat = new Array(256).fill(0);
    for (let v = 60; v <= 190; v++) flat[v] = 10;
    /* Capped: the black point no higher than 40, the white no lower than 215. */
    expect(levelsFor(flat, 131 * 10)).toEqual({ low: 40, high: 215 });
    const slightly = new Array(256).fill(0);
    for (let v = 30; v <= 230; v++) slightly[v] = 10;
    /* Inside the caps the points are the measured ones, after the half-percent clip. */
    expect(levelsFor(slightly, 201 * 10)).toEqual({ low: 31, high: 229 });
    const full = new Array(256).fill(10);
    expect(levelsFor(full, 2560)).toBeNull();
    const table = levelsTable(60, 190);
    expect([table[60], table[190], table[0], table[255]]).toEqual([0, 255, 0, 255]);
  });
});
