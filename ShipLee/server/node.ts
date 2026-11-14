/**
 * The API as a Node request handler — what Vercel calls, and what the local
 * servers mount. It turns the incoming request into a standard Request, hands
 * it to `handle`, and writes the Response back.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { handle } from "./handle.js";
import { contextFromEnv } from "./context.js";

const MAX_BODY = 64 * 1024;

async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_BODY) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function nodeHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
    const proto = req.headers["x-forwarded-proto"] ?? "http";
    const url = new URL(req.url ?? "/", `${Array.isArray(proto) ? proto[0] : proto}://${Array.isArray(host) ? host[0] : host}`);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
    }
    const method = (req.method ?? "GET").toUpperCase();
    let body: Buffer | null = null;
    if (method !== "GET" && method !== "HEAD") {
      body = await readBody(req);
      if (body === null) {
        res.writeHead(413, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: "tooLarge" }));
        return;
      }
    }
    const response = await handle(new Request(url, { method, headers, body: body ? new Uint8Array(body) : null }), contextFromEnv());
    const out: Record<string, string | string[]> = {};
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie") out[name] = value;
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) out["set-cookie"] = cookies;
    res.writeHead(response.status, out);
    res.end(method === "HEAD" ? undefined : Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error("[shiplee] could not answer:", error instanceof Error ? error.message : error);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "server" }));
  }
}
