/**
 * A page's `<head>`, written into the HTML the server sends.
 *
 * The storefront renders in the browser, so the HTML a crawler or a chat app
 * fetches was the same 3 KB shell for every address — the home page's title,
 * blurb and picture under every product link pasted into WhatsApp, and
 * nothing for a search engine that does not run the script. `usePageMeta`
 * fixes the tags once the page has loaded, which is too late for anything
 * that only reads the first response. This writes the same tags — the same
 * `PageMeta` and the same JSON-LD the page itself produces — into that first
 * response, so a link preview shows the product and its price.
 *
 * Pure: it takes the template and the facts and returns the page, so what it
 * escapes is tested here rather than discovered in a preview card.
 */
import type { PageMeta } from "./seo.js";

/** The marked region of `client/index.html` that a page's own head replaces. */
export const HEAD_START = "<!-- netlet:head -->";
export const HEAD_END = "<!-- /netlet:head -->";

/** The id `usePageMeta` gives its structured-data script, so it replaces this one rather than adding a second. */
export const JSON_LD_ID = "netlet-structured-data";

function attr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function text(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * JSON for a `<script>` data block. `<` is written as `<`, so a seller
 * who types `</script>` into a description cannot end the block and start
 * markup of their own; JSON parses the escape back to the same character.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(LINE_SEPARATOR, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR, "\\u2029");
}

/* Valid in JSON, a line break to a JavaScript parser reading the block. */
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), "g");
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), "g");

export type HeadExtras = {
  /** A product's price, for the Open Graph price tags a shopping preview reads. */
  price?: { amount: string; currencyCode: string };
  structuredData?: Record<string, unknown>[];
};

export function headTags(meta: PageMeta, extras: HeadExtras = {}): string {
  const tags: string[] = [
    `<title>${text(meta.title)}</title>`,
    `<meta name="description" content="${attr(meta.description)}" />`,
    `<meta property="og:site_name" content="NetLet" />`,
    `<meta property="og:type" content="${meta.type === "product" ? "product" : "website"}" />`,
    `<meta property="og:title" content="${attr(meta.title)}" />`,
    `<meta property="og:description" content="${attr(meta.description)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${attr(meta.title)}" />`,
    `<meta name="twitter:description" content="${attr(meta.description)}" />`,
  ];
  if (meta.image) {
    tags.push(`<meta property="og:image" content="${attr(meta.image)}" />`, `<meta name="twitter:image" content="${attr(meta.image)}" />`);
  }
  if (meta.canonical) {
    tags.push(`<meta property="og:url" content="${attr(meta.canonical)}" />`, `<link rel="canonical" href="${attr(meta.canonical)}" />`);
  }
  if (meta.noindex) tags.push(`<meta name="robots" content="noindex, nofollow" />`);
  if (extras.price) {
    const { amount, currencyCode } = extras.price;
    tags.push(
      `<meta property="product:price:amount" content="${attr(amount)}" />`,
      `<meta property="product:price:currency" content="${attr(currencyCode)}" />`,
      `<meta property="og:price:amount" content="${attr(amount)}" />`,
      `<meta property="og:price:currency" content="${attr(currencyCode)}" />`,
    );
  }
  const data = extras.structuredData ?? [];
  if (data.length) {
    tags.push(`<script id="${JSON_LD_ID}" type="application/ld+json">${jsonForScript(data.length === 1 ? data[0] : data)}</script>`);
  }
  return tags.map(tag => `    ${tag}`).join("\n");
}

/**
 * The template with its marked head region replaced. A template without the
 * markers is returned as it came — a page with the default tags is better than
 * one with two titles.
 */
export function withHead(template: string, head: string): string {
  const start = template.indexOf(HEAD_START);
  const end = template.indexOf(HEAD_END);
  if (start === -1 || end === -1 || end < start) return template;
  return `${template.slice(0, start + HEAD_START.length)}\n${head}\n    ${template.slice(end)}`;
}
