/**
 * The sitemap and a page's head name the shop's departments and no other —
 * on the owner's word, Grocery has no page while it waits for NetLet
 * Groceries, so neither lists it nor gives its address a head of its own.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./inventory.js", () => ({ publishedCatalog: async () => [] }));
vi.mock("./catalog.js", () => ({ listStoreCards: async () => [], STORE_INDEX_LIMIT: 200, getStorePage: async () => null, getProductByHandle: async () => null }));
vi.mock("./guides.js", () => ({ publishedGuideSlugs: async () => [], publishedGuideBySlug: async () => null }));

describe("the sitemap's departments", () => {
  it("lists every department the shop shows, and never Grocery", async () => {
    const { sitemapEntries } = await import("./sitemap.js");
    const paths = (await sitemapEntries()).map(entry => entry.path);
    expect(paths).toContain("/category/electronics");
    expect(paths).toContain("/category/books-and-stationery");
    expect(paths).not.toContain("/category/grocery");
  });
});

describe("a department page's head", () => {
  it("names a shown department and leaves Grocery's address the plain shell", async () => {
    const { pageWithHead } = await import("./pageShell.js");
    const template = "<html><head><!-- netlet:head --><title>NetLet</title><!-- /netlet:head --></head><body></body></html>";
    const electronics = await pageWithHead(template, "/category/electronics", "https://shop.example");
    expect(electronics).toContain("https://shop.example/category/electronics");
    expect(await pageWithHead(template, "/category/grocery", "https://shop.example")).toBe(template);
  });
});
