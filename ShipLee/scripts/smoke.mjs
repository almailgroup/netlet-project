/**
 * Runs the built function the way Vercel will: copied somewhere with no
 * node_modules in reach (Node looks for them up the folders, so a copy inside
 * the project would find the project's own and pass a bundle missing half of
 * itself), then asked real questions over HTTP.
 */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "shiplee-smoke-"));
const file = join(dir, "handler.mjs");
copyFileSync(new URL("../api/handler.generated.js", import.meta.url), file);
process.env.SHIPLEE_DEMO = "1";
process.env.STAFF_PASSWORD = "smoke-test-password";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

const { default: handler } = await import(pathToFileURL(file).href);
const server = createServer((req, res) => handler(req, res));
await new Promise(resolve => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const failures = [];
const ask = async (path, check, init) => {
  const response = await fetch(base + path, init);
  const body = await response.json().catch(() => null);
  if (!check(response, body)) failures.push(`${init?.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
};

try {
  await ask("/api?route=health", (r, b) => r.ok && b.ok === true && b.store === "demo");
  const config = await ask("/api?route=config", (r, b) => r.ok && b.demo === true && b.samples.length > 0);
  await ask(`/api?route=track/${config.samples[0]}`, (r, b) => r.ok && b.trackingNumber === config.samples[0] && !("recipientPhone" in b));
  await ask("/api/track/SL0000000000", r => r.status === 404 || r.status === 400);
  await ask("/api/staff/session", (r, b) => r.ok && b.open === true && b.signedIn === false);
  await ask("/api/staff/session", r => r.status === 401, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "nope" }) });
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`Smoke failed:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("Smoke passed: the bundled function answers on its own.");
