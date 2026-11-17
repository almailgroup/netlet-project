import { describe, expect, it } from "vitest";
import { failedToLoad } from "./queryState";

describe("failedToLoad", () => {
  it("is false while nothing has failed", () => {
    expect(failedToLoad({ isError: false })).toBe(false);
    expect(failedToLoad({ isError: false, data: [] })).toBe(false);
  });

  it("is true when the first read failed", () => {
    expect(failedToLoad({ isError: true })).toBe(true);
    expect(failedToLoad({ isError: true, data: undefined })).toBe(true);
  });

  it("keeps the answer already drawn when asking again fails", () => {
    expect(failedToLoad({ isError: true, data: { title: "Smart watch" } })).toBe(false);
    /* An answer of nothing is still an answer: a product the server said does not exist. */
    expect(failedToLoad({ isError: true, data: null })).toBe(false);
    expect(failedToLoad({ isError: true, data: [] })).toBe(false);
  });

  it("does not pass another page's placeholder off as this one's answer", () => {
    expect(failedToLoad({ isError: true, data: [1, 2], isPlaceholderData: true })).toBe(true);
    expect(failedToLoad({ isError: false, data: [1, 2], isPlaceholderData: true })).toBe(false);
  });
});

/*
 * The rule is only worth having if a new page follows it, so the shapes that
 * broke it are refused in the source: a render branch on `.isError ? (`, and
 * an error state chosen by `error || !data` or `!data || error`, each of which
 * swapped a page already on screen for its error at the first failed refresh.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

describe("pages keep what they drew when a refresh fails", () => {
  const root = join(__dirname, "..");
  const files = [...sources(join(root, "pages")), ...sources(join(root, "components"))];

  it("reads every page and component", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("draws an error branch through failedToLoad, never on isError or error alone", () => {
    const shapes = [/\.isError\s*\?\s*\(/, /\b\w+\.error\s*\|\|\s*!/, /\|\|\s*\w*\.?error\)\s*(return|\{)/];
    const found = files.flatMap(file =>
      readFileSync(file, "utf8").split("\n").flatMap((line, index) =>
        shapes.some(shape => shape.test(line)) ? [`${file.slice(root.length + 1)}:${index + 1}: ${line.trim()}`] : [],
      ),
    );
    expect(found).toEqual([]);
  });
});
