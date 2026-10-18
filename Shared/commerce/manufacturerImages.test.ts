import { describe, expect, it } from "vitest";
import { decodeEntities, extractCandidates, isPublicAddress, MAX_CANDIDATES, sniffRemoteImage, urlProblem } from "./manufacturerImages.js";

describe("which URLs the server may fetch", () => {
  it("takes an ordinary https product page", () => {
    expect(urlProblem("https://www.example-maker.com/products/lamp-200?colour=brass")).toBeNull();
    expect(urlProblem("  https://example.com:443/x  ")).toBeNull();
  });

  it("refuses everything that could point back inside", () => {
    expect(urlProblem("http://example.com/")).toBe("manufacturer.notHttps");
    expect(urlProblem("ftp://example.com/")).toBe("manufacturer.notHttps");
    expect(urlProblem("file:///etc/passwd")).toBe("manufacturer.notHttps");
    for (const raw of [
      "https://127.0.0.1/", "https://169.254.169.254/latest/meta-data/", "https://[::1]/", "https://[fd00::1]/",
      /* The URL parser turns these into dotted addresses, which are then refused as addresses. */
      "https://0x7f.1/", "https://2130706433/", "https://017700000001/",
      "https://localhost/", "https://localhost./", "https://intranet/", "https://printer.local/", "https://db.internal/", "https://nas.home.arpa/",
      "https://user:pass@example.com/", "https://example.com:8443/", "https://example.com:22/",
      "", "not a url", `https://example.com/${"a".repeat(2100)}`,
    ]) {
      expect({ raw, problem: urlProblem(raw) }).toEqual({ raw, problem: expect.stringMatching(/^manufacturer\./) });
    }
  });
});

describe("which addresses are public", () => {
  it("knows the private, loopback, link-local and reserved ranges, in both families", () => {
    for (const ip of [
      "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1",
      "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255",
      "::", "::1", "fe80::1", "fd12:3456::1", "fc00::1", "ff02::1", "2001:db8::1", "2001::1", "2002:7f00:1::1", "64:ff9b::7f00:1",
      "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "::127.0.0.1",
      "garbage", "1.2.3", "300.1.1.1", "1:2:3",
    ]) {
      expect({ ip, public: isPublicAddress(ip) }).toEqual({ ip, public: false });
    }
  });

  it("lets the public internet through", () => {
    for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "100.128.0.1", "::ffff:8.8.8.8", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e"]) {
      expect({ ip, public: isPublicAddress(ip) }).toEqual({ ip, public: true });
    }
  });
});

describe("reading a page for its product images", () => {
  const page = "https://maker.example/products/lamp";

  it("puts the manufacturer's structured product images first, then the share image, and names the product", () => {
    const html = `<!doctype html><html><head>
      <title>Lamp 200 | Maker</title>
      <meta property="og:image" content="https://cdn.maker.example/share/lamp-hero.jpg">
      <meta property="og:title" content="Lamp 200 — campaign">
      <script type="application/ld+json">
        {"@context":"https://schema.org","@graph":[
          {"@type":"Organization","logo":"https://cdn.maker.example/brand/logo.png"},
          {"@type":["Product"],"name":"Lamp 200 &amp; shade","image":[
            "/media/lamp-front.jpg",
            {"@type":"ImageObject","contentUrl":"https://cdn.maker.example/media/lamp-side.webp"},
            "https://cdn.maker.example/share/lamp-hero.jpg#zoom"
          ]}
        ]}
      </script></head><body><img src="https://cdn.maker.example/other.jpg"></body></html>`;
    expect(extractCandidates(html, page)).toEqual({
      title: "Lamp 200 & shade",
      candidates: [
        { url: "https://maker.example/media/lamp-front.jpg", source: "product" },
        { url: "https://cdn.maker.example/media/lamp-side.webp", source: "product" },
        /* The same picture as the share image, once, at its first and better source. */
        { url: "https://cdn.maker.example/share/lamp-hero.jpg", source: "product" },
      ],
    });
  });

  it("falls back to the share image and the page title, decoding attribute values", () => {
    const html = `<head><title> Lamp&nbsp;200 </title>
      <meta content='https://cdn.maker.example/a.jpg?w=1200&amp;h=1200' property='og:image:secure_url' />
      <meta name="twitter:image" content=https://cdn.maker.example/b.png>
      <link rel="preload image_src" href="//cdn.maker.example/c.webp"></head>`;
    expect(extractCandidates(html, page)).toEqual({
      title: "Lamp 200",
      candidates: [
        { url: "https://cdn.maker.example/a.jpg?w=1200&h=1200", source: "share" },
        { url: "https://cdn.maker.example/b.png", source: "share" },
        { url: "https://cdn.maker.example/c.webp", source: "share" },
      ],
    });
  });

  it("drops what cannot be fetched or is the site rather than the product, and stops at the cap", () => {
    const many = Array.from({ length: 20 }, (_, i) => `"https://cdn.maker.example/p${i}.jpg"`).join(",");
    const html = `<script type="application/ld+json">{"@type":"Product","image":[
      "http://cdn.maker.example/insecure.jpg", "https://127.0.0.1/x.jpg", "https://cdn.maker.example/brand-logo.png",
      "https://cdn.maker.example/favicon.ico", "data:image/png;base64,AAAA", "javascript:alert(1)", ${many}]}</script>
      <script type="application/ld+json">{ not json</script>`;
    const { candidates } = extractCandidates(html, page);
    expect(candidates).toHaveLength(MAX_CANDIDATES);
    expect(candidates[0].url).toBe("https://cdn.maker.example/p0.jpg");
  });

  it("says nothing was found rather than guessing from the page's pictures", () => {
    expect(extractCandidates(`<html><body><img src="https://cdn.maker.example/x.jpg"></body></html>`, page)).toEqual({ title: null, candidates: [] });
  });

  it("decodes numeric and named references, and leaves unknown ones alone", () => {
    expect(decodeEntities("a&#38;b&#x26;c&amp;d&bogus;&#0;")).toBe("a&b&c&d&bogus;&#0;");
  });
});

describe("what a fetched file is", () => {
  const head = (...bytes: number[]) => new Uint8Array([...bytes, ...Array(16).fill(0)]);
  it("reads the formats a canvas draws, by their own bytes", () => {
    expect(sniffRemoteImage(head(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffRemoteImage(head(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffRemoteImage(head(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe("image/webp");
    expect(sniffRemoteImage(head(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe("image/gif");
    expect(sniffRemoteImage(head(0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66))).toBe("image/avif");
  });

  it("refuses SVG, HTML and anything short, whatever it was served as", () => {
    expect(sniffRemoteImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffRemoteImage(new TextEncoder().encode("<!doctype html><html></html>"))).toBeNull();
    expect(sniffRemoteImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});
