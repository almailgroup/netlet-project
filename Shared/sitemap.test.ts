import { describe, expect, it } from "vitest";
import { joinUrl, robotsTxt, sitemapXml } from "./sitemap.js";

describe("joinUrl", () => {
  it("leaves exactly one slash between origin and path", () => {
    expect(joinUrl("https://netlet.net", "/products/x")).toBe("https://netlet.net/products/x");
    expect(joinUrl("https://netlet.net/", "/products/x")).toBe("https://netlet.net/products/x");
    expect(joinUrl("https://netlet.net//", "products/x")).toBe("https://netlet.net/products/x");
  });

  it("keeps the site root as a bare slash", () => {
    expect(joinUrl("https://netlet.net", "/")).toBe("https://netlet.net/");
  });
});

describe("sitemapXml", () => {
  it("writes one absolute loc per entry", () => {
    const xml = sitemapXml("https://netlet.net", [{ path: "/" }, { path: "/category/beauty" }]);
    expect(xml).toContain("<loc>https://netlet.net/</loc>");
    expect(xml).toContain("<loc>https://netlet.net/category/beauty</loc>");
    expect(xml.match(/<url>/g)).toHaveLength(2);
  });

  it("dates a lastmod to the day, since a sitemap has no use for a clock", () => {
    const xml = sitemapXml("https://netlet.net", [
      { path: "/products/a", lastModified: new Date("2026-09-14T07:41:22.000Z") },
    ]);
    expect(xml).toContain("<lastmod>2026-09-14</lastmod>");
  });

  /*
   * A row can carry a null or malformed timestamp, and a `<lastmod>Invalid
   * Date</lastmod>` is a parse error for the whole file — one bad product
   * would cost the entire index, not one URL.
   */
  it("drops an unreadable date rather than writing a broken element", () => {
    const xml = sitemapXml("https://netlet.net", [{ path: "/products/a", lastModified: "not a date" }]);
    expect(xml).toContain("<loc>https://netlet.net/products/a</loc>");
    expect(xml).not.toContain("lastmod");
  });

  it("escapes the five characters XML cannot carry raw", () => {
    const xml = sitemapXml("https://netlet.net", [{ path: "/search?q=a&b=<c>" }]);
    const loc = /<loc>(.*)<\/loc>/.exec(xml)?.[1] ?? "";
    expect(loc).toBe("https://netlet.net/search?q=a&amp;b=&lt;c&gt;");
    // Nothing raw survives inside the element: no bare angle bracket, and
    // every ampersand opens a named entity.
    expect(loc).not.toMatch(/[<>]/);
    expect(loc.replace(/&(amp|lt|gt|quot|apos);/g, "")).not.toContain("&");
  });

  it("omits priority when none is given, rather than inventing one", () => {
    expect(sitemapXml("https://netlet.net", [{ path: "/" }])).not.toContain("priority");
    expect(sitemapXml("https://netlet.net", [{ path: "/", priority: 1 }])).toContain("<priority>1.0</priority>");
  });

  it("is a well-formed document even with nothing to list", () => {
    const xml = sitemapXml("https://netlet.net", []);
    expect(xml.startsWith(`<?xml version="1.0" encoding="UTF-8"?>`)).toBe(true);
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });
});

describe("robotsTxt", () => {
  it("points at a sitemap on the same origin it was asked about", () => {
    expect(robotsTxt("https://netlet.net")).toContain("Sitemap: https://netlet.net/sitemap.xml");
    expect(robotsTxt("https://preview.vercel.app/")).toContain("Sitemap: https://preview.vercel.app/sitemap.xml");
  });

  it("keeps the private and useless paths out of a crawl", () => {
    const text = robotsTxt("https://netlet.net");
    for (const path of ["/checkout", "/account", "/admin", "/api/"]) {
      expect(text).toContain(`Disallow: ${path}`);
    }
  });
});
