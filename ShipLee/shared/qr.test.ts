import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { qrMatrix, qrPath } from "./qr.js";

/** The code drawn as a picture, black on white with its quiet zone, `scale` pixels a module. */
function picture(matrix: boolean[][], scale = 4, quiet = 4) {
  const size = (matrix.length + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  matrix.forEach((row, y) => row.forEach((dark, x) => {
    if (!dark) return;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const at = (((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx) * 4;
      data[at] = data[at + 1] = data[at + 2] = 0;
    }
  }));
  return { data, size };
}

describe("the label's QR code", () => {
  it("reads back as the tracking page's address", () => {
    for (const text of ["https://shiplee.delivery/track/SL4820619379", "https://shiplee.delivery/track/SL9173402588", "http://localhost:5090/track/SL2658194705"]) {
      const { data, size } = picture(qrMatrix(text));
      expect(jsQR(data, size, size)?.data).toBe(text);
    }
  });

  it("draws each row's dark run as one rectangle", () => {
    const matrix = [[true, true, false, true], [false, false, false, false]];
    expect(qrPath(matrix, 1)).toBe("M1 1h2v1h-2zM4 1h1v1h-1z");
  });
});
