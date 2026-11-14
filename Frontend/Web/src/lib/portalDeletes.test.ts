/**
 * Every delete in the portal asks first, on the owner's word ("deleting
 * anything admin/vendor", and of the ways offered, "just ask before
 * deleting"): a delete, a removal, a cancellation, a withdrawal, an ending or
 * a hiding is only ever sent from behind a question — a `ConfirmDialog`'s
 * `onConfirm`, `useConfirmRemoval`'s answer (`sure`), or a dialog of its own.
 *
 * It reads the source: every mutation the portal's pages and components make
 * whose procedure's last name is one of those verbs, and every place it is
 * sent. A guard that finds nothing passes, so it also counts what it read.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["../pages/admin", "../components/admin"].map(dir => path.resolve(import.meta.dirname, dir));
const DESTRUCTIVE = /^(delete|remove\w*|cancel\w*|withdraw|end|hide)$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

type Send = { file: string; line: number; procedure: string; asked: boolean };

function sends(): Send[] {
  const found: Send[] = [];
  for (const file of ROOTS.flatMap(files)) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");
    for (const match of source.matchAll(/const (\w+) = trpc\.([\w.]+)\.useMutation/g)) {
      const [, name, procedure] = match;
      const last = procedure!.split(".").pop()!;
      if (!DESTRUCTIVE.test(last)) continue;
      lines.forEach((text, index) => {
        if (!new RegExp(`\\b${name}\\.mutate(Async)?\\(`).test(text)) return;
        /* The question is on the line or within the four before it: an
           `onConfirm` prop, or the `.then(sure => …)` of an asked question. */
        const window = lines.slice(Math.max(0, index - 4), index + 1).join("\n");
        found.push({
          file: path.relative(path.resolve(import.meta.dirname, ".."), file),
          line: index + 1,
          procedure: procedure!,
          /* A dialog of its own (`DeleteProductDialog`, which asks for the
             product's name to be typed) is the question. */
          asked: /onConfirm|\bsure\b/.test(window) || /Dialog\.tsx$/.test(file),
        });
      });
    }
  }
  return found;
}

describe("a delete in the portal", () => {
  it("is only ever sent from behind a question", () => {
    const all = sends();
    expect(all.length, "the guard read the portal's deletes").toBeGreaterThanOrEqual(17);
    expect(all.filter(send => !send.asked).map(send => `${send.file}:${send.line} ${send.procedure}`)).toEqual([]);
  });
});
