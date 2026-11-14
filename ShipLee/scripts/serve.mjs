/**
 * The built site on a laptop, as Vercel serves it: dist/ for the pages, the
 * bundled function for /api, the SPA fallback for every other path but
 * /assets, and the headers vercel.json sets. For looking at a build before it
 * ships; `pnpm build` first.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const { default: handler } = await import(pathToFileURL(join(root, "api/handler.generated.js")).href);
const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
const everywhere = (vercel.headers ?? []).find(rule => rule.source === "/(.*)")?.headers ?? [];
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain", ".xml": "application/xml", ".json": "application/json" };
const port = Number(process.env.PORT ?? 5091);

createServer((req, res) => {
  for (const { key, value } of everywhere) res.setHeader(key, value);
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/api" || path.startsWith("/api/")) return handler(req, res);
  const file = normalize(join(dist, path));
  if (file.startsWith(dist) && existsSync(file) && statSync(file).isFile()) {
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    return res.end(readFileSync(file));
  }
  if (path.startsWith("/assets/")) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[".html"] });
  res.end(readFileSync(join(dist, "index.html")));
}).listen(port, () => console.log(`ShipLee on http://localhost:${port}`));
