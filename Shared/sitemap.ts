/**
 * `sitemap.xml` and `robots.txt`, as pure functions over a list of URLs.
 *
 * Both files were static before, and both had gone stale in the way static
 * files do: `robots.txt` pointed a crawler at a sitemap that had never
 * existed, under a repository name the project no longer uses. A promised
 * sitemap that 404s is worse than none — it is the one URL a crawler fetches
 * on trust.
 *
 * The site's own origin is never written down here. It is passed in, because
 * the same build answers on a Vercel preview, on the production domain and on
 * a laptop, and a hard-coded host is wrong on two of the three.
 */

export type SitemapEntry = {
  /** Path from the site root, with a leading slash. */
  path: string;
  /** When the thing at that path last changed, if known. */
  lastModified?: Date | string;
  /** 0.0–1.0. Omitted rather than guessed when nothing distinguishes a page. */
  priority?: number;
};

/**
 * XML has five characters that cannot appear raw in text.
 *
 * A product handle is a slug and would survive unescaped today, but the
 * escaping belongs with the serialiser rather than with an assumption about
 * what callers pass — the first merchant-supplied string to reach here would
 * otherwise produce a file no parser accepts.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** `https://host` + `/path`, with no doubled or missing slash between them. */
export function joinUrl(siteUrl: string, path: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** The date half of an ISO timestamp: a sitemap needs no clock time. */
function isoDay(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function sitemapXml(siteUrl: string, entries: SitemapEntry[]): string {
  const urls = entries.map(entry => {
    const day = entry.lastModified === undefined ? null : isoDay(entry.lastModified);
    return [
      "  <url>",
      `    <loc>${escapeXml(joinUrl(siteUrl, entry.path))}</loc>`,
      day ? `    <lastmod>${day}</lastmod>` : null,
      entry.priority === undefined ? null : `    <priority>${entry.priority.toFixed(1)}</priority>`,
      "  </url>",
    ].filter(line => line !== null).join("\n");
  });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
    "",
  ].join("\n");
}

/**
 * The disallow list is the same one the static file carried, and is about
 * usefulness rather than security: `/account` and `/checkout` are already
 * behind a session, and `/api/` answers nothing a crawler can read. Listing
 * them keeps a crawl budget on the catalog.
 */
export function robotsTxt(siteUrl: string): string {
  return [
    "# NetLet",
    "User-agent: *",
    "Allow: /",
    "",
    "# Nothing useful to a crawler, and the account pages are private.",
    "Disallow: /checkout",
    "Disallow: /account",
    "Disallow: /admin",
    "Disallow: /api/",
    "",
    `Sitemap: ${joinUrl(siteUrl, "/sitemap.xml")}`,
    "",
  ].join("\n");
}
