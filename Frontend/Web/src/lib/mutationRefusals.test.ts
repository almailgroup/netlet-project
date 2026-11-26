/**
 * A shop's press the server refuses is said, never swallowed. The gift list's
 * "shown as" name and the notifications' email switch were each a mutation
 * with no failure handler at all: a refused save changed nothing and said
 * nothing, which reads as a press that did not take.
 *
 * It reads the source: every mutation the shop's pages, components, hooks and
 * contexts make (`const x = trpc.….useMutation(…)`), and passes one whose
 * refusal is heard — an `onError` in its own options (or in an options object
 * it is handed by name), an `onError` on every send, a `mutateAsync` that is
 * caught, or a page that reads the mutation's `error`. What is left must be a
 * background write named below with the reason nobody needs telling. A guard
 * that finds nothing passes, so it also counts what it read.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..");
const ROOTS = ["components", "pages", "hooks", "contexts", "lib"].map(dir => path.join(SRC, dir));

/** Writes nobody pressed for, or whose refusal is said where this cannot
    see, each with why. */
const BACKGROUND: Record<string, string> = {
  "notifications.markRead": "marks a page read as it is opened; Mark all as read has its own hook that says a refusal",
  "auth.resendCode": "sent beside the code step, which offers Send again itself",
  "customer.profile.update": "syncs the language, the area and the bag's id; the device keeps each anyway",
  "auth.portalPass": "falls back to the plain portal address",
  "ai.catalogSession": "a token for the drafter, handed to a ref whose call is caught and said",
  "ai.chatSession": "a token for the chat, handed to a ref whose call is in a try that offers Try again",
  "commerce.recordView": "counts a product page opened; nobody is told about a count",
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "admin" ? [] : files(full);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

/** The text of a call's parentheses, from just after `(`. */
function argsAt(source: string, start: number): string {
  let depth = 1;
  let at = start;
  while (at < source.length && depth > 0) {
    const char = source[at];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    at += 1;
  }
  return source.slice(start, at - 1);
}

/** Whether options handed over by name carry an `onError`. */
function namedOptionsHandle(source: string, args: string): boolean {
  const named = args.match(/,\s*([A-Za-z_]\w*)\s*\)?\s*$/)?.[1] ?? args.match(/^\s*([A-Za-z_]\w*)\s*$/)?.[1];
  if (!named) return false;
  const definition = source.match(new RegExp(`const ${named}\\s*=[\\s\\S]{0,800}?onError`));
  return Boolean(definition);
}

type Mutation = { file: string; name: string; procedure: string; heard: boolean };

function mutations(): Mutation[] {
  const found: Mutation[] = [];
  for (const file of ROOTS.flatMap(files)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/const (\w+) = trpc\.([\w.]+)\.useMutation\(/g)) {
      const [, name, procedure] = match as unknown as [string, string, string];
      const options = argsAt(source, match.index! + match[0].length);
      let heard = /onError/.test(options) || namedOptionsHandle(source, options);
      if (!heard) {
        if (new RegExp(`\\b${name}\\.(error|isError)\\b`).test(source)) heard = true;
      }
      if (!heard) {
        const sends = [...source.matchAll(new RegExp(`\\b${name}\\.(mutate|mutateAsync)\\(`, "g"))];
        heard = sends.length > 0 && sends.every(send => {
          const args = argsAt(source, send.index! + send[0].length);
          if (/onError/.test(args) || namedOptionsHandle(source, args)) return true;
          if (send[1] !== "mutateAsync") return false;
          const after = source.slice(send.index!, send.index! + args.length + 400);
          const before = source.slice(Math.max(0, send.index! - 400), send.index!);
          /* Caught, or a `.then` with a second, failure handler. */
          return /\.catch\(|\.then\([\s\S]*?,\s*\(?\s*(error|err|e)\b/.test(after) || /\btry\s*\{/.test(before);
        });
      }
      found.push({ file: path.relative(SRC, file), name, procedure, heard });
    }
  }
  return found;
}

describe("a shop's press the server refuses is said", () => {
  const all = mutations();

  it("reads the shop's mutations", () => {
    expect(all.length).toBeGreaterThan(60);
  });

  it("hears every refusal, or names the write as one nobody pressed for", () => {
    const unheard = all
      .filter(mutation => !mutation.heard && !(mutation.procedure in BACKGROUND))
      .map(mutation => `${mutation.file}: ${mutation.name} (${mutation.procedure})`);
    expect(unheard).toEqual([]);
  });

  it("names no background write that is not one", () => {
    const procedures = new Set(all.map(mutation => mutation.procedure));
    expect(Object.keys(BACKGROUND).filter(procedure => !procedures.has(procedure))).toEqual([]);
  });
});
