import { describe, expect, it } from "vitest";
import { HEAD_END, HEAD_START, headTags, jsonForScript, withHead } from "./seoHead";

const template = `<html><head>\n    ${HEAD_START}\n    <title>Default</title>\n    ${HEAD_END}\n  </head><body></body></html>`;

describe("a page's head in the first response", () => {
  it("replaces the marked default region, once", () => {
    const page = withHead(template, headTags({ title: "Smart watch — NetLet", description: "A watch.", type: "product" }));
    expect(page).toContain("<title>Smart watch — NetLet</title>");
    expect(page).not.toContain("<title>Default</title>");
    expect(page.match(/<title>/g)).toHaveLength(1);
  });

  it("leaves a template without the markers alone", () => {
    const bare = "<html><head><title>Default</title></head></html>";
    expect(withHead(bare, headTags({ title: "X", description: "Y", type: "website" }))).toBe(bare);
  });

  it("escapes what a seller typed", () => {
    const head = headTags({ title: `Lamp "gold" <b>`, description: `5 > 4 & "best"`, type: "product" });
    expect(head).toContain(`content="Lamp &quot;gold&quot; &lt;b&gt;"`);
    expect(head).toContain("<title>Lamp \"gold\" &lt;b&gt;</title>");
    expect(head).toContain(`content="5 &gt; 4 &amp; &quot;best&quot;"`);
  });

  it("cannot be closed early from inside the structured data", () => {
    const json = jsonForScript({ description: "</script><script>alert(1)</script>" });
    expect(json).not.toContain("</script>");
    expect(JSON.parse(json).description).toBe("</script><script>alert(1)</script>");
  });

  it("carries the price and the product data a shopping preview reads", () => {
    const head = headTags(
      { title: "Watch", description: "d", type: "product", canonical: "https://shop.test/products/watch", image: "https://shop.test/w.jpg" },
      { price: { amount: "72.000", currencyCode: "KWD" }, structuredData: [{ "@type": "Product", name: "Watch" }] },
    );
    expect(head).toContain(`<meta property="og:price:amount" content="72.000" />`);
    expect(head).toContain(`<meta property="product:price:currency" content="KWD" />`);
    expect(head).toContain(`<link rel="canonical" href="https://shop.test/products/watch" />`);
    expect(head).toContain(`<script id="netlet-structured-data" type="application/ld+json">{"@type":"Product","name":"Watch"}</script>`);
  });
});
