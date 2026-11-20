import { describe, expect, it } from "vitest";
import { en as firstEn } from "./dictionary.js";
import { laterAr, laterEn } from "./laterMessages.js";
import { askedBy, firstDownload, isPortal, portalFiles, read, serverAndShared, shopWebFiles } from "./messagePlacement.js";
import { portalAr, portalEn } from "./portalMessages.js";

/**
 * Which of the dictionary's three files each word lives in (`messagePlacement.ts`).
 *
 * The cost of a word in the wrong file is a word drawn as its key — the first
 * download, or the shop, asking for a word nothing it has loaded holds — and
 * the cost the other way is every shopper downloading words for nothing,
 * which is how the first download came to carry the whole dictionary: about
 * 340 KB gzipped of which it spelled out a fifth.
 */
const every = [...Object.keys(firstEn), ...Object.keys(laterEn), ...Object.keys(portalEn)];
const first = firstDownload();
const firstFiles = first.filter(file => file.startsWith("Frontend/Web/src/"));
const firstSet = new Set(first);
const laterShop = shopWebFiles().filter(file => !firstSet.has(file));
const portal = portalFiles();
const shared = serverAndShared();

const asksFirst = askedBy([...firstFiles, ...shared], every);
const asksLaterShop = askedBy(laterShop, every);
const asksPortal = askedBy(portal, every);
const asksOutsidePortal = askedBy([...shopWebFiles(), ...shared], every);

const holders = (value: string) => (value.match(/\{(\w+)\}/g) ?? []).sort();

describe("where each word lives", () => {
  it("reads every file it judges", () => {
    /* A guard that finds nothing passes; count what it read. */
    expect(firstFiles.length).toBeGreaterThan(100);
    expect(laterShop.length).toBeGreaterThan(150);
    expect(portal.length).toBeGreaterThan(60);
    expect(shared.length).toBeGreaterThan(300);
    expect(Object.keys(firstEn).length).toBeGreaterThan(1000);
    expect(Object.keys(laterEn).length).toBeGreaterThan(1500);
    expect(Object.keys(portalEn).length).toBeGreaterThan(1500);
  });

  it("puts a word the first download, the shared rules or the server ask for in dictionary.ts, which the first download has", () => {
    expect(Object.keys(laterEn).filter(asksFirst)).toEqual([]);
    expect(Object.keys(portalEn).filter(asksFirst)).toEqual([]);
  });

  it("puts a word only the shop's later pages or the portal ask for out of the first download", () => {
    /* Moved to `laterMessages.ts` — or to `portalMessages.ts` when only the
       portal asks for it. */
    expect(Object.keys(firstEn).filter(key => !asksFirst(key))).toEqual([]);
  });

  it("keeps the portal's words to the portal, which alone loads them", () => {
    expect(Object.keys(portalEn).filter(asksOutsidePortal)).toEqual([]);
    expect(Object.keys(portalEn).filter(key => !asksPortal(key))).toEqual([]);
  });

  it("does not leave a word only the portal asks for in the shop's later words", () => {
    const portalsOnly = Object.keys(laterEn).filter(key => asksPortal(key) && !asksLaterShop(key));
    expect(portalsOnly).toEqual([]);
  });

  it("has each word in one file, in both languages, with the same placeholders", () => {
    const seen = new Map<string, number>();
    for (const key of every) seen.set(key, (seen.get(key) ?? 0) + 1);
    expect([...seen].filter(([, count]) => count > 1).map(([key]) => key)).toEqual([]);
    for (const [english, arabic] of [[laterEn, laterAr], [portalEn, portalAr]] as [Record<string, string>, Record<string, string>][]) {
      for (const key of Object.keys(english)) {
        expect({ key, filled: Boolean(arabic[key]?.trim()), holders: holders(arabic[key] ?? "") })
          .toEqual({ key, filled: true, holders: holders(english[key]) });
      }
    }
  });

  it("never loads the later or the portal's words with the first download", () => {
    const loaded = first.filter(file => /i18n\/(laterMessages|portalMessages|everyMessage)\.ts$/.test(file));
    expect(loaded).toEqual([]);
  });

  it("fetches every later piece of the shop through lazyPage, which waits for the later words", () => {
    /* React's own `lazy` would draw a dialog before its words were here. */
    expect(read("Frontend/Web/src/lib/lazyPage.ts")).toMatch(/Promise\.all\(\[load\(\), laterWords\(\)\]\)/);
    const bare = shopWebFiles().filter(file => !file.endsWith("lib/lazyPage.ts") && /(^|[^\w.])lazy\(/.test(read(file)));
    expect(bare).toEqual([]);
    /* Every fetch of the app's own code from a shop file is a lazyPage's,
       but for three, each for its reason: the demo's answers, which draw no
       words; the later words themselves; and the portal's frame, whose two
       uses are both lazyPage's. */
    const allowed = [/@\/lib\/demoLink/, /^\s*words \?\?= import\("@shared\/i18n\/laterMessages"\)/, /^const loadAdminFrame = \(\) => import\(/];
    const loose = shopWebFiles().flatMap(file => read(file).split("\n")
      .filter(line => /import\(\s*["'](@\/|@shared\/|\.\.?\/)/.test(line) && !/lazyPage\(/.test(line) && !allowed.some(rule => rule.test(line)))
      .map(line => `${file}: ${line.trim()}`));
    expect(loose).toEqual([]);
    const frameUses = read("Frontend/Web/src/App.tsx").split("\n").filter(line => line.includes("loadAdminFrame()"));
    expect(frameUses.length).toBeGreaterThan(0);
    expect(frameUses.filter(line => !/lazyPage/.test(line))).toEqual([]);
  });

  it("loads the portal's words with the portal's frame, and keeps the portal's folders to the portal", () => {
    expect(read("Frontend/Web/src/components/admin/AdminShell.tsx")).toContain('import "@shared/i18n/portalMessages";');
    const reaching = shopWebFiles().filter(file =>
      /^\s*(import|export)\b[^;]*?from\s+["'](@\/(pages|components)\/admin\/|(\.\.\/)+(pages|components)\/admin\/)/m.test(read(file)));
    expect(reaching).toEqual([]);
    expect(portal.every(isPortal)).toBe(true);
  });
});
