import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { patternSource, routeTable, routesFromApp } from "./routePreloads";

describe("the route preload table", () => {
  it("reads the shopping routes from App.tsx, so a new page needs no second list", () => {
    const routes = routesFromApp(readFileSync(path.resolve(import.meta.dirname, "../src/App.tsx"), "utf8"));
    const patterns = routes.map(([pattern]) => pattern);
    expect(patterns).toEqual(expect.arrayContaining(["/products/:handle", "/category/:slug", "/search", "/account", "/account/:section", "/guides/:slug", "/checkout"]));
    expect(routes.find(([pattern]) => pattern === "/products/:handle")?.[1]).toBe("/pages/ProductDetail.tsx");
    /* The home page is in the main bundle, and the portal is not a shopper's first page. */
    expect(patterns).not.toContain("/");
    expect(patterns.some(pattern => pattern.startsWith("/admin"))).toBe(false);
    expect(routes.length).toBeGreaterThan(20);
  });

  it("matches an address as wouter does", () => {
    const product = new RegExp(patternSource("/products/:handle"));
    expect(product.test("/products/smart-watch")).toBe(true);
    expect(product.test("/products/smart-watch/")).toBe(true);
    expect(product.test("/products")).toBe(false);
    expect(product.test("/products/a/b")).toBe(false);
    expect(new RegExp(patternSource("/search")).test("/search")).toBe(true);
    expect(new RegExp(patternSource("/")).test("/")).toBe(true);
  });

  it("lists a page's chunk and what it imports, never what the main bundle already has", () => {
    const chunks = [
      { fileName: "assets/index.js", imports: ["assets/react.js"], isEntry: true, facadeModuleId: "/src/main.tsx" },
      { fileName: "assets/react.js", imports: [], isEntry: false, facadeModuleId: null },
      /* No facade, as Rollup leaves the product page's: found by the module it holds. */
      { fileName: "assets/Product.js", imports: ["assets/react.js", "assets/shared.js"], isEntry: false, facadeModuleId: null, moduleIds: ["/x/src/lib/zoom.ts", "/x/src/pages/ProductDetail.tsx"] },
      { fileName: "assets/Category.js", imports: ["assets/shared.js"], isEntry: false, facadeModuleId: "/x/src/pages/Category.tsx" },
      { fileName: "assets/shared.js", imports: [], isEntry: false, facadeModuleId: null },
    ];
    const { table, unplaced } = routeTable([["/products/:handle", "/pages/ProductDetail.tsx"], ["/search", "/pages/Category.tsx"], ["/gone", "/pages/Gone.tsx"]], chunks, "/");
    expect(unplaced).toEqual(["/gone"]);
    expect(table.files).toEqual(["assets/Product.js", "assets/shared.js", "assets/Category.js"]);
    expect(table.routes).toEqual([["^/products/[^/]+/?$", [0, 1]], ["^/search/?$", [2, 1]]]);
  });
});
