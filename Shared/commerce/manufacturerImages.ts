/**
 * Pulling a manufacturer's own product images (3.1.10).
 *
 * A seller names the manufacturer's product page; NetLet reads it for the
 * images the manufacturer itself declared as the product's, fetches the one
 * the seller picks, and hands it to the same before-and-after preparation an
 * upload goes through (3.3.4). Pure and shared, for the reason every rule
 * here is: what it decides is which addresses NetLet's server will go and
 * fetch, and the editor must not offer what the server refuses.
 *
 * ## The server fetching a URL somebody typed is the whole risk
 *
 * Asked naively, "fetch this page" is a door into NetLet's own network: a
 * cloud metadata address, a database on a private range, a loopback admin
 * port. So the rule is narrow on purpose — https on the standard port, a real
 * hostname rather than an address, and **every address that name resolves to
 * must be public**, checked on the resolution the connection actually uses so
 * a name cannot answer one way when checked and another when connected
 * (`Backend/src/services/manufacturerImages.ts`). Redirects are followed by hand and each
 * hop is asked again.
 *
 * ## The manufacturer's declaration, not a scrape of every picture
 *
 * A page carries dozens of images — logos, banners, other products. What the
 * manufacturer says *this product's* images are is in its structured data: a
 * schema.org `Product`'s `image`, then the page's own share image. Those are
 * read, in that order, and nothing else; a page that declares none says so
 * rather than being guessed at.
 *
 * ## What is still the gap
 *
 * Finding the page. With a product name and nothing else, locating the
 * manufacturer's images needs an image search or a catalogue provider NetLet
 * does not have — and a model asked for the URL invents one.
 */

/** The most a manufacturer's page may weigh before NetLet stops reading it. */
export const MAX_PAGE_BYTES = 2_000_000;
/** The most one remote image may weigh; the browser shrinks it before anything is stored. */
export const MAX_REMOTE_IMAGE_BYTES = 8_000_000;
/** How many images one page offers. */
export const MAX_CANDIDATES = 8;
/** How many redirects a fetch follows, each one checked again. */
export const MAX_REDIRECTS = 3;
/** How long one fetch may take, start to last byte. */
export const FETCH_TIMEOUT_MS = 8_000;
/** The longest URL accepted. */
export const MAX_URL_LENGTH = 2_048;

export type UrlProblem = "manufacturer.badUrl" | "manufacturer.notHttps";

/** Endings that only ever name something on a private network. */
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet", ".corp"];

/** Whether a URL is one NetLet's server may go and fetch, before any address is looked up. */
export function urlProblem(raw: string): UrlProblem | null {
  const text = raw.trim();
  if (!text || text.length > MAX_URL_LENGTH) return "manufacturer.badUrl";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "manufacturer.badUrl";
  }
  if (url.protocol !== "https:") return "manufacturer.notHttps";
  if (url.username || url.password) return "manufacturer.badUrl";
  if (url.port && url.port !== "443") return "manufacturer.badUrl";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  /* An address rather than a name never goes through the lookup that checks it. */
  if (isIpLiteral(host)) return "manufacturer.badUrl";
  if (!host.includes(".") || host === "localhost") return "manufacturer.badUrl";
  if (PRIVATE_SUFFIXES.some(suffix => host.endsWith(suffix))) return "manufacturer.badUrl";
  return null;
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || host.includes(":");
}

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map(part => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return numbers.every(n => Number.isInteger(n) && n >= 0 && n <= 255) ? numbers : null;
}

function publicIpv4([a, b, c]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; /* carrier-grade NAT */
  if (a === 169 && b === 254) return false; /* link-local, cloud metadata */
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false; /* multicast and reserved */
  return true;
}

/** The eight 16-bit groups of an IPv6 address, or null. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  /* A dotted IPv4 tail becomes two groups. */
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail) {
    const v4 = ipv4Parts(tail[1]);
    if (!v4) return null;
    text = text.slice(0, -tail[1].length) + `${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const read = (part: string) => (part ? part.split(":") : []);
  const head = read(halves[0]);
  const rest = halves.length === 2 ? read(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  const numbers = groups.map(group => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN));
  return numbers.length === 8 && numbers.every(n => !Number.isNaN(n)) ? numbers : null;
}

/**
 * Whether an address is on the public internet. Anything unparsable, private,
 * loopback, link-local, multicast, reserved for documentation, or a tunnel
 * that could carry a private address inside it, is not.
 */
export function isPublicAddress(ip: string): boolean {
  const v4 = ipv4Parts(ip);
  if (v4) return publicIpv4(v4);
  const g = ipv6Groups(ip);
  if (!g) return false;
  /* IPv4-mapped and -compatible: judge the address inside. */
  if (g.slice(0, 5).every(n => n === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return publicIpv4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]);
  }
  if ((g[0] & 0xe000) !== 0x2000) return false; /* only global unicast, 2000::/3 */
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; /* documentation */
  if (g[0] === 0x2001 && g[1] < 0x0200) return false; /* Teredo, benchmarking, ORCHID and the rest of 2001::/23 */
  if (g[0] === 0x2002) return false; /* 6to4, which tunnels an IPv4 address */
  if (g[0] === 0x0064 && g[1] === 0xff9b) return false; /* NAT64 */
  return true;
}

export type CandidateSource = "product" | "share";
export type Candidate = { url: string; source: CandidateSource };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** HTML character references in an attribute value, decoded. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/** One tag's attributes, lower-cased names, decoded values. */
function attributes(tag: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    found[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return found;
}

const SHARE_KEYS = new Set(["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"]);
/** A picture whose address says it is the site rather than the product. */
const NOT_A_PRODUCT = /(?:^|[/_.-])(?:logo|icon|favicon|sprite|placeholder|badge|banner)(?:[/_.-]|$)/i;

/** Every value a schema.org `image` may hold: a string, an `ImageObject`, or a list of either. */
function imagesOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(imagesOf);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return imagesOf(object.contentUrl ?? object.url);
  }
  return [];
}

function isProduct(node: Record<string, unknown>): boolean {
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some(entry => typeof entry === "string" && /(^|[/:])(Product|ProductModel|IndividualProduct)$/.test(entry));
}

/** Every `Product` in a JSON-LD document, however it is nested. */
function productsIn(value: unknown, depth = 0, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (depth > 6 || !value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const entry of value) productsIn(entry, depth + 1, out);
    return out;
  }
  const node = value as Record<string, unknown>;
  if (isProduct(node)) out.push(node);
  for (const key of ["@graph", "mainEntity", "itemListElement", "item", "isVariantOf", "hasVariant"]) productsIn(node[key], depth + 1, out);
  return out;
}

function flatText(value: string, max: number): string {
  return Array.from(value.replace(/\s+/g, " ").trim()).slice(0, max).join("");
}

/**
 * The images a manufacturer's page declares for its product, best first, and
 * what the page calls the product.
 *
 * Structured product data comes before the share image because it is the
 * manufacturer saying "these are the product"; the share image is often a
 * campaign banner. Only https addresses are kept, because only those can be
 * fetched; duplicates and anything named like a logo are dropped.
 */
export function extractCandidates(html: string, pageUrl: string): { title: string | null; candidates: Candidate[] } {
  const found: Candidate[] = [];
  let title: string | null = null;

  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    for (const product of productsIn(data)) {
      for (const image of imagesOf(product.image)) found.push({ url: image, source: "product" });
      if (!title && typeof product.name === "string" && product.name.trim()) title = flatText(decodeEntities(product.name), 200);
    }
  }

  let ogTitle: string | null = null;
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (SHARE_KEYS.has(key) && attrs.content) found.push({ url: attrs.content, source: "share" });
    if (key === "og:title" && attrs.content && !ogTitle) ogTitle = flatText(attrs.content, 200);
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if ((attrs.rel ?? "").toLowerCase().split(/\s+/).includes("image_src") && attrs.href) found.push({ url: attrs.href, source: "share" });
  }
  if (!title) title = ogTitle;
  if (!title) {
    const tag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
    if (tag && tag[1].trim()) title = flatText(decodeEntities(tag[1]), 200);
  }

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const entry of found) {
    let resolved: URL;
    try {
      resolved = new URL(entry.url.trim(), pageUrl);
    } catch {
      continue;
    }
    resolved.hash = "";
    const href = resolved.href;
    if (resolved.protocol !== "https:" || seen.has(href) || NOT_A_PRODUCT.test(resolved.pathname) || urlProblem(href)) continue;
    seen.add(href);
    candidates.push({ url: href, source: entry.source });
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return { title, candidates };
}

export type RemoteImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/avif";

/**
 * What a fetched file actually is, from its first bytes. Only formats a
 * browser draws onto a canvas; never SVG, which is a document that can carry
 * script, whatever the server that sent it said it was.
 */
export function sniffRemoteImage(bytes: Uint8Array): RemoteImageType | null {
  const at = (i: number, ...values: number[]) => values.every((value, k) => bytes[i + k] === value);
  if (bytes.length < 12) return null;
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(4, 0x66, 0x74, 0x79, 0x70) && (at(8, 0x61, 0x76, 0x69, 0x66) || at(8, 0x61, 0x76, 0x69, 0x73))) return "image/avif";
  return null;
}
