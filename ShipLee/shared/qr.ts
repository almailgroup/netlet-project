/**
 * The QR code on a ShipLee label: the parcel's tracking page, so anybody
 * holding the box — the recipient, a neighbour, a driver — can open it with a
 * phone's camera. qrcode-generator does the encoding (Reed–Solomon and masks
 * are not a thing to write twice); the label draws the squares itself, as an
 * SVG path, for the barcode's reason. `qr.test.ts` reads the result back with
 * jsQR, a decoder written by somebody else.
 */
import qrcode from "qrcode-generator";

/** The dark modules, row by row. Level M: a label survives a scuff or a fold. */
export function qrMatrix(text: string): boolean[][] {
  const code = qrcode(0, "M");
  code.addData(text, "Byte");
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => code.isDark(row, col)));
}

/** The dark modules as one SVG path, one unit square each, offset by the quiet zone. */
export function qrPath(matrix: boolean[][], quiet = 4): string {
  let path = "";
  matrix.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (!row[x]) {
        x++;
        continue;
      }
      let run = 0;
      while (row[x + run]) run++;
      path += `M${x + quiet} ${y + quiet}h${run}v1h-${run}z`;
      x += run;
    }
  });
  return path;
}
