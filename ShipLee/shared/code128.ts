/**
 * Code 128, the barcode on a ShipLee label: the tracking number, as a
 * scanner at a hub or in a driver's hand reads it.
 *
 * Written here rather than drawn by a library because the label is an SVG the
 * page builds from React — a library that writes `style` attributes is refused
 * by ShipLee's security policy — and because the whole of Code 128 is a table
 * and a checksum. `code128.test.ts` holds every pattern in the table against
 * jsbarcode's, so a slip in a copied digit fails the test rather than a scan.
 *
 * A number is set B for its letters and C for its digits, two to a symbol:
 * "SL" and ten digits is start, two letters, a switch, five pairs, the check
 * and stop — narrower than all-B, which matters on a 100 mm label.
 */

/** Each symbol's bar and space widths, bar first, in modules. 103–105 start A, B and C; 106 is stop. */
export const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
] as const;

const START_B = 104;
const START_C = 105;
const TO_C = 99;
const TO_B = 100;
const STOP = 106;

export type Mode = "auto" | "B" | "C";

/** Characters set B can carry: printable ASCII. */
export function encodable(text: string): boolean {
  return text.length > 0 && /^[\x20-\x7e]+$/.test(text);
}

/** The symbol values for `text`, start and check included, stop excluded. */
export function symbols(text: string, mode: Mode = "auto"): number[] {
  if (!encodable(text)) throw new Error("Code 128 carries printable ASCII only");
  if (mode === "C" && !/^(\d\d)+$/.test(text)) throw new Error("Set C carries pairs of digits only");
  const values: number[] = [];
  const digitsAt = (i: number) => /^\d*/.exec(text.slice(i))![0].length;
  let i = 0;
  let set: "B" | "C" = mode === "C" || (mode === "auto" && digitsAt(0) >= 4 && digitsAt(0) % 2 === 0) ? "C" : "B";
  values.push(set === "C" ? START_C : START_B);
  while (i < text.length) {
    const run = digitsAt(i);
    if (set === "B" && mode === "auto" && run >= 4) {
      values.push(TO_C);
      set = "C";
    } else if (set === "C" && run < 2) {
      values.push(TO_B);
      set = "B";
    }
    if (set === "C") {
      values.push(Number(text.slice(i, i + 2)));
      i += 2;
    } else {
      values.push(text.charCodeAt(i) - 32);
      i += 1;
    }
  }
  const check = values.reduce((sum, value, index) => sum + value * Math.max(index, 1), 0) % 103;
  values.push(check);
  return values;
}

/** The barcode as modules, "1" a bar and "0" a space, from the start through the stop. */
export function modules(text: string, mode: Mode = "auto"): string {
  let out = "";
  for (const value of [...symbols(text, mode), STOP]) {
    const widths = PATTERNS[value]!;
    for (let k = 0; k < widths.length; k++) out += (k % 2 === 0 ? "1" : "0").repeat(Number(widths[k]));
  }
  return out;
}

/** The bars as runs: where each starts and how wide it is, in modules, for drawing. */
export function bars(text: string, mode: Mode = "auto"): { x: number; width: number }[] {
  const line = modules(text, mode);
  const runs: { x: number; width: number }[] = [];
  for (let x = 0; x < line.length; ) {
    if (line[x] === "0") {
      x++;
      continue;
    }
    let width = 0;
    while (line[x + width] === "1") width++;
    runs.push({ x, width });
    x += width;
  }
  return runs;
}
