/**
 * Pulling a manufacturer's product images (3.1.10), the half that goes out to
 * the internet. The rules — which URLs, which addresses, which images — are
 * `shared/commerce/manufacturerImages.ts`.
 *
 * **The address is checked on the lookup the connection uses.** Resolving a
 * name, checking the answer and then connecting would resolve it twice, and a
 * name can answer a public address to the check and a private one to the
 * connection. So the check is the `lookup` handed to the request itself: the
 * address it approves is the address the socket opens, and a name that
 * resolves to anything non-public among its answers is refused outright.
 *
 * **Redirects are followed by hand**, at most `MAX_REDIRECTS`, each new URL
 * asked the same questions as the first. Nothing of the seller's goes with the
 * request — no cookie, no header of theirs — and the whole fetch, redirects
 * included, has one deadline and one byte ceiling.
 *
 * **What comes back is checked by its bytes.** A page must say it is HTML; an
 * image must *be* one of the formats a canvas draws, whatever it was served
 * as, so SVG — a document that can carry script — never passes.
 *
 * Fetching is a catalogue act, `product.edit`, and every fetch counts against
 * the account's hourly ceiling before it is made, in Postgres for the reason
 * sign-in is: the cost is NetLet's bandwidth and the seller's patience is not
 * what is being protected.
 */
import dns from "node:dns";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import zlib from "node:zlib";
import type { Readable } from "node:stream";
import {
  extractCandidates,
  FETCH_TIMEOUT_MS,
  isPublicAddress,
  MAX_PAGE_BYTES,
  MAX_REDIRECTS,
  MAX_REMOTE_IMAGE_BYTES,
  sniffRemoteImage,
  urlProblem,
  type Candidate,
  type RemoteImageType,
  type UrlProblem,
} from "../shared/commerce/manufacturerImages.js";
import { can, type Actor } from "../shared/inventory/permissions.js";
import { checkImportAllowed, recordImport } from "./rateLimit.js";

export type ImportProblem =
  | UrlProblem
  | "manufacturer.unreachable"
  | "manufacturer.notAPage"
  | "manufacturer.tooLarge"
  | "manufacturer.notAnImage"
  | "manufacturer.tooMany"
  | "media.notAllowed";

export class ImportRefused extends Error {
  constructor(readonly reason: ImportProblem) {
    super(reason);
    this.name = "ImportRefused";
  }
}

/** What the server goes out through. A seam, so tests can stand a fake internet in its place. */
export const transport = {
  lookup: dns.lookup as (hostname: string, options: dns.LookupAllOptions, callback: (error: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void) => void,
  request: https.request,
};

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/**
 * The lookup the request connects with: every answer must be public, or none
 * is used. Node asks with `all: true` when it races address families and
 * without it otherwise, so both answer shapes are given.
 */
export function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  transport.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) {
      console.warn(`[manufacturer] refused ${hostname}: resolves to a non-public address`);
      return callback(Object.assign(new Error("non-public address"), { code: "ENOTPUBLIC" }), "", 4);
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

const USER_AGENT = "NetLet-ProductImages/1.0 (fetches a page a seller named, once)";

type Hop = { redirect: string } | { contentType: string; bytes: Buffer };

/** The body, decompressed if the server compressed it anyway, never past the ceiling. */
function readBody(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
  const stream: Readable = encoding === "gzip" || encoding === "x-gzip"
    ? response.pipe(zlib.createGunzip())
    : encoding === "br" ? response.pipe(zlib.createBrotliDecompress())
    : encoding === "deflate" ? response.pipe(zlib.createInflate())
    : response;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        response.destroy();
        stream.destroy();
        reject(new ImportRefused("manufacturer.tooLarge"));
        return;
      }
      chunks.push(chunk);
    });
    let ended = false;
    stream.on("end", () => { ended = true; resolve(Buffer.concat(chunks)); });
    stream.on("error", () => reject(new ImportRefused("manufacturer.unreachable")));
    /* A deadline or a dropped connection closes without ending; a settled promise ignores the rest. */
    response.on("error", () => reject(new ImportRefused("manufacturer.unreachable")));
    stream.on("close", () => { if (!ended) reject(new ImportRefused("manufacturer.unreachable")); });
  });
}

function hop(url: string, accept: string, maxBytes: number, signal: AbortSignal): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: "GET",
      headers: { accept, "user-agent": USER_AGENT, "accept-encoding": "gzip, deflate, br" },
      lookup: guardedLookup as never,
      agent: false,
      signal,
    }, response => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.resume();
        const location = response.headers.location;
        if (!location) return reject(new ImportRefused("manufacturer.unreachable"));
        return resolve({ redirect: location });
      }
      if (status !== 200) {
        response.resume();
        return reject(new ImportRefused("manufacturer.unreachable"));
      }
      if (Number(response.headers["content-length"] ?? 0) > maxBytes) {
        response.destroy();
        return reject(new ImportRefused("manufacturer.tooLarge"));
      }
      readBody(response, maxBytes)
        .then(bytes => resolve({ contentType: String(response.headers["content-type"] ?? ""), bytes }))
        .catch(reject);
    });
    request.on("error", error => reject(error instanceof ImportRefused ? error : new ImportRefused("manufacturer.unreachable")));
    request.end();
  });
}

/** Fetch a URL the rules allow, following redirects by hand, under one deadline. */
export async function guardedFetch(start: string, accept: string, maxBytes: number): Promise<{ url: string; contentType: string; bytes: Buffer }> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), FETCH_TIMEOUT_MS);
  try {
    let url = start.trim();
    for (let redirects = 0; ; redirects += 1) {
      const problem = urlProblem(url);
      if (problem) throw new ImportRefused(redirects === 0 ? problem : "manufacturer.unreachable");
      const answer = await hop(url, accept, maxBytes, deadline.signal);
      if ("bytes" in answer) return { url, contentType: answer.contentType, bytes: answer.bytes };
      if (redirects >= MAX_REDIRECTS) throw new ImportRefused("manufacturer.unreachable");
      try {
        url = new URL(answer.redirect, url).href;
      } catch {
        throw new ImportRefused("manufacturer.unreachable");
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Refused before anything is fetched: who is asking, what they asked for, and how often. */
async function admit(actor: Actor, url: string) {
  if (!can(actor, "product.edit")) throw new ImportRefused("media.notAllowed");
  const problem = urlProblem(url);
  if (problem) throw new ImportRefused(problem);
  const verdict = await checkImportAllowed(actor.userId);
  if (!verdict.allowed) throw new ImportRefused("manufacturer.tooMany");
  /* Counted before the fetch: a page that times out has still been asked for. */
  await recordImport(actor.userId);
}

function charsetOf(contentType: string): string {
  const match = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType);
  return match ? match[1].toLowerCase() : "utf-8";
}

export type ScanResult = { page: string; title: string | null; candidates: Candidate[] };

/** Read a manufacturer's page for the images it declares for its product. */
export async function scanManufacturerPage(actor: Actor, url: string): Promise<ScanResult> {
  await admit(actor, url);
  const fetched = await guardedFetch(url, "text/html,application/xhtml+xml;q=0.9", MAX_PAGE_BYTES);
  if (!/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(fetched.contentType)) throw new ImportRefused("manufacturer.notAPage");
  let html: string;
  try {
    html = new TextDecoder(charsetOf(fetched.contentType)).decode(fetched.bytes);
  } catch {
    html = new TextDecoder("utf-8").decode(fetched.bytes);
  }
  const { title, candidates } = extractCandidates(html, fetched.url);
  return { page: fetched.url, title, candidates };
}

/** One remote image's bytes, for the seller's browser to prepare like an upload. */
export async function fetchManufacturerImage(actor: Actor, url: string): Promise<{ type: RemoteImageType; bytes: Buffer }> {
  await admit(actor, url);
  const fetched = await guardedFetch(url, "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8", MAX_REMOTE_IMAGE_BYTES);
  const type = sniffRemoteImage(fetched.bytes);
  if (!type) throw new ImportRefused("manufacturer.notAnImage");
  return { type, bytes: fetched.bytes };
}
